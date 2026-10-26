import { randomUUID } from "node:crypto";
import path from "node:path";
import { once } from "node:events";
import {
  registerTsNode, repositoryRoot, getSystemMetadata, verifyDisposableTargetServices,
  loadMedusaRuntime, createPgClient, createRedisClient, writeTpEvidence, safeCloseClients,
} from "./shared/tp-harness.mjs";

const id = process.argv[2];
if (!["TP-04a", "TP-04b"].includes(id)) throw new Error("Unsupported mutation TP: " + id);
const { Modules } = registerTsNode()("@medusajs/framework/utils");
const startedAt = new Date().toISOString();
const metadata = await getSystemMetadata();
const assertions = [];
const events = [];
const check = (name, expected, actual, passed) => {
  assertions.push({ name, expected, actual, passed: Boolean(passed) });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`);
  if (!passed) throw new Error("Assertion failed: " + name);
};
let runtime, server, pg, redis, cart, apiKey, cartService, apiKeyService, locking, physicalKey;
let regionService, salesChannelService, region, salesChannel;
let dbBefore, dbAfter, containerDetails;
let status = "failed", blocker = null;
const key = randomUUID(), ownerId = "worker:" + randomUUID();
const cleanupErrors = [];
try {
  const target = verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL);
  check("disposable_target_verified", true, target.verified, target.verified);
  pg = createPgClient(process.env.DATABASE_URL);
  redis = createRedisClient(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL);
  await pg.connect(); await redis.connect();
  process.env.PHASE1_DISABLE_ADMIN = "true";
  runtime = await loadMedusaRuntime({ entryPoints: true });
  cartService = runtime.container.resolve(Modules.CART);
  regionService = runtime.container.resolve(Modules.REGION);
  salesChannelService = runtime.container.resolve(Modules.SALES_CHANNEL);
  apiKeyService = runtime.container.resolve(Modules.API_KEY);
  locking = runtime.container.resolve(Modules.LOCKING);
  const provider = locking.providerService_.retrieveProviderRegistration(locking.defaultProviderId);
  containerDetails = { realMedusa: true, realNativeApiRoutes: true, config: "apps/backend/medusa-config.ts", provider: provider.constructor.name };
  server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  apiKey = await apiKeyService.createApiKeys({ title: id + " disposable", type: "publishable", created_by: "phase1-test" });
  // Empty service-created carts do not exercise the prohibited TP-01 batch
  // variant/checkout_line_key cart creation case or POST /store/carts.
  region = await regionService.createRegions({ name: id + " disposable region", currency_code: "egp", countries: ["eg"] });
  salesChannel = await salesChannelService.createSalesChannels({ name: id + " disposable channel" });
  cart = await cartService.createCarts({ currency_code: "egp", region_id: region.id,
    sales_channel_id: salesChannel.id, metadata: { fixture: id } });
  await runtime.container.resolve("batch_inventory").createCartCheckoutSessions({
    cart_id: cart.id, current_attempt_id: randomUUID(), epoch: 1, status: "in_progress",
  });
  await pg.query(`INSERT INTO idempotency_key
    (key, request_path, request_hash, lease_owner_id, expires_at, locked_at, last_heartbeat_at)
    VALUES ($1, $2, $3, $4, NOW() + INTERVAL '14 days',
      NOW() - INTERVAL '121 seconds', NOW() - INTERVAL '121 seconds')`,
    [key, "/store/carts/" + cart.id + "/complete", "a".repeat(64), ownerId]);
  physicalKey = provider.keyNamePrefix + "cart:" + cart.id;
  if (id === "TP-04a") await locking.acquire("cart:" + cart.id, { ownerId, expire: 120 });
  const request = async (suffix, body, method = "POST") => {
    const response = await fetch(base + "/store/carts/" + cart.id + suffix, {
      method, headers: { "content-type": "application/json", "x-publishable-api-key": apiKey.token },
      body: method === "GET" ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() };
  };
  const control = await request("", null, "GET");
  check("real_native_cart_get_control", 200, control.status, control.status === 200 && control.body.cart?.id === cart.id);
  const snapshot = async () => ({
    cart: (await pg.query("SELECT * FROM cart WHERE id=$1", [cart.id])).rows,
    session: (await pg.query("SELECT * FROM cart_checkout_session WHERE cart_id=$1", [cart.id])).rows,
    lease: (await pg.query("SELECT * FROM idempotency_key WHERE key=$1", [key])).rows,
    lines: (await pg.query("SELECT * FROM cart_line_item WHERE cart_id=$1 ORDER BY id", [cart.id])).rows,
    reservations: (await pg.query("SELECT * FROM cart_batch_reservation WHERE cart_id=$1 ORDER BY id", [cart.id])).rows,
  });
  dbBefore = await snapshot();
  check("cart_and_session_cardinality", [1, 1, 1], [dbBefore.cart.length, dbBefore.session.length, dbBefore.lease.length],
    dbBefore.cart.length === 1 && dbBefore.session.length === 1 && dbBefore.lease.length === 1);
  if (id === "TP-04b") {
    const age = await pg.query("SELECT EXTRACT(EPOCH FROM NOW()-last_heartbeat_at)::float8 AS age FROM idempotency_key WHERE key=$1", [key]);
    check("heartbeat_older_than_recovery_threshold", ">120s", age.rows[0].age, age.rows[0].age > 120);
  }
  for (const [suffix, body] of [["/line-items", { variant_id: "variant_not_reached_by_guard", quantity: 1 }], ["", { metadata: { attempted_mutation: id } }]]) {
    const response = await request(suffix, body);
    events.push({ event: "native_mutation_rejected", suffix, at: new Date().toISOString(), response });
    check("native_http_mutation_rejected_" + (suffix || "cart"), 409, response,
      response.status === 409 && response.body.message === "Cart checkout currently in progress; mutations locked");
  }
  dbAfter = await snapshot();
  check("all_scoped_database_rows_unchanged", dbBefore, dbAfter, JSON.stringify(dbBefore) === JSON.stringify(dbAfter));
  if (id === "TP-04a") {
    const observedOwner = await redis.get(physicalKey), ttl = await redis.ttl(physicalKey);
    check("checkout_owner_and_ttl_preserved", { ownerId, positiveTtl: true }, { ownerId: observedOwner, ttl }, observedOwner === ownerId && ttl > 0);
    await locking.release("cart:" + cart.id, { ownerId });
  }
  // This is a deliberate test-state transition, not execution/acceptance of
  // the future recovery controller or stock compensation protocol.
  await pg.query("UPDATE cart_checkout_session SET status='aborted', epoch=epoch+1 WHERE cart_id=$1", [cart.id]);
  let allowed;
  if (id === "TP-04a") {
    // Gate the real native workflow rather than replacing it. This makes the
    // middleware's response-spanning lock and a second request observable.
    const engine = runtime.container.resolve(Modules.WORKFLOW_ENGINE);
    const originalRun = engine.run;
    let enter, release;
    const entered = new Promise((resolve) => { enter = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    engine.run = async function(workflowId, args) {
      if (workflowId === "update-cart" && args?.input?.id === cart.id) {
        enter(); await gate;
      }
      return originalRun.call(this, workflowId, args);
    };
    const first = request("", { metadata: { fixture: id, after_abort: true } });
    try {
      await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(new Error("Native workflow gate was not reached")), 5000))]);
      events.push({ event: "native_update_waiting_at_gate", at: new Date().toISOString() });
      const observedOwner = await redis.get(physicalKey), observedTtl = await redis.ttl(physicalKey);
      check("mutation_lock_held_while_real_handler_pending", "execute owner and TTL in (0,15]",
        { owner: observedOwner, ttl: observedTtl }, observedOwner?.startsWith("execute:") && observedTtl > 0 && observedTtl <= 15);
      const contender = await request("", { metadata: { contender_should_not_write: true } });
      check("second_mutation_rejected_while_handler_pending", 409, contender, contender.status === 409 && contender.body.type === "conflict");
      const during = await pg.query("SELECT metadata FROM cart WHERE id=$1", [cart.id]);
      check("pending_native_update_and_contender_have_not_written", dbBefore.cart[0].metadata, during.rows[0]?.metadata,
        JSON.stringify(dbBefore.cart[0].metadata) === JSON.stringify(during.rows[0]?.metadata));
      events.push({ event: "contender_rejected_before_first_update", at: new Date().toISOString() });
    } finally {
      release(); engine.run = originalRun;
      allowed = await first;
    }
  } else {
    allowed = await request("", { metadata: { fixture: id, after_abort: true } });
  }
  check("native_cart_mutation_allowed_after_aborted_fixture", 200, allowed.status,
    allowed.status === 200 && allowed.body.cart?.metadata?.after_abort === true);
  const persisted = await pg.query("SELECT metadata FROM cart WHERE id=$1", [cart.id]);
  check("allowed_native_mutation_persisted", true, persisted.rows[0]?.metadata?.after_abort, persisted.rows[0]?.metadata?.after_abort === true);
  status = "passed";
} catch (error) {
  blocker = error.stack || String(error);
  console.error(blocker);
  assertions.push({ name: "execution_completed_without_exception", expected: true, actual: error.message, passed: false });
} finally {
  const clean = async (name, fn) => { try { await fn(); } catch (error) { cleanupErrors.push(name + ": " + error.message); } };
  if (server) await clean("HTTP server", () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  if (locking && cart) await clean("checkout lock", () => locking.release("cart:" + cart.id, { ownerId }));
  if (pg && cart) {
    await clean("session fixture", () => pg.query("DELETE FROM cart_checkout_session WHERE cart_id=$1", [cart.id]));
    await clean("lease fixture", () => pg.query("DELETE FROM idempotency_key WHERE key=$1", [key]));
    await clean("cart fixture", () => cartService.deleteCarts(cart.id));
    await clean("cleanup verification", async () => {
      const result = await pg.query(`SELECT
        (SELECT COUNT(*)::int FROM cart WHERE id=$1) AS carts,
        (SELECT COUNT(*)::int FROM cart_checkout_session WHERE cart_id=$1) AS sessions,
        (SELECT COUNT(*)::int FROM idempotency_key WHERE key=$2) AS leases`, [cart.id, key]);
      const row = result.rows[0];
      check("fixture_rows_removed", { carts: 0, sessions: 0, leases: 0 }, row, row.carts === 0 && row.sessions === 0 && row.leases === 0);
    });
  }
  if (apiKey) await clean("publishable key", async () => {
    await apiKeyService.revoke(apiKey.id, { revoked_by: "phase1-test" });
    await apiKeyService.deleteApiKeys(apiKey.id);
  });
  if (region) await clean("region fixture", () => regionService.deleteRegions(region.id));
  if (salesChannel) await clean("sales channel fixture", () => salesChannelService.deleteSalesChannels(salesChannel.id));
  if (runtime) await clean("Medusa shutdown", () => runtime.shutdown());
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors });
}
if (cleanupErrors.length) {
  status = "failed"; blocker = (blocker || "") + "\n" + cleanupErrors.join("\n");
  console.error("Cleanup failures: " + cleanupErrors.join("; "));
  assertions.push({ name: "cleanup_succeeded", expected: [], actual: cleanupErrors, passed: false });
}
const exitCode = status === "passed" ? 0 : 1;
console.log(`${id} Assertion Summary: ${assertions.filter((item) => item.passed).length}/${assertions.length} passed.`);
await writeTpEvidence({ evidenceDir: path.join(repositoryRoot, "artifacts/tp-evidence", id), tpId: id,
  title: "Native Store API cart mutation guard", batch: "B", status, blocker, assertions, exitCode,
  startedAt, ...metadata, dbBefore, dbAfter, containerDetails, interleaving: events,
  testCommand: "node apps/backend/scripts/test-cart-mutation-http.mjs " + id,
  assessmentType: "real native HTTP mutation routes; no cart creation TP-01 or recovery-controller execution",
  note: "The aborted-state positive control changes a test fixture directly; it does not prove the canonical recovery/compensation protocol.",
});
process.exit(exitCode);
