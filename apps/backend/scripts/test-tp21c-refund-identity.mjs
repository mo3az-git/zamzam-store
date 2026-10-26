import { randomBytes, createDecipheriv, createHmac, createHash } from "node:crypto";
import path from "node:path";
import { registerTsNode, repositoryRoot, getSystemMetadata, verifyDisposableTargetServices,
  loadMedusaRuntime, createPgClient, createRedisClient, safeCloseClients, writeTpEvidence } from "./shared/tp-harness.mjs";

registerTsNode();
const startedAt = new Date().toISOString(), metadata = await getSystemMetadata();
const assertions = [], cleanupErrors = [];
const check = (name, expected, actual, passed) => {
  assertions.push({ name, expected, actual, passed: Boolean(passed) });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(actual)}`);
  if (!passed) throw new Error(name);
};
let runtime, pg, redis, dbBefore, dbAfter, containerDetails;
let status = "failed", blocker = null;
const originalHmac = process.env.HMAC_KEY, originalEncryption = process.env.REFUND_ENCRYPTION_KEY;
try {
  const target = verifyDisposableTargetServices(process.env.DATABASE_URL, process.env.LOCKING_REDIS_URL || process.env.REDIS_URL);
  check("disposable_target_verified", true, target.verified, target.verified);
  pg = createPgClient(process.env.DATABASE_URL); await pg.connect();
  redis = createRedisClient(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL); await redis.connect();
  const pong = await redis.ping();
  check("real_redis_connected", "PONG", pong, pong === "PONG" && redis.status === "ready");
  process.env.HMAC_KEY = randomBytes(32).toString("hex");
  process.env.REFUND_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  runtime = await loadMedusaRuntime();
  const service = runtime.container.resolve("system_security");
  containerDetails = { medusaConfigFile: "apps/backend/medusa-config.ts", systemSecurityModuleResolved: Boolean(service) };
  const snapshot = async () => ({ counts: (await pg.query(`SELECT
    (SELECT COUNT(*)::int FROM idempotency_key) AS leases,
    (SELECT COUNT(*)::int FROM cart_checkout_session) AS sessions,
    (SELECT COUNT(*)::int FROM "order") AS orders`)).rows });
  dbBefore = await snapshot();
  const input = { order_id: "order_synthetic_identity_only", return_request_id: "ret_synthetic_identity_only",
    amount: "50.00", refund_method: "manual_bank_wire",
    recipient: { bank: "Example test bank", account: "000000000000", name: "Synthetic test recipient" } };
  const first = service.prepareRefundIdentity(input);
  const second = service.prepareRefundIdentity({ ...input, amount: "050.0", recipient: { name: input.recipient.name, account: input.recipient.account, bank: input.recipient.bank } });
  const envelopeA = first.encrypted_recipient_details, envelopeB = second.encrypted_recipient_details;
  check("fresh_nonce_and_ciphertext", { nonceDifferent: true, ciphertextDifferent: true },
    { nonceDifferent: envelopeA.nonce !== envelopeB.nonce, ciphertextDifferent: envelopeA.ciphertext !== envelopeB.ciphertext },
    envelopeA.nonce !== envelopeB.nonce && envelopeA.ciphertext !== envelopeB.ciphertext);
  check("fingerprint_and_request_hash_stable", { fingerprintEqual: true, requestEqual: true },
    { fingerprintEqual: first.recipient_fingerprint === second.recipient_fingerprint, requestEqual: first.request_hash === second.request_hash },
    first.recipient_fingerprint === second.recipient_fingerprint && first.request_hash === second.request_hash);
  const normalized = JSON.stringify(Object.fromEntries(Object.entries(input.recipient).sort(([a],[b]) => a.localeCompare(b))));
  const expectedFingerprint = createHmac("sha256", process.env.HMAC_KEY).update(normalized).digest("hex");
  const expectedHash = createHash("sha256").update([input.order_id, input.return_request_id, "50.00", input.refund_method, expectedFingerprint].join(":")).digest("hex");
  check("documented_hmac_and_colon_tuple_contract", { fingerprint: expectedFingerprint, requestHash: expectedHash },
    { fingerprint: first.recipient_fingerprint, requestHash: first.request_hash }, first.recipient_fingerprint === expectedFingerprint && first.request_hash === expectedHash);
  for (const envelope of [envelopeA, envelopeB]) {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.REFUND_ENCRYPTION_KEY, "hex"), Buffer.from(envelope.nonce, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const restored = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
    check("fresh_envelope_decrypts_correctly_" + assertions.length, true, restored === normalized, restored === normalized);
    const tampered = Buffer.from(envelope.ciphertext, "base64"); tampered[0] ^= 1;
    let rejected = false;
    try {
      const invalid = createDecipheriv("aes-256-gcm", Buffer.from(process.env.REFUND_ENCRYPTION_KEY, "hex"), Buffer.from(envelope.nonce, "base64"));
      invalid.setAuthTag(Buffer.from(envelope.tag, "base64")); invalid.update(tampered); invalid.final();
    } catch { rejected = true; }
    check("tampered_ciphertext_rejected_" + assertions.length, true, rejected, rejected);
  }
  const changed = service.prepareRefundIdentity({ ...input, recipient: { ...input.recipient, account: "000000000001" } });
  check("different_recipient_changes_both_identities", true,
    changed.recipient_fingerprint !== first.recipient_fingerprint && changed.request_hash !== first.request_hash,
    changed.recipient_fingerprint !== first.recipient_fingerprint && changed.request_hash !== first.request_hash);
  const alteredAmount = service.prepareRefundIdentity({ ...input, amount: "50.01" });
  check("amount_changes_request_not_recipient_fingerprint", true,
    alteredAmount.request_hash !== first.request_hash && alteredAmount.recipient_fingerprint === first.recipient_fingerprint,
    alteredAmount.request_hash !== first.request_hash && alteredAmount.recipient_fingerprint === first.recipient_fingerprint);
  dbAfter = await snapshot();
  check("no_commerce_or_lease_writes", dbBefore, dbAfter, JSON.stringify(dbBefore) === JSON.stringify(dbAfter));
  status = "passed";
} catch (error) {
  blocker = error.stack || String(error); console.error(blocker);
  assertions.push({ name: "execution_completed", expected: true, actual: error.message, passed: false });
} finally {
  if (runtime) { try { await runtime.shutdown(); } catch (error) { cleanupErrors.push(error.message); } }
  await safeCloseClients({ pgClient: pg, redisClient: redis, cleanupErrors });
  if (originalHmac === undefined) delete process.env.HMAC_KEY; else process.env.HMAC_KEY = originalHmac;
  if (originalEncryption === undefined) delete process.env.REFUND_ENCRYPTION_KEY; else process.env.REFUND_ENCRYPTION_KEY = originalEncryption;
}
if (cleanupErrors.length) { status = "failed"; blocker = (blocker || "") + " cleanup: " + cleanupErrors.join("; "); }
console.log(`TP-21c Assertion Summary: ${assertions.filter((item) => item.passed).length}/${assertions.length} passed.`);
await writeTpEvidence({ evidenceDir: path.join(repositoryRoot, "artifacts/tp-evidence/TP-21c"), tpId: "TP-21c", title: "Refund identity under fresh encryption nonces",
  batch: "F", status, startedAt, ...metadata, blocker, exitCode: status === "passed" ? 0 : 1, assertions, dbBefore, dbAfter, containerDetails,
  testCommand: "node apps/backend/scripts/test-tp21c-refund-identity.mjs",
  assessmentType: "real Medusa system_security cryptography component; no refund persistence or payout-provider claim",
});
process.exit(status === "passed" ? 0 : 1);
