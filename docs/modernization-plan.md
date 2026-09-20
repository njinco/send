# Send modernization plan

This document tracks the staged reliability, security, tooling, and deployment
work identified during the September 14, 2026 repository review. Each phase is
an independently reviewable change. Do not begin the next phase automatically.

## Working rules

- Work on one phase per session and finish with a clean handoff.
- Keep unrelated changes out of the phase.
- Run focused tests while developing and reserve full suites for milestones.
- Record changed files, validation results, remaining risks, and rollback notes.
- Do not deploy or publish images as part of implementation validation.
- Check the available Codex usage budget before and after every phase.
- Preserve at least 20% of both the rolling and weekly usage allowances.

## Maker/checker subagent protocol

Implementation phases use two bounded, sequential subagents when the usage
budget permits:

1. The **maker** receives only the current phase scope and acceptance gate. It
   implements the change, adds focused tests, and reports changed files and
   validation results.
2. The **checker** starts only after the maker finishes. It works read-only,
   reviews the maker's diff and test evidence, checks correctness, security,
   regressions, and scope, and returns actionable findings without editing.
3. The primary agent resolves checker findings, performs final validation, and
   prepares the phase handoff. A phase is not complete until the checker
   approves it or every unresolved finding is documented for the user.

To control usage and avoid conflicting edits:

- Use no more than two subagents per phase: one maker and one checker.
- Run them sequentially, never concurrently, and do not let them spawn more
  agents.
- Give both agents targeted files and acceptance criteria instead of the full
  review history.
- Prefer a lower-cost model for the read-only checker unless the phase involves
  concurrency, authentication, cryptography, or another high-risk design.
- Check usage before spawning the maker and again before spawning the checker.
  Do not start the pair with less than 50% of the rolling allowance or 30% of
  the weekly allowance remaining.
- If the checker cannot safely start within those limits, stop after the
  maker's work without merging or committing it and resume in a later session.
- Documentation-only corrections may skip the pair when the user explicitly
  approves a single-agent edit.

## Baseline

Captured on September 14, 2026 from `master` at `e0a3d2bf`.

| Check | Result |
| --- | --- |
| Declared Node.js version | `^16.13.0` |
| Local Node.js version | `v22.19.0` |
| Target Node.js version | Node.js 24 LTS |
| npm version | `11.19.1` |
| Docker Compose version | `v5.5.1` |
| Dependency installation | Passes, with an engine mismatch warning |
| Backend tests | 48 passing |
| Lint | Passes with 25 warnings |
| Production build | Passes with unresolved-export and asset-size warnings |
| Frontend tests | Setup crashes on Node.js 22 but exits with status 0 |
| Full dependency audit | 120 advisories: 31 critical, 51 high, 24 moderate, 14 low |
| Production dependency audit | 16 advisories: 2 critical, 6 high, 6 moderate, 2 low |
| Compose sample | Uses obsolete top-level `version` and has no `.env` sample |

The production build warning identifies an import of `reportLink` from
`app/api.js`, where no matching export exists. The frontend test result is not
accepted as a pass because the runner returned success after a fatal setup
error.

## Phases

### Phase 0: baseline and planning

- [x] Record repository, runtime, test, build, audit, and Compose baselines.
- [x] Select Node.js 24 LTS as the runtime migration target.
- [x] Define phase boundaries and completion criteria.
- [x] Commit this planning document.

Completion gate: documentation-only change; no production behavior changed.

### Phase 1: reliable storage operations

- [x] Replace callback-only Redis mutations with awaitable operations.
- [x] Propagate write, update, expiry, increment, and deletion failures.
- [x] Add cleanup or compensation for partial object/metadata operations.
- [x] Add storage failure-path tests for filesystem, Redis, S3, and GCS paths.

Completion gate: focused storage tests and the backend suite pass.

### Phase 2: atomic authorization and download limits

- [x] Atomically validate and rotate download nonces.
- [x] Reserve a permitted download before streaming begins.
- [x] Define cancellation behavior without reopening replay windows.
- [x] Add parallel download, replay, cancellation, and final-download tests.

