import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { MedusaError, ModuleProvider, Modules } = require("@medusajs/framework/utils");
const { asValue } = require("@medusajs/framework/awilix");
const RedisModule = require("ioredis");
const Redis = RedisModule.default ?? RedisModule;
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
      // Keep one real Redis key in KEYS and pass any additional keys in ARGV.
      // This avoids depending on ioredis' dynamic-key-count convention.
      numberOfKeys: 1,
      lua: `
        local additionalCount = tonumber(ARGV[1]) or 0
        local keys = { KEYS[1] }
        for i = 1, additionalCount do
          table.insert(keys, ARGV[1 + i])
        end

        local ownerIndex = 2 + additionalCount
        local ownerId = ARGV[ownerIndex]
        local ttl = tonumber(ARGV[ownerIndex + 1])

        -- Validate the complete key set before mutating any key.
        for i = 1, #keys do
          local currentOwner = redis.call("GET", keys[i])
          if currentOwner and currentOwner ~= ownerId then
            return 0
          end
        end

        -- Redis executes the script atomically, so no caller can observe a
        -- partially acquired multi-key set.
        for i = 1, #keys do
          if ttl and ttl > 0 then
            redis.call("SET", keys[i], ownerId, "EX", ttl)
          else
            redis.call("SET", keys[i], ownerId)
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
      const [firstKey, ...additionalKeys] = redisKeys;
      const result = await this.redisClient.acquireManyLocks(
        firstKey,
        additionalKeys.length,
        ...additionalKeys,
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


/**
 * Medusa provider loader. Mirrors the upstream Redis provider's dependency
 * registration while keeping the tested compatibility service as the service.
 */
async function LockingRedisLoader({ container, logger, options }) {
  const { redisUrl, redisOptions, namespace } = options ?? {};
  if (!redisUrl) {
    throw new Error('No "redisUrl" provided for the Phase 1 locking-redis provider.');
  }

  const connection = new Redis(redisUrl, {
    lazyConnect: true,
    ...(redisOptions ?? {}),
  });

  try {
    await connection.connect();
    logger?.info('Connection to Redis in "locking-redis" provider established');
  } catch (error) {
    logger?.error('An error occurred while connecting to Redis in "locking-redis" provider: ' + error);
    throw error;
  }

  container.register({
    redisClient: asValue(connection),
    prefix: asValue(namespace ?? "medusa_lock:"),
  });
}

export default ModuleProvider(Modules.LOCKING, {
  services: [SafeRedisLockingProvider],
  loaders: [LockingRedisLoader],
});
