import path from "node:path"
import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", path.resolve(process.cwd(), "../.."))

const nodeEnv = process.env.NODE_ENV || "development"
const redisUrl = process.env.REDIS_URL || (nodeEnv === "production" ? undefined : "redis://localhost:6379")
const lockingRedisUrl = process.env.LOCKING_REDIS_URL || redisUrl

if (nodeEnv === "production" && (!redisUrl || !lockingRedisUrl)) {
  throw new Error("REDIS_URL and LOCKING_REDIS_URL must be configured in production.")
}

function requireSecret(name: string, localFallback: string): string {
  const configured = process.env[name]

  if (configured) {
    if (nodeEnv === "production" && configured.length < 32) {
      throw new Error(name + " must contain at least 32 characters in production.")
    }
    return configured
  }

  if (nodeEnv === "production") {
    throw new Error(name + " must be configured in production.")
  }

  return localFallback
}

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:8000,http://localhost:9000",
      jwtSecret: requireSecret("JWT_SECRET", "local-only-jwt-secret-do-not-use-in-production"),
      cookieSecret: requireSecret("COOKIE_SECRET", "local-only-cookie-secret-do-not-use-in-production")
    }
  },
  modules: [
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: {
              redisUrl: lockingRedisUrl
            }
          }
        ]
      }
    }
  ]
})