Completion gate: concurrency tests demonstrate that the configured download
limit cannot be exceeded.

### Phase 3: input validation and abuse controls

- [x] Validate expiry and download counts as bounded safe integers.
- [x] Strictly parse authorization schemes and encoded key material.
- [x] Bound WebSocket control messages and metadata.
- [x] Add appropriate request, concurrent-upload, and per-principal limits.
- [x] Configure trusted proxies explicitly before relying on client IPs.

Completion gate: malformed, boundary, and oversized requests are covered by
tests and return stable client errors.

### Phase 4: frontend test reliability and dead API cleanup

- [x] Make all frontend setup and browser failures return a nonzero exit code.
- [x] Resolve the missing `reportLink` export by restoring or removing the dead
  reporting path.
- [x] Address warnings that indicate real races or runtime defects.

Completion gate: an intentional setup failure fails the command, frontend tests
run normally, and the unresolved-export build warning is gone.

### Phase 5A: non-breaking production dependency updates

- [x] Upgrade directly fixable production dependencies in small groups.
- [x] Re-run focused tests and the production-only audit after every group.
- [x] Document advisories that are not applicable or require major migration.

Completion gate: tests and build pass and the remaining production advisories
are explicitly accounted for.

#### Phase 5A update record (September 20, 2026)

The non-breaking update groups are intentionally limited to the latest versions
permitted by the existing major-version ranges: `@sentry/node` 7.120.4,
`aws-sdk` 2.1693.0, `body-parser` 1.20.8, `convict` 6.2.5, `express` 4.22.3,
`proxy-addr` 2.0.8, `ua-parser-js` 0.7.41, and `ws` 7.5.13. The HTTP/WebSocket
and storage/configuration focused suites pass with those versions.

`npm audit --omit=dev` and the full `npm audit` were attempted before the
updates and after each update group. The advisory bulk endpoint initially
returned HTTP 503, but a final retry succeeded: 10 production advisories
(1 critical, 3 high, 4 moderate, 2 low) and 114 full advisories (30 critical,
48 high, 22 moderate, 14 low). This is a reduction of six advisories in each
scope from the September 14 baseline (16 production / 120 full).

The following direct dependencies have no non-breaking update available and
are deferred to a later, family-scoped migration: Fluent bundle/langneg,
Google Cloud Storage, Sentry 8+, body-parser 2+, CLDR, content-disposition 3,
Express 5, Helmet 4+, node-fetch 3 (ESM), Redis 4+, redis-mock, Selenium,
ua-parser-js 2, and ws 8. AWS SDK v2 is end-of-support and is explicitly
deferred to Phase 5B's modular AWS SDK v3 migration. The Git-sourced
`configstore` dependency was separately reviewed and retired in Phase 5B.

### Phase 5B: major dependency migrations

- [x] Migrate one dependency family per session.
- [x] Replace AWS SDK v2 with the maintained modular SDK.
- [x] Update Google Cloud Storage and its adapter tests.
- [x] Remove the obsolete Git-sourced configuration dependency.
- [ ] Replace or upgrade other blocked dependency families.

Completion gate: each dependency family has focused adapter tests and a clean
production build before the next family begins.

#### Phase 5B AWS SDK v3 update record (September 20, 2026)

AWS SDK v2 has been replaced with the current modular packages
`@aws-sdk/client-s3` 3.1136.0 and `@aws-sdk/lib-storage` 3.1136.0. Both require
Node.js 20 or later and are supported by the declared Node.js 24 runtime. The
S3 adapter uses commands for object metadata, download streams, deletion, and
bucket health checks; `Upload` preserves managed multipart uploads. A source
stream failure aborts the managed upload while preserving the original stream
error for callers. The storage facade already exposes an asynchronous `get`
operation, so awaiting the v3 `GetObjectCommand` body does not change callers.

