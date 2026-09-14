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

- [ ] Make all frontend setup and browser failures return a nonzero exit code.
- [ ] Resolve the missing `reportLink` export by restoring or removing the dead
  reporting path.
- [ ] Address warnings that indicate real races or runtime defects.

Completion gate: an intentional setup failure fails the command, frontend tests
run normally, and the unresolved-export build warning is gone.

### Phase 5A: non-breaking production dependency updates

- [ ] Upgrade directly fixable production dependencies in small groups.
- [ ] Re-run focused tests and the production-only audit after every group.
- [ ] Document advisories that are not applicable or require major migration.

Completion gate: tests and build pass and the remaining production advisories
are explicitly accounted for.

### Phase 5B: major dependency migrations

- [ ] Migrate one dependency family per session.
- [ ] Replace AWS SDK v2 with the maintained modular SDK.
- [ ] Update Google Cloud Storage and its adapter tests.
- [ ] Replace or upgrade configuration and other blocked dependencies.

Completion gate: each dependency family has focused adapter tests and a clean
production build before the next family begins.

### Phase 6A: Node.js runtime migration

- [ ] Change engines, containers, local documentation, and CI to Node.js 24 LTS.
- [ ] Remove compatibility workarounds made unnecessary by supported tooling.
- [ ] Verify install, backend tests, frontend tests, and production build.

Completion gate: all supported development and deployment paths use the same
Node.js major version.

### Phase 6B: build and test tooling modernization

- [ ] Upgrade Webpack and replace obsolete loaders and plugins.
- [ ] Upgrade Puppeteer and browser-test setup.
- [ ] Upgrade ESLint, Prettier, Stylelint, Husky, and related configuration.
- [ ] Refresh Browserslist data and browser targets intentionally.

Completion gate: lint, frontend tests, backend tests, and production build pass
without obsolete-tool warnings.

### Phase 7A: repository Compose and environment samples

- [ ] Remove the obsolete top-level Compose `version` field.
- [ ] Replace legacy `links` with service networking and explicit dependencies.
- [ ] Add appropriate health checks, persistence, and restart behavior.
- [ ] Create sanitized `.env.example` and `.env.production.example` files.
- [ ] Synchronize samples with every supported option in `server/config.js`.
- [ ] Update documentation to use the `docker compose` command.
- [ ] Validate with `docker compose config` and a local service smoke test.

Completion gate: the sample has no obsolete-version warning, contains no real
secrets, and survives container recreation with expected persistent data.

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
