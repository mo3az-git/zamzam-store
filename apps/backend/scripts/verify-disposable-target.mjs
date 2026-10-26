/**
 * Validates that connection URLs target exclusively disposable local/test infrastructure.
 * Rejects any external, cloud, unapproved, or production database/Redis target.
 */
export function verifyDisposableTargetServices(dbUrlStr, rdUrlStr) {
  if (!dbUrlStr || typeof dbUrlStr !== "string") {
    throw new Error("DATABASE_URL must be defined and non-empty.");
  }
  if (!rdUrlStr || typeof rdUrlStr !== "string") {
    throw new Error("LOCKING_REDIS_URL / REDIS_URL must be defined and non-empty.");
  }

  let parsedDb;
  let parsedRd;
  try {
    parsedDb = new URL(dbUrlStr);
  } catch (err) {
    throw new Error(`Invalid PostgreSQL connection URL format: ${err.message}`);
  }
  try {
    parsedRd = new URL(rdUrlStr);
  } catch (err) {
    throw new Error(`Invalid Redis connection URL format: ${err.message}`);
  }

  // 1. Strict Protocol Validation
  const validDbProtocols = ["postgres:", "postgresql:"];
  if (!validDbProtocols.includes(parsedDb.protocol)) {
    throw new Error(`Safety refusal: Invalid PostgreSQL protocol '${parsedDb.protocol}'. Expected postgres: or postgresql:`);
  }
  if (parsedRd.protocol !== "redis:" && parsedRd.protocol !== "rediss:") {
    throw new Error(`Safety refusal: Invalid Redis protocol '${parsedRd.protocol}'. Expected redis: or rediss:`);
  }

  // 2. Strict Hostname Allowlist (NO CI BYPASS)
  // Hostnames permitted: loopback addresses and Docker container service aliases
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "postgres", "redis"]);
  const dbHost = parsedDb.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const rdHost = parsedRd.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (!allowedHosts.has(dbHost) && !allowedHosts.has("[" + dbHost + "]")) {
    throw new Error(
      `Safety refusal: PostgreSQL host '${dbHost}' is not in the permitted disposable test hosts allowlist (${[...allowedHosts].join(", ")}).`
    );
  }
  if (!allowedHosts.has(rdHost) && !allowedHosts.has("[" + rdHost + "]")) {
    throw new Error(
      `Safety refusal: Redis host '${rdHost}' is not in the permitted disposable test hosts allowlist (${[...allowedHosts].join(", ")}).`
    );
  }

  // 3. Strict Database Name Allowlist
  const dbName = parsedDb.pathname.replace(/^\//, "").trim();
  if (!dbName) {
    throw new Error("Safety refusal: PostgreSQL connection URL must specify an explicit database name.");
  }

  // Pinned disposable test database names:
  const isAllowedDbName =
    dbName === "zamzam_spike" ||
    dbName === "postgres" ||
    dbName === "zamzam_test" ||
    /^zamzam_rollback_[a-f0-9_]{16,64}$/.test(dbName) ||
    /^test_[a-z0-9_]+$/.test(dbName);

  if (!isAllowedDbName) {
    throw new Error(
      `Safety refusal: Database name '${dbName}' is not an approved disposable test database (approved: 'zamzam_spike', 'postgres', 'zamzam_test', or 'zamzam_rollback_<uuid>').`
    );
  }

  // 4. Ports
  const dbPort = parsedDb.port ? parseInt(parsedDb.port, 10) : 5432;
  const rdPort = parsedRd.port ? parseInt(parsedRd.port, 10) : 6379;

  // 5. Forbidden Keywords (defense-in-depth)
  const combined = (parsedDb.href + " " + parsedRd.href).toLowerCase();
  const forbiddenKeywords = ["prod", "production", "live", "main_db", "aurora", "rds", "cloudsql"];
  for (const kw of forbiddenKeywords) {
    if (combined.includes(kw)) {
      throw new Error(`Safety refusal: Connection string contains forbidden keyword '${kw}'.`);
    }
  }

  return {
    pgHost: dbHost,
    pgPort: dbPort,
    pgDatabase: dbName,
    redisHost: rdHost,
    redisPort: rdPort,
    verified: true,
  };
}

