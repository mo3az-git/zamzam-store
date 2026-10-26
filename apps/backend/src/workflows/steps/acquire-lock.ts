/**
 * Canonical Lock Steps
 *
 * Analysis & Comparison with Medusa Core:
 * Medusa exports `acquireLockStep` and `releaseLockStep` directly from `@medusajs/medusa/core-flows`.
 * - Native `@medusajs/medusa/core-flows` `acquireLockStep`:
 *   - Automatically skips re-acquisition inside sub-workflows via `parentStepIdempotencyKey` check
 *     (`if (isSubWorkflow && !data.executeOnSubWorkflow) return StepResponse.skip()`).
 *   - Supports `key`, `ttl`, `timeout`, `retryInterval`, `ownerId`, and `provider`.
 *   - Registers full compensation logic (`releaseLockStep`) to release the acquired lock on workflow failure.
 * - Re-exporting Medusa core-flows steps directly avoids duplicate code and validates upstream
 *   Medusa v2 workflow locking semantics against the configured Redis locking provider.
 */

export {
  acquireLockStep,
  acquireLockStepId,
  releaseLockStep,
  releaseLockStepId,
} from "@medusajs/medusa/core-flows"