`AWS_REGION` is now a first-class configuration value. It is required and
nonblank whenever `S3_BUCKET` selects S3 storage, is passed explicitly to the
S3 client, and is documented alongside S3 credentials, optional endpoints, and
path-style addressing. The default AWS credential provider chain remains in
use, preserving environment, shared-configuration, workload, and instance-role
credential support.

Under Node.js 24.21.0, the runtime guard, a clean `npm ci`, focused S3 suite
(16 tests), backend suite (151 tests), frontend suite (23 tests), lint (0
errors; 25 existing warnings), and production build all pass. The production
audit reports 9 advisories (1 critical, 3 high, 3 moderate, 2 low), down from
the Phase 5A baseline of 10; the full audit reports 113, down from 114. None
of the remaining production advisory paths include the AWS SDK v3 packages;
they are attributable to the deferred Google Cloud Storage and other existing
dependency families. No live AWS or S3-compatible service was available for an
end-to-end provider test, so deployment should exercise the configured region,
credentials, endpoint, and path-style mode before release.

#### Phase 5B Google Cloud Storage update record (September 20, 2026)

`@google-cloud/storage` is now pinned to 8.2.0, whose Node.js 22-or-later
support includes the declared Node.js 24 runtime. Its existing adapter API
remains compatible, so configuration continues to select the configured bucket
and obtain credentials through Application Default Credentials. Focused tests
now cover metadata, reads, resumable uploads, deletion, bucket health checks,
and source/destination stream failures, including cleanup of the opposite
stream on upload failure.

Under Node.js 24.21.0, the runtime guard, a clean `npm ci`, focused GCS suite
(12 tests), backend suite (161 tests), lint (0 errors; 25 existing warnings),
and production build all pass. The production audit reports 4 advisories (0
critical, 1 high, 2 moderate, 1 low), down from 9 before this update; the full
audit reports 109, down from 113. The remaining production paths are
`validator`, `uuid` through `gaxios`, and `min-document`, not the former GCS
dependency chain. No live GCS provider or Application Default Credentials were
available for an end-to-end test, so deployment should validate its configured
bucket and identity before release.

#### Phase 5B configstore retirement record (September 20, 2026)

The Git-sourced `dannycoates/configstore` 5.0.0 override was added in 2019 to
avoid filesystem access in an older dependency tree. A repository-wide import
and dependency-tree review confirms that the application does not import it and
the current dependency tree has no transitive consumer. The maintained npm
release is now `configstore` 8.0.0 (Node.js 20+, ESM-only), but adding it would
provide no behavior and would reintroduce an unnecessary configuration store.
The override and its Docker-only `/app/.config/configstore` directory have
therefore been removed instead. A runtime configuration regression test keeps
both stale references from returning. Under Node.js 24.21.0, an isolated clean
`npm ci`, the focused runtime configuration suite (2 tests), backend suite
(162 tests), lint (0 errors; 25 existing warnings), and production build all
pass. The production audit remains 4 advisories (0 critical, 1 high, 2
moderate, 1 low) and the full audit remains 109, confirming this unused leaf
did not own an outstanding advisory path. No external service or credentials
are involved in this retirement.

### Phase 6A: Node.js runtime migration

- [x] Change engines, containers, local documentation, and CI to Node.js 24 LTS.
- [x] Remove compatibility workarounds made unnecessary by supported tooling.
- [x] Verify install, backend tests, frontend tests, and production build.

Completion gate: all supported development and deployment paths use the same
Node.js major version.

### Phase 6B: build and test tooling modernization

- [x] Upgrade Webpack and replace obsolete loaders and plugins.
- [x] Upgrade Puppeteer and browser-test setup.
- [x] Upgrade ESLint, Prettier, Stylelint, Husky, and related configuration.
- [x] Refresh Browserslist data and browser targets intentionally.

Completion gate: lint, frontend tests, backend tests, and production build pass
without obsolete-tool warnings.

#### Webpack 5 update record

