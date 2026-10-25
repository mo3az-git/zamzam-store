import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { MedusaError } = require("@medusajs/framework/utils");
const { RedisLockingProvider } = require("@medusajs/locking-redis/dist/services/redis-lock");

/**
 * Phase 1 compatibility adapter.
 *
 * The candidate upstream provider acquires multi-key locks concurrently and
 * its releaseAll path separates owner reads from deletion. This adapter uses
 * a single Redis Lua operation for all-or-nothing multi-key acquisition and
 * the upstream provider's atomic owner-checked release script.
 *
 * Keep this adapter limited to the spike until its regression evidence and
 * Medusa module-loader behavior have been reviewed.
 */
export class SafeRedisLockingProvider extends RedisLockingProvider {
  constructor(dependencies, options) {
    super(dependencies, options);

    this.redisClient.defineCommand("acquireManyLocks", {
      numberOfKeys: 0,
      lua: `
        local ownerId = ARGV[1]
        local ttl = tonumber(ARGV[2])
        local count = #KEYS

        -- Validate the complete key set before mutating any key.
        for i = 1, count do
          local key = KEYS[i]
          local currentOwner = redis.call("GET", key)
          if currentOwner and currentOwner ~= ownerId then
            return 0
          end
        end

        -- Redis executes the script atomically, so no caller can observe a
        -- partially acquired multi-key set.
        for i = 1, count do
          local key = KEYS[i]
          if ttl and ttl > 0 then
            redis.call("SET", key, ownerId, "EX", ttl)
          else
            redis.call("SET", key, ownerId)
          end
        end

        return 1
      `,
    });
  }

  async acquire_(keys, args, cancellationToken) {
    const logicalKeys = [...new Set(Array.isArray(keys) ? keys : [keys])].sort();
    const timeout = Math.max(args?.expire ?? this.waitLockingTimeout, 1);
    const ttl = args?.expire ? timeout : 0;
    const ownerId = args?.ownerId ?? "*";
    const awaitQueue = args?.awaitQueue ?? false;
    let retryDelay = this.defaultRetryInterval;

    while (true) {
      if (cancellationToken?.cancelled) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "Timed-out acquiring lock."
        );
      }

      const redisKeys = logicalKeys.map((key) => `${this.keyNamePrefix}${key}`);
      // ioredis treats the first argument as the dynamic KEYS count when
      // numberOfKeys is 0; remaining arguments are KEYS first, then ARGV.
      const result = await this.redisClient.acquireManyLocks(
        redisKeys.length,
        ...redisKeys,
        ownerId,
        ttl
      );

      if (result === 1) {
        return;
      }

      if (!awaitQueue) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          `Failed to acquire lock for key "${logicalKeys.join('", "')}"`
        );
      }

      const jitteredDelay = retryDelay * (0.5 + Math.random() * 0.5);
      await delay(jitteredDelay);
      retryDelay = Math.min(
        retryDelay * this.backoffFactor,
        this.maximumRetryInterval
      );
    }
  }

  async releaseAll(args) {
    const ownerId = args?.ownerId ?? "*";
    const pattern = `${this.keyNamePrefix}*`;
    let cursor = "0";

    do {
      const [nextCursor, keys] = await this.redisClient.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;

      // releaseLock performs owner comparison and deletion in one Lua call.
      // Do not split the comparison and deletion into separate Redis commands.
      await Promise.all(
        keys.map((key) => this.redisClient.releaseLock(key, ownerId))
      );
    } while (cursor !== "0");
  }
}

export default SafeRedisLockingProvider;