export function runDisposableValidatorSelfChecks() {
  const cases = [
    // Permitted Targets
    {
      name: "Standard local IPv4 loopback (CI defaults)",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: true,
    },
    {
      name: "Localhost alias with default postgres db",
      dbUrl: "postgres://postgres:secret@localhost:5432/postgres",
      redisUrl: "redis://localhost:6379",
      expectPass: true,
    },
    {
      name: "Docker service alias hosts (postgres / redis)",
      dbUrl: "postgresql://postgres:secret@postgres:5432/zamzam_spike",
      redisUrl: "redis://redis:6379",
      expectPass: true,
    },
    {
      name: "IPv6 loopback [::1]",
      dbUrl: "postgres://postgres:secret@[::1]:5432/zamzam_test",
      redisUrl: "redis://[::1]:6379",
      expectPass: true,
    },
    {
      name: "Dynamic rollback disposable database name (zamzam_rollback_<uuid>)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_rollback_daa4d165_780d_4b00_bae2_f4a827a12831",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: true,
    },
    {
      name: "Allowed test_ prefix database and rediss scheme",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/test_backend",
      redisUrl: "rediss://127.0.0.1:6379",
      expectPass: true,
    },

    // Rejected Targets (Safety Refusals)
    {
      name: "Missing DATABASE_URL (empty string)",
      dbUrl: "",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "DATABASE_URL must be defined and non-empty",
    },
    {
      name: "Missing REDIS_URL (undefined)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: undefined,
      expectPass: false,
      expectedError: "LOCKING_REDIS_URL / REDIS_URL must be defined and non-empty",
    },
    {
      name: "Remote external PostgreSQL database host",
      dbUrl: "postgres://postgres:secret@db.zamzamstore.com:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "AWS RDS host even if process.env.CI is true (bypass eliminated)",
      dbUrl: "postgres://postgres:secret@zamzam.c3xyz.rds.amazonaws.com:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      setup: () => {
        process.env.CI = "true";
      },
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "Non-loopback LAN host IP address",
      dbUrl: "postgres://postgres:secret@192.168.1.105:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "Unapproved database name ('zamzam' instead of 'zamzam_spike')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Production database name ('zamzam_production')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_production",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "Safety refusal",
    },
    {
      name: "Empty / root database pathname",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "must specify an explicit database name",
    },
    {
      name: "Remote Redis cache host",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://cache.internal.domain:6379",
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "Invalid PostgreSQL protocol scheme (mysql:)",
      dbUrl: "mysql://postgres:secret@127.0.0.1:3306/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "Invalid PostgreSQL protocol",
    },
    {
      name: "Invalid Redis protocol scheme (http:)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "http://127.0.0.1:6379",
      expectPass: false,
      expectedError: "Invalid Redis protocol",
    },
    {
      name: "Forbidden keyword in query parameter ('production')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike?target=production",
      redisUrl: "redis://127.0.0.1:6379",
      expectPass: false,
      expectedError: "contains forbidden keyword",
    },
  ];

  const results = [];
  for (const tc of cases) {
    if (tc.setup) tc.setup();
    let threw = false;
    let err = null;
    let res = null;
    try {
      res = verifyDisposableTargetServices(tc.dbUrl, tc.redisUrl);
    } catch (e) {
      threw = true;
      err = e;
    }

    if (tc.expectPass) {
      if (threw) {
        results.push({ name: tc.name, passed: false, detail: `Expected pass, threw: ${err.message}` });
      } else {
        results.push({ name: tc.name, passed: true, detail: `Verified ${res.pgHost}:${res.pgPort}/${res.pgDatabase}` });
      }
    } else {
      if (!threw) {
        results.push({ name: tc.name, passed: false, detail: "Expected refusal, but passed" });
      } else if (tc.expectedError && !err.message.includes(tc.expectedError)) {
        results.push({ name: tc.name, passed: false, detail: `Message "${err.message}" did not contain "${tc.expectedError}"` });
      } else {
        results.push({ name: tc.name, passed: true, detail: `Refused: ${err.message}` });
      }
    }
  }

  const failedCount = results.filter((r) => !r.passed).length;
  return {
    total: results.length,
    passed: results.length - failedCount,
    failed: failedCount,
    allPassed: failedCount === 0,
    results,
  };
}
