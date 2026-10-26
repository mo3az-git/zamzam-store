/**
 * Validates that connection URLs target exclusively approved disposable local/test infrastructure.
 * Rejects any external, cloud, unapproved, ambiguous, non-default-port, or production database/Redis target
 * prior to attempting any connection or write operation.
 *
 * NOTE ON DISPOSABLE TARGET SAFETY & LIMITS OF ENVIRONMENT-BASED CHECKS:
 * Environment variables and URL/hostname/database-name validations reduce the risk of accidental misuse
 * and protect against unintended connections to production, staging, or remote infrastructure.
 * However, environment-based checks do NOT cryptographically prove that an underlying database or Redis
 * service is disposable. A local service running on 127.0.0.1:5432/zamzam_spike may still be persistent
 * across test runs if configured that way by a developer.
 *
 * Therefore:
 * 1. Manual/local execution requires an explicit opt-in flag (PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES=true)
 *    to acknowledge that the target local services are disposable and safe to mutate.
 * 2. CI automated execution requires an explicit, narrowly scoped profile configured by the GitHub Actions
 *    workflow for the relevant test step (PHASE1_DISPOSABLE_TEST_PROFILE=ci_ephemeral_service).
 *    GITHUB_ACTIONS=true alone does NOT authorize execution, preventing accidental execution if that variable
 *    is set in a local shell.
 * 3. Both profiles strictly enforce all URL, host, port, database-name, and keyword checks before any
 *    connection or write operation is permitted.
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

  // 2. Strict Hostname Validation (NO GENERIC CI=true BYPASS)
  // Permitted hosts: exact loopback addresses and dedicated Docker service aliases
  const allowedDbHosts = new Set(["127.0.0.1", "localhost", "::1", "postgres"]);
  const allowedRdHosts = new Set(["127.0.0.1", "localhost", "::1", "redis"]);

  const dbHost = parsedDb.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const rdHost = parsedRd.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Reject ambiguous local targets
  if (dbHost === "0.0.0.0" || (dbHost.startsWith("127.") && dbHost !== "127.0.0.1")) {
    throw new Error(`Safety refusal: PostgreSQL host '${dbHost}' is ambiguous. Only exact loopback 127.0.0.1 is approved.`);
  }
  if (rdHost === "0.0.0.0" || (rdHost.startsWith("127.") && rdHost !== "127.0.0.1")) {
    throw new Error(`Safety refusal: Redis host '${rdHost}' is ambiguous. Only exact loopback 127.0.0.1 is approved.`);
  }

  // Reject cross-service aliases
  if (dbHost === "redis") {
    throw new Error("Safety refusal: Docker service host 'redis' cannot be used as PostgreSQL host.");
  }
  if (rdHost === "postgres") {
    throw new Error("Safety refusal: Docker service host 'postgres' cannot be used as Redis host.");
  }

  if (!allowedDbHosts.has(dbHost)) {
    throw new Error(
      `Safety refusal: PostgreSQL host '${dbHost}' is not in the permitted disposable test hosts allowlist (${[...allowedDbHosts].join(", ")}).`
    );
  }
  if (!allowedRdHosts.has(rdHost)) {
    throw new Error(
      `Safety refusal: Redis host '${rdHost}' is not in the permitted disposable test hosts allowlist (${[...allowedRdHosts].join(", ")}).`
    );
  }

  // 3. Strict Port Validation (Default Ports Only)
  // If port is specified, it must match the standard port for the disposable service
  const dbPort = parsedDb.port ? parseInt(parsedDb.port, 10) : 5432;
  if (parsedDb.port && dbPort !== 5432) {
    throw new Error(`Safety refusal: Non-default or unapproved PostgreSQL port '${parsedDb.port}'. Only standard port 5432 is approved.`);
  }

  const rdPort = parsedRd.port ? parseInt(parsedRd.port, 10) : 6379;
  if (parsedRd.port && rdPort !== 6379) {
    throw new Error(`Safety refusal: Non-default or unapproved Redis port '${parsedRd.port}'. Only standard port 6379 is approved.`);
  }

  // 4. Strict Database Name Allowlist (Approved Documented Test Databases Only)
  const dbName = parsedDb.pathname.replace(/^\//, "").trim();
  if (!dbName) {
    throw new Error("Safety refusal: PostgreSQL connection URL must specify an explicit database name.");
  }

  // Approved disposable database names:
  // - "zamzam_spike": standard Phase 1 spike test database
  // - "zamzam_rollback_<uuid>": dynamic isolated database generated by test-migration-rollback-isolated.mjs,
  //   matching the exact generator format: crypto.randomUUID().replace(/-/g, "_")
  //   (32 hex chars grouped as 8_4_4_4_12, e.g. zamzam_rollback_daa4d165_780d_4b00_bae2_f4a827a12831)
  // (Generic allowances such as 'postgres', 'zamzam_test', or 'test_*' are strictly rejected)
  const isApprovedDbName =
    dbName === "zamzam_spike" ||
    /^zamzam_rollback_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/.test(dbName);

  if (!isApprovedDbName) {
    throw new Error(
      `Safety refusal: Database name '${dbName}' is not an approved disposable test database (approved: 'zamzam_spike' or 'zamzam_rollback_<uuid>').`
    );
  }

  // 5. Forbidden Keywords (defense-in-depth against cloud/production connections)
  const combined = (parsedDb.href + " " + parsedRd.href).toLowerCase();
  const forbiddenKeywords = ["prod", "production", "live", "main_db", "aurora", "rds", "cloudsql"];
  for (const kw of forbiddenKeywords) {
    if (combined.includes(kw)) {
      throw new Error(`Safety refusal: Connection string contains forbidden keyword '${kw}'.`);
    }
  }

  // 6. Execution Profile & Disposable Opt-In Enforcement
  // Distinguish GitHub Actions disposable service containers from local/manual execution.
  // GITHUB_ACTIONS=true alone does NOT authorize execution. An explicit, narrowly scoped profile
  // must be configured by the workflow step (PHASE1_DISPOSABLE_TEST_PROFILE=ci_ephemeral_service).
  // For local/manual execution, an explicit opt-in (PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES=true) is required.
  const isGitHubActionsRunner = process.env.GITHUB_ACTIONS === "true";
  const ciTestProfile = process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
  const hasLocalOptIn = process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES === "true";

  let executionProfile;
  if (isGitHubActionsRunner) {
    if (!ciTestProfile) {
      throw new Error(
        "Safety refusal: GITHUB_ACTIONS=true alone does not authorize disposable test execution. " +
        "The workflow step must explicitly configure an approved disposable test profile via PHASE1_DISPOSABLE_TEST_PROFILE=ci_ephemeral_service."
      );
    }
    if (ciTestProfile !== "ci_ephemeral_service") {
      throw new Error(
        `Safety refusal: Unapproved disposable test profile '${ciTestProfile}'. Approved CI profile is 'ci_ephemeral_service'.`
      );
    }
    executionProfile = "ci_ephemeral_service";
  } else if (hasLocalOptIn) {
    executionProfile = "local_manual_explicit_opt_in";
  } else if (ciTestProfile === "ci_ephemeral_service") {
    throw new Error(
      "Safety refusal: CI disposable test profile 'ci_ephemeral_service' requires running inside GitHub Actions runner environment (GITHUB_ACTIONS=true). " +
      "For manual/local execution, use PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES=true."
    );
  } else {
    throw new Error(
      `Safety refusal: Local execution against approved database '${dbName}' requires explicit opt-in via environment variable PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES=true. ` +
      "Hostname, port, and database name validation alone does not establish that the local database or Redis instance is disposable."
    );
  }

  return {
    pgHost: dbHost,
    pgPort: dbPort,
    pgDatabase: dbName,
    redisHost: rdHost,
    redisPort: rdPort,
    executionProfile,
    verified: true,
  };
}

export function runDisposableValidatorSelfChecks() {
  const cases = [
    // Approved Disposable Profiles: GitHub Actions CI profile with explicit test profile configured
    {
      name: "GitHub Actions CI profile with standard zamzam_spike defaults",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: true,
    },
    {
      name: "GitHub Actions CI profile with Docker service aliases (postgres / redis)",
      dbUrl: "postgresql://postgres:secret@postgres:5432/zamzam_spike",
      redisUrl: "redis://redis:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: true,
    },

    // Approved Disposable Profiles: Local/manual execution WITH explicit opt-in
    {
      name: "Local execution with explicit opt-in and standard loopback (127.0.0.1)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: true,
    },
    {
      name: "Local execution with explicit opt-in and localhost alias",
      dbUrl: "postgres://postgres:secret@localhost:5432/zamzam_spike",
      redisUrl: "redis://localhost:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: true,
    },
    {
      name: "Local execution with explicit opt-in and IPv6 loopback [::1]",
      dbUrl: "postgres://postgres:secret@[::1]:5432/zamzam_spike",
      redisUrl: "redis://[::1]:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: true,
    },
    {
      name: "Local execution with explicit opt-in and dynamic rollback database (zamzam_rollback_<uuid>)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_rollback_daa4d165_780d_4b00_bae2_f4a827a12831",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: true,
    },
    {
      name: "Local execution with explicit opt-in and implicit default ports",
      dbUrl: "postgres://postgres:secret@127.0.0.1/zamzam_spike",
      redisUrl: "redis://127.0.0.1",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: true,
    },
    {
      name: "Local execution with explicit opt-in and rediss protocol",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "rediss://127.0.0.1:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: true,
    },

    // Safety Refusals: Execution Profile and Opt-In Policy
    {
      name: "Local execution without opt-in (refused even with approved URL/db)",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: false,
      expectedError: "requires explicit opt-in via environment variable PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES=true",
    },
    {
      name: "GITHUB_ACTIONS=true alone without approved test profile (Finding 2)",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: false,
      expectedError: "GITHUB_ACTIONS=true alone does not authorize disposable test execution",
    },
    {
      name: "GITHUB_ACTIONS=true with unapproved test profile (Finding 2)",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "unapproved_custom_profile";
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: false,
      expectedError: "Unapproved disposable test profile 'unapproved_custom_profile'",
    },
    {
      name: "CI test profile configured outside GitHub Actions runner (local spoofing) (Finding 2)",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: false,
      expectedError: "requires running inside GitHub Actions runner environment (GITHUB_ACTIONS=true)",
    },
    {
      name: "Local execution with generic CI=true but without opt-in (no generic bypass)",
      dbUrl: "postgres://postgres:spike-only-password@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        delete process.env.GITHUB_ACTIONS;
        delete process.env.PHASE1_DISPOSABLE_TEST_PROFILE;
        process.env.CI = "true";
        delete process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES;
      },
      expectPass: false,
      expectedError: "requires explicit opt-in via environment variable PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES=true",
    },

    // Safety Refusals: Missing Connection Parameters
    {
      name: "Missing DATABASE_URL (empty string)",
      dbUrl: "",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "DATABASE_URL must be defined and non-empty",
    },
    {
      name: "Missing REDIS_URL (undefined)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: undefined,
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "LOCKING_REDIS_URL / REDIS_URL must be defined and non-empty",
    },

    // Safety Refusals: Host and Network Target Policy Violations
    {
      name: "Remote external PostgreSQL database host",
      dbUrl: "postgres://postgres:secret@db.zamzamstore.com:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "AWS RDS host even in GitHub Actions runner environment",
      dbUrl: "postgres://postgres:secret@zamzam.c3xyz.rds.amazonaws.com:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "Non-loopback LAN host IP address",
      dbUrl: "postgres://postgres:secret@192.168.1.105:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },
    {
      name: "Ambiguous bind-all host IP address (0.0.0.0)",
      dbUrl: "postgres://postgres:secret@0.0.0.0:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is ambiguous",
    },
    {
      name: "Ambiguous non-standard loopback IP address (127.0.0.2)",
      dbUrl: "postgres://postgres:secret@127.0.0.2:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is ambiguous",
    },
    {
      name: "Cross-service host alias: redis host used for PostgreSQL",
      dbUrl: "postgres://postgres:secret@redis:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Docker service host 'redis' cannot be used as PostgreSQL host",
    },
    {
      name: "Cross-service host alias: postgres host used for Redis",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://postgres:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Docker service host 'postgres' cannot be used as Redis host",
    },
    {
      name: "Remote Redis cache host",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://cache.internal.domain:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "not in the permitted disposable test hosts allowlist",
    },

    // Safety Refusals: Port Policy Violations
    {
      name: "Non-default PostgreSQL port (5433)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5433/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Non-default or unapproved PostgreSQL port '5433'",
    },
    {
      name: "Non-default Redis port (6380)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6380",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Non-default or unapproved Redis port '6380'",
    },

    // Safety Refusals: Unapproved Database Names
    {
      name: "Unapproved generic database name ('postgres') even with local opt-in",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/postgres",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.PHASE1_ALLOW_LOCAL_DISPOSABLE_SERVICES = "true";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Unapproved generic test database name ('zamzam_test')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_test",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Unapproved test_* pattern database name ('test_backend')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/test_backend",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Unapproved production database name ('zamzam')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Production database name ('zamzam_production')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_production",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Safety refusal",
    },
    {
      name: "Empty / root database pathname",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "must specify an explicit database name",
    },

    // Safety Refusals: Rollback Database Format Violations (Finding 1)
    {
      name: "Rollback database with hyphens instead of underscores (Finding 1)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_rollback_daa4d165-780d-4b00-bae2-f4a827a12831",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Rollback database with arbitrary non-UUID suffix (Finding 1)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_rollback_arbitrary_string",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },
    {
      name: "Rollback database with short suffix (Finding 1)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_rollback_abc",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "is not an approved disposable test database",
    },

    // Safety Refusals: Protocols and Keywords
    {
      name: "Invalid PostgreSQL protocol scheme (mysql:)",
      dbUrl: "mysql://postgres:secret@127.0.0.1:3306/zamzam_spike",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Invalid PostgreSQL protocol",
    },
    {
      name: "Invalid Redis protocol scheme (http:)",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike",
      redisUrl: "http://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "Invalid Redis protocol",
    },
    {
      name: "Forbidden keyword in query parameter ('production')",
      dbUrl: "postgres://postgres:secret@127.0.0.1:5432/zamzam_spike?target=production",
      redisUrl: "redis://127.0.0.1:6379",
      setup: () => {
        process.env.GITHUB_ACTIONS = "true";
        process.env.PHASE1_DISPOSABLE_TEST_PROFILE = "ci_ephemeral_service";
      },
      expectPass: false,
      expectedError: "contains forbidden keyword",
    },
  ];

  const results = [];
  for (const tc of cases) {
    const originalEnv = { ...process.env };
    let threw = false;
    let err = null;
    let res = null;
    try {
      if (tc.setup) tc.setup();
      res = verifyDisposableTargetServices(tc.dbUrl, tc.redisUrl);
    } catch (e) {
      threw = true;
      err = e;
    } finally {
      // Guaranteed restoration of environment variables even if setup or assertion throws
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      }
      for (const [key, value] of Object.entries(originalEnv)) {
        process.env[key] = value;
      }
    }

    if (tc.expectPass) {
      if (threw) {
        results.push({ name: tc.name, passed: false, detail: `Expected pass, threw: ${err.message}` });
      } else {
        results.push({
          name: tc.name,
          passed: true,
          detail: `Verified profile=${res.executionProfile} -> ${res.pgHost}:${res.pgPort}/${res.pgDatabase}, redis=${res.redisHost}:${res.redisPort}`,
        });
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