Webpack has been upgraded from 4.38.0 to 5.111.1 with its supported CLI,
webpack-dev-server 5.2.6, middleware, manifest, copy, CSS-extraction, and
active loader integrations. The obsolete ExtractText, file, and raw loaders have been
replaced by MiniCssExtractPlugin and webpack asset modules; unused legacy
loaders have been removed. Custom asset plugins now emit assets through
`processAssets`, and development manifest reads use webpack-dev-middleware's
current output filesystem API. Explicit browser fallbacks preserve the Node
core modules that webpack 4 supplied implicitly, including the test suite's
`assert` and `http_ece` dependencies. The existing Webdriver configuration now
declares its `ip` dependency instead of relying on the previous dev server's
transitive tree.

Under Node.js 24.21.0, a normal clean `npm ci`, frontend browser tests, 162
backend tests, lint (0 errors; 25 existing warnings), and the production build
all pass. The production build retains its existing bundle-size and
service-worker package-JSON import warnings, which are outside this bounded
migration. Production audit remains 4 advisories (0 critical, 1 high, 2
moderate, 1 low); the full audit is now 47 (0 critical, 24 high, 12 moderate,
11 low), reduced from 109 through replacement of the legacy webpack tree.

#### Puppeteer update record

Puppeteer has been upgraded from 2.0.0 to 25.11.0, whose maintained release
requires Node.js 22.12 or later and is supported by the project's Node.js 24
runtime. The frontend runner now uses Puppeteer's current `waitForFunction`
API in place of the removed `waitFor` overload; its launch flags, result
collection, failure propagation, and cleanup order are otherwise unchanged.

Under Node.js 24.21.0, a normal clean `npm ci`, Puppeteer's pinned Chrome
153.0.8010.36 installation, frontend browser tests, the focused runner suite
(4 tests), 162 backend tests, lint (0 errors; 25 existing warnings), and the
production build all pass. A first run on a new machine must download the
pinned browser with `npx puppeteer browsers install chrome` when the cache is
not already populated; this external browser artifact is not committed. The
production audit remains 4 advisories (0 critical, 1 high, 2 moderate, 1 low),
while the full audit improves from 47 to 45 (0 critical, 22 high, 12 moderate,
11 low) through replacement of Puppeteer's legacy dependency tree. No live
external service or credentials are involved; rollback is the preceding lockfile,
package declaration, and runner API call.

#### Lint tooling update record

ESLint has been upgraded from 6.6.0 to 10.11.0 and migrated from seven legacy
`.eslintrc` files to `eslint.config.mjs`. The maintained `eslint-plugin-n`
replaces deprecated `eslint-plugin-node`; current Mocha, security, and Prettier
integrations retain the prior project rules and scope-specific browser, test,
and script environments. The flat configuration explicitly preserves the
ESLint 6 baseline for rules introduced later, including `no-redeclare` without
newly recognized built-in globals, avoiding unrelated source rewrites. Six
existing disable comments now use the maintained `n/*` namespace.

Prettier 3.9.8 uses a shared single-quote configuration. Stylelint 17.15.0,
standard configuration 40, and its browser-feature plugin replace the old
Stylelint 14 family; the Tailwind `@apply` grammar exception is retained. Husky
9 moves pre-commit and pre-push behavior to `.husky/`, and lint-staged 17 no
longer uses its obsolete manual `git add` step.

Under Node.js 24.21.0, a normal clean `npm ci`, hook syntax and empty-index
lint-staged validation, lint (0 errors; 16 JavaScript and 71 browser-support
warnings), 162 backend tests, frontend browser tests, and the production build
all pass. The browser-support warnings reflect current feature data for the
project's existing targets and are reserved for the separate browser-targets
item. Production audit remains 4 advisories (0 critical, 1 high, 2 moderate,
1 low); the full audit improves from 45 to 36 (0 critical, 16 high, 11
moderate, 9 low). The normal install is required: the existing Git-sourced
`webcrypto-core` dependency builds its JavaScript artifact through its install
lifecycle, so `npm ci --ignore-scripts` cannot run the frontend build.

