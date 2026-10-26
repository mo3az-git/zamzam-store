import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { registerTsNode, repositoryRoot, getSystemMetadata, verifyDisposableTargetServices,
  loadMedusaRuntime, createPgClient, createRedisClient, safeCloseClients, writeTpEvidence } from "./shared/tp-harness.mjs";

const id = process.argv[2];
const originalRunners = { "TP-03": "test-tp03-concurrent-lock-rejection.mjs", "TP-02c": "test-tp02c-lock-timeout-cas-abort.mjs" };
if (!Object.hasOwn(originalRunners, id)) throw new Error("Unsupported HTTP lock case");
// Preserve every existing assertion and run it against the real implementation
// before adding HTTP coverage. A failing original runner cannot become a pass.
const original = spawnSync(process.execPath, [path.join(repositoryRoot, "apps/backend/scripts", originalRunners[id])], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
process.stdout.write(original.stdout || ""); process.stderr.write(original.stderr || "");
if (original.status !== 0) process.exit(original.status || 1);
const evidenceDir = path.join(repositoryRoot, "artifacts/tp-evidence", id);
const json = async (file) => JSON.parse(await readFile(path.join(evidenceDir, file), "utf8"));
const priorResult = await json("result.json"), assertions = await json("assertions.json");
const dbBefore = { workflow: await json("db-before.json") }, dbAfter = { workflow: await json("db-after.json") };
const metadata = await getSystemMetadata();
const { Modules } = registerTsNode()("@medusajs/framework/utils");
const events = [], cleanupErrors = [];
const check = (name, expected, actual, passed) => {
  assertions.push({ name, expected, actual, passed: Boolean(passed), category: "http" });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`);
  if (!passed) throw new Error(name);
};
let runtime, server, pg, redis, cart, apiKey, cartService, apiKeyService, locking, physicalKey, pending;
let blocker = null, status = "failed";
const ownerId = "worker:http:" + randomUUID(), key = randomUUID();
const oldPrototypeFlag = process.env.PHASE1_ENABLE_PROTOTYPE_ROUTES;
try {
  const target = verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL);
  check("http_disposable_target_verified", true, target.verified, target.verified);
  pg = createPgClient(process.env.DATABASE_URL); await pg.connect();
  redis = createRedisClient(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL); await redis.connect();
  process.env.PHASE1_DISABLE_ADMIN = "true";
  runtime = await loadMedusaRuntime({ entryPoints: true });
  cartService = runtime.container.resolve(Modules.CART); apiKeyService = runtime.container.resolve(Modules.API_KEY);
  locking = runtime.container.resolve(Modules.LOCKING);
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId);
  cart = await cartService.createCarts({ currency_code: "egp", items: [], metadata: { fixture: id + " HTTP" } });
  await runtime.container.resolve("batch_inventory").createCartCheckoutSessions({ cart_id: cart.id, current_attempt_id: randomUUID(), epoch: 1, status: "in_progress" });
  apiKey = await apiKeyService.createApiKeys({ title: id + " HTTP disposable", type: "publishable", created_by: "phase1-test" });
  server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/store/carts/${cart.id}/checkout-lock`;
  const request = async (requestKey) => {
    const response = await fetch(url, { method: "POST", headers: {
      "content-type": "application/json", "x-publishable-api-key": apiKey.token, "idempotency-key": requestKey,
    }, body: "{}", signal: AbortSignal.timeout(12000) });
    return { status: response.status, body: await response.json() };
  };
  delete process.env.PHASE1_ENABLE_PROTOTYPE_ROUTES;
  const disabled = await request(randomUUID());
  check("prototype_route_disabled_by_default", 404, disabled.status, disabled.status === 404);
  process.env.PHASE1_ENABLE_PROTOTYPE_ROUTES = "true";
  const freeKey = randomUUID(), free = await request(freeKey);
  check("http_free_lock_positive_control", 200, free, free.status === 200 && free.body.acquired === true);
  const freeLease = await pg.query("SELECT key FROM idempotency_key WHERE key=$1", [freeKey]);
  check("http_success_leaves_no_pending_lease", 0, freeLease.rowCount, freeLease.rowCount === 0);
  physicalKey = provider.keyNamePrefix + "cart:" + cart.id;
  await locking.acquire("cart:" + cart.id, { ownerId, expire: 120 });
  events.push({ event: "http_worker_a_acquired", at: new Date().toISOString() });
  const snapshot = async () => ({
    cart: (await pg.query("SELECT * FROM cart WHERE id=$1", [cart.id])).rows,
    session: (await pg.query("SELECT * FROM cart_checkout_session WHERE cart_id=$1", [cart.id])).rows,
    reservations: (await pg.query("SELECT * FROM cart_batch_reservation WHERE cart_id=$1 ORDER BY id", [cart.id])).rows,
    nativeReservationCount: (await pg.query("SELECT COUNT(*)::int AS count FROM reservation_item")).rows[0].count,
  });
  dbBefore.http = await snapshot();
  const started = performance.now(); pending = request(key);
  let inFlightLease = null;
  for (let poll=0; poll<100; poll++) {
    inFlightLease = (await pg.query("SELECT * FROM idempotency_key WHERE key=$1", [key])).rows[0];
    if (inFlightLease) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  events.push({ event: "http_pending_lease_observed", at: new Date().toISOString(), lease: inFlightLease });
  check("http_real_pending_lease_exists_while_contended", "pending with server-generated owner", inFlightLease,
    inFlightLease?.status === "pending" && inFlightLease?.lease_owner_id?.startsWith("worker:"));
  const response = await pending;
  const elapsed = (performance.now()-started)/1000;
  events.push({ event: "http_worker_b_received_response", at: new Date().toISOString(), elapsed, response });
  check("http_real_409_lock_timeout", { status: 409, code: "LOCK_TIMEOUT" }, response,
    response.status === 409 && response.body.code === "LOCK_TIMEOUT" && response.body.type === "conflict");
  check("http_timeout_in_5_second_window", "5.0s ±0.5s", elapsed, elapsed >= 4.5 && elapsed <= 5.5);
  const remaining = await pg.query("SELECT * FROM idempotency_key WHERE key=$1", [key]);
  check("http_timeout_cas_removed_own_pending_lease", 0, remaining.rowCount, remaining.rowCount === 0);
  dbAfter.http = await snapshot();
  check("http_session_cardinality_exactly_one", [1,1], [dbBefore.http.session.length, dbAfter.http.session.length], dbBefore.http.session.length === 1 && dbAfter.http.session.length === 1);
  check("http_cart_session_and_reservations_unchanged", dbBefore.http, dbAfter.http, JSON.stringify(dbBefore.http) === JSON.stringify(dbAfter.http));
  const lockOwner = await redis.get(physicalKey), ttl = await redis.ttl(physicalKey);
  check("http_worker_a_owner_and_positive_ttl_preserved", { ownerId, positiveTtl: true }, { ownerId: lockOwner, ttl }, lockOwner === ownerId && ttl > 0);
  status = "passed";
} catch (error) {
  blocker = error.stack || String(error); console.error(blocker);
  assertions.push({ name: "http_execution_completed", expected: true, actual: error.message, passed: false });
} finally {
  const clean = async (name, fn) => { try { await fn(); } catch (error) { cleanupErrors.push(name + ": " + error.message); } };
  if (pending) await clean("pending HTTP request", () => pending);
  if (server) await clean("HTTP server", () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  if (cart && locking) await clean("HTTP cart lock", () => locking.release("cart:" + cart.id, { ownerId }));
  if (pg && cart) {
    await clean("HTTP lease", () => pg.query("DELETE FROM idempotency_key WHERE key=$1", [key]));
    await clean("HTTP session", () => pg.query("DELETE FROM cart_checkout_session WHERE cart_id=$1", [cart.id]));
    await clean("HTTP cart", () => cartService.deleteCarts(cart.id));
  }
  if (apiKey) await clean("HTTP publishable key", async () => {
    await apiKeyService.revoke(apiKey.id, { revoked_by: "phase1-test" }); await apiKeyService.deleteApiKeys(apiKey.id);
  });
  if (runtime) await clean("Medusa shutdown", () => runtime.shutdown());
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors });
  if (oldPrototypeFlag === undefined) delete process.env.PHASE1_ENABLE_PROTOTYPE_ROUTES; else process.env.PHASE1_ENABLE_PROTOTYPE_ROUTES = oldPrototypeFlag;
}
assertions.push({ name: "http_fixture_cleanup_succeeded", expected: [], actual: cleanupErrors, passed: cleanupErrors.length === 0 });
if (cleanupErrors.length) { status = "failed"; blocker = (blocker || "") + " cleanup: " + cleanupErrors.join("; "); console.error(blocker); }
console.log(`${id} Assertion Summary: ${assertions.filter((item) => item.passed).length}/${assertions.length} passed (original workflow + real HTTP).`);
await writeTpEvidence({ evidenceDir, tpId: id, title: priorResult.title, batch: priorResult.batch, startedAt: priorResult.startedAt,
  ...metadata, status, blocker, assertions, exitCode: status === "passed" ? 0 : 1, dbBefore, dbAfter, interleaving: events,
  containerDetails: { workflow: priorResult.containerDetails, http: { nativeMedusaApi: true, route: "POST /store/carts/:id/checkout-lock" } },
  testCommand: "node apps/backend/scripts/test-checkout-lock-http.mjs " + id,
  assessmentType: "original workflow assertions plus real prototype checkout-lock HTTP stage; no full checkout/order conversion",
  note: "The HTTP seam is explicitly enabled only for the prototype. Native reservation counts remain table-wide on an empty cart. No full inventory/checkout or TP-01 acceptance is claimed.",
});
process.exit(status === "passed" ? 0 : 1);
