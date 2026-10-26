# Local disposable Phase 1 runtime (Windows)

TP-01 is not authorized. The local runner and evidence command have explicit
allowlists which exclude it. No cart-creation route, batch variant fixture or
checkout-line-key hook is exercised by the new lock/mutation cases.

## Tools and provenance

Keep the portable tools under ignored `artifacts/tools/`; no Windows service,
Docker/WSL installation, production credentials or existing database is needed.

| Tool | Source | Verified ZIP SHA-256 |
|---|---|---|
| Node 24.22.1 | [Official Windows distribution and SHASUMS256.txt](https://nodejs.org/dist/v24.22.1/) | `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5` |
| PostgreSQL 16.15-1 | [EDB Windows binaries](https://get.enterprisedb.com/postgresql/postgresql-16.15-1-windows-x64-binaries.zip), [vendor checksum](https://github.com/EnterpriseDB/edb-installers/issues/696) | `25e6fcdfb8caec38691bf461125e7564508760666f7b8e5dc6a5f0818f58f81e` |
| Redis 7.2.16 Windows MSYS2 | [redis-windows release](https://github.com/redis-windows/redis-windows/releases/tag/7.2.16) | `bcbfda1dda027beaea4d616f8992f9b6353613c1b1f4d0e4a6776940bb036347` |

The Windows Redis build is the redis-windows community port, not the pinned
Linux Docker image. Local metadata identifies the native distributions and
captures executable hashes; CI separately checks the pinned Linux images.
The PostgreSQL ZIP includes large optional tools. Extracting only `pgsql/bin`,
`pgsql/lib` and `pgsql/share` is sufficient for this runner.

Default paths:

```text
artifacts/tools/node-v24.22.1-win-x64/node.exe
artifacts/tools/postgresql/pgsql/bin/pg_ctl.exe
artifacts/tools/redis/Redis-7.2.16-Windows-x64-msys2/redis-server.exe
```

## Run

From the repository root:

```powershell
./scripts/run-local-spike.ps1
```

For binaries extracted to another location:

```powershell
./scripts/run-local-spike.ps1 -PostgresBin ./artifacts/tools/postgresql-runtime/pgsql/bin
```

`-SkipInstall` explicitly skips clean installation when it was already checked;
it is recorded in the run manifest. `-Targeted -Cases TP-04a,TP-04b` runs migrations
and those behavioral cases on fresh services without repeating the baseline
build/unit/rollback suite. A targeted pass is not a full-suite pass.

The inventory ledger cases can be run without TP-01:

```powershell
./scripts/run-local-spike.ps1 -SkipInstall -Targeted -Cases TP-06a,TP-06b,TP-07a,TP-24c
```

The default full run includes these four inventory cases and the migration 6
UP/DOWN/UP rollback assertions. The ledger harness creates uniquely named,
guarded disposable databases and temporary roles only inside its isolated
PostgreSQL cluster, then drops resources it created. TP-24c verifies both an
application role's table privileges and the database trigger's immutable-row
boundary; this is test-only role provisioning, not a production migration role.

The runner refuses occupied ports 5432/6379. It creates a fresh PostgreSQL cluster
under `artifacts/local-services/<UUID>/`, binds both servers to 127.0.0.1, creates
only `zamzam_spike`, and enables the existing strict disposable-target validator.
It does not reuse, drop, reset, or stop a pre-existing service. The rollback test
retains its separate opt-in/unique-database checks. Both owned processes are
stopped in `finally`; failed cleanup fails the run. Offline cluster/log files are
retained for investigation instead of recursively deleting data.

Every command/exit code and service executable hash is recorded in the local
run directory. Per-case raw streams, assertions, before/after snapshots and
interleaving evidence remain under `artifacts/tp-evidence/TP-<id>/`. Earlier case
outputs move to `artifacts/tp-evidence-history/`. The summary covers all 59 cases.
Exact source SHA and the dirty-worktree flag are recorded; development runs on
modified sources are not treated as clean-commit evidence.

## Implemented boundaries

- TP-02c/TP-03 execute their original workflow assertions and then an actual HTTP
  request to `POST /store/carts/:id/checkout-lock`. The route is disabled unless
  `PHASE1_ENABLE_PROTOTYPE_ROUTES=true`; the test enables it in its child process.
  It executes only the real lock stage and lease cleanup, not full checkout/order
  conversion. No fallback HTTP cleanup can hide a broken workflow timeout CAS.
- TP-04a/TP-04b use the real native line-item/cart mutation routes. An active or
  completed session rejects mutation; old timestamps do not unlock the cart.
  Native route delegates hold the lock until the actual controller promise
  settles, including after a client disconnect. The test gates a real update,
  aborts its HTTP client, observes the server-side close, rejects a competitor
  and then verifies the original update completes before release. A static
  inventory checks all nine pinned native cart mutation methods are delegated
  through this guard; it does not claim runtime execution of all nine methods.
  An aborted-state fixture
  permits a real native cart update; it does not implement or test recovery.
- TP-21c invokes `system_security.prepareRefundIdentity` in the real Medusa
  container, with PostgreSQL/Redis running. It checks stable HMAC/request hashes,
  fresh AES-256-GCM nonces, decryption and tamper rejection. It does not create a
  refund, enforce refund roles/capacity or contact a payout provider.
- TP-06a/TP-06b/TP-07a execute the real `InventoryLedger` against native Medusa
  cart/product services and PostgreSQL. They cover FEFO reservation, exact
  replay, conflicting intent, ledger divergence, rollback, concurrency and
  pre-order expiry release. They do not create or convert an order, and expiry
  cleanup is allowed only while the checkout attempt remains pre-order.
- TP-24c uses a temporary unprivileged app role and a separate inventory-writer
  role in the disposable cluster to show that revoked table access and the
  movement immutability trigger hold independently. It does not provision
  application roles in deployable migrations.

The crypto component requires backend-only `HMAC_KEY` (at least 32 UTF-8 bytes)
and `REFUND_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters). Tests
generate ephemeral keys and synthetic recipient data; neither keys nor plaintext
recipient details are logged. Flat string recipient fields are key-sorted,
NFC-normalized and trimmed. Amounts use exact two-decimal EGP major-unit strings.
The request digest follows the documented colon-delimited tuple, independently
of ciphertext. Key provisioning/rotation and refund persistence remain later
prototype dependencies and are not claimed by TP-21c.

No TP checkbox or Phase 1 gate is approved by these scripts. Independent review,
remaining implementation/TP evidence, and TP-01 authorization remain separate.