#### Browserslist data and target review record

The supported `update-browserslist-db` command was run under Node.js 24.21.0.
The lockfile already contains its current `caniuse-lite` database
(1.0.30001810), so the refresh made no package or lockfile change. The existing
target policy is intentionally retained: the two latest Chrome, Firefox,
Safari, and Edge releases, plus Firefox ESR and Edge 18. No project
documentation or product decision authorizes narrowing that legacy support.

The resolved targets are Chrome 151/150, Firefox 154/153/140 ESR, Safari
26.6/26.5, and Edge 151/150/18. Node.js 24.21.0 lint passes with no errors;
the 71 CSS browser-support warnings are expected consequences of that policy,
principally CSS nesting unsupported by Edge 18. The 16 existing JavaScript
lint warnings are unrelated. Frontend browser tests, 162 backend tests, and a
production build pass. The build retains its existing asset-size and
service-worker package-JSON import warnings, which this no-code-change review
does not affect. Rollback is not applicable because this verification made no
runtime or dependency change; a future decision to remove Edge 18 must be made
as an explicit product compatibility change.

### Phase 7A: repository Compose and environment samples

- [x] Remove the obsolete top-level Compose `version` field.
- [x] Replace legacy `links` with service networking and explicit dependencies.
- [x] Add appropriate health checks, persistence, and restart behavior.
- [x] Create sanitized `.env.example` and `.env.production.example` files.
- [x] Synchronize samples with every supported option in `server/config.js`.
- [x] Update documentation to use the `docker compose` command.
- [x] Validate the rendered configuration with `docker compose config`.
- [ ] Run a local service smoke test and verify volume persistence (Docker daemon access required).

Completion gate: the sample has no obsolete-version warning, contains no real
secrets, and survives container recreation with expected persistent data.

#### Phase 7A update record (September 21, 2026)

The repository Compose sample now uses the Compose Specification without a
top-level `version` field or legacy `links`. Redis service discovery uses the
default network and a health-gated dependency; both services restart unless
stopped. Redis AOF data and uploads use named volumes. Application and optional
Selenium VNC ports bind to loopback by default, and the latter remains
configurable through the documented Compose-only `VNC_PORT` variable.

The sanitized `.env.example` and `.env.production.example` files enumerate all
server configuration variables with safe defaults and blank credentials. An
ephemeral copy of the production sample renders successfully with `docker
compose config --quiet`; it was removed after validation. Docker daemon access
is denied in this environment, so image build, service smoke, and persistence
recreation remain required before this phase can meet its final completion
gate. The external production Compose repository remains intentionally out of
scope.

### Phase 7B: external production Compose repository

- [ ] Obtain explicit access to `/home/njinco/send-docker-compose`.
- [ ] Apply the Compose Specification and environment-sample updates there.
- [ ] Validate reverse proxy, TLS, Redis, storage, health, and restart behavior.
- [ ] Perform a controlled production-like smoke test without deploying.

Completion gate: production configuration resolves successfully and deployment
remains a separate, explicitly authorized action.

### Phase 7C: CI and container workflows

- [ ] Consolidate obsolete or overlapping CI systems.
- [ ] Update build and runtime container bases.
- [ ] Restrict image publication to intentional release events.
- [ ] Replace deprecated package-repository and browser-installation steps.

Completion gate: CI configuration validates and test jobs cannot publish images.

### Phase 8: final hardening and documentation

- [ ] Review bundle and font sizes and make measured performance improvements.
- [ ] Complete deployment, security, support, and contributor documentation.
- [ ] Run the complete lint, test, build, audit, and Compose validation matrix.
- [ ] Produce a final remaining-risk report.

Completion gate: all agreed checks pass or have documented, accepted exceptions.

## Handoff template

Every phase ends with:

1. Scope completed and files changed.
2. Commands run and their results.
3. Known limitations or deferred findings.
4. Rollback instructions.
5. The next phase, which remains unstarted pending approval.
