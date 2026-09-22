# Modernization final risk report

Reviewed September 23, 2026. This report covers the `send` repository and the
static Compose template review. No production deployment or image publication
was performed.

## Validation completed

- Node.js 24 runtime guard passes on Node.js 24.21.0.
- `npm run lint` exits successfully: no errors, 71 existing CSS browser-support
  warnings for Edge 18/Safari targets, and 16 existing JavaScript warnings.
- `npm test` passes: 167 backend and 23 frontend tests. Expected negative-test
  WebSocket, cleanup, and premature-stream errors are logged during passing
  cases.
- `npm run build` succeeds. Webpack still reports asset/entrypoint size and
  runtime-chunk recommendations, plus service-worker package JSON named-export
  warnings. The font asset reduction is recorded in
  [the modernization plan](modernization-plan.md).
- Production dependency audit reports 4 advisories (1 high, 2 moderate,
  1 low), in `validator`, nested `uuid` through `gaxios`, and `min-document`.
  The full audit reports 36 (0 critical, 16 high, 11 moderate, 9 low).
- Repository and external production Compose samples both render with
  `docker compose config --quiet` using their sanitized environment samples.

## Remaining risks and operator decisions

1. **Dependency advisories and deferred families.** The production audit still
   includes a high `validator` advisory, two moderate `uuid` advisories, and a
   low `min-document` advisory. Phase 5B also leaves other blocked dependency
   families for separate review. The broad audit includes development and
   transitive dependency findings; review the current audit output before each
   release. No blanket `npm audit fix` was applied.
2. **Expired object retention.** Expiring Redis metadata makes a link
   unavailable but does not remove the corresponding filesystem, S3, or GCS
   object. Operators need a verified cleanup or lifecycle policy that matches
   their storage backend and retention requirements.
3. **Security reporting.** The repository publishes no private vulnerability
   reporting contact or channel. Maintainers need to choose and publish one
   before directing reporters to a specific route. The production CSP sets
   `report-uri /__cspreport__`, but no server route handles that path, so CSP
   violation reports are not collected.
4. **Live deployment validation.** Docker Compose configuration was rendered,
   but access to `/var/run/docker.sock` is denied. Container startup, health,
   restart behavior, and volume persistence were not smoke-tested. The
   production Compose template was not started, and no TLS certificate was
   issued. AWS and GCS storage adapters were not tested against live providers.
5. **Production configuration choices.** The external deployment operator
   still needs to select the Send image tag or digest, hostname, certificate
   email, exactly one storage backend, trusted-proxy ranges, and secret values.
   These values are intentionally absent from committed samples. No live
   production configuration was changed.
6. **CI ownership.** Both GitLab CI and CircleCI remain in the repository.
   Consolidation is deferred until maintainers confirm which platform owns
   testing, release publication, and deployment.
7. **Browser compatibility and bundle warnings.** Edge 18 remains an explicit
   target, while lint reports existing CSS features it does not support. The
   production bundle still exceeds Webpack's 244 KiB asset/entrypoint guidance
   and includes a runtime chunk in the app entrypoint. The Inter variable-font
   change reduces generated font assets, but first-view transfer and visual
   pixel differences were not measured.

## Follow-up order

Before production release, resolve the deployment-specific choices, validate
storage cleanup and proxy/TLS behavior on a staging host, and review the
production audit. Maintainers should also choose a private security-reporting
channel and decide whether to register a CSP report handler or remove the
unused report URI. CI consolidation and remaining dependency-family migrations
can proceed as separate reviewed changes.
