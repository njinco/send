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
- The initial production dependency audit reported 4 advisories (1 high,
  2 moderate, 1 low). After the focused `validator` update, the live production
  audit reports 3 remaining advisories (2 moderate, 1 low), in nested `uuid`
  through `gaxios` and `min-document`.
  The full audit during the clean install reported 35 (0 critical, 15 high,
  11 moderate, 9 low), including development dependencies.
- Repository and external production Compose samples both render with
  `docker compose config --quiet` using their sanitized environment samples.

## Remaining risks and operator decisions

1. **Dependency advisories and deferred families.** The lockfile now resolves
   `validator` to 13.15.35, above the 13.15.22 fix for CVE-2025-12758. A live
   production audit no longer reports `validator`; it reports two moderate
   nested `uuid` advisories and one low `min-document` advisory. Phase 5B also
   leaves other blocked dependency families for separate review. The broad
   audit includes development and transitive dependency findings; review the
   current audit output before each release. No blanket `npm audit fix` was
   applied.
2. **Expired object retention.** Expiring Redis metadata makes a link
   unavailable but does not remove the corresponding filesystem, S3, or GCS
   object. The FAQ now explicitly warns operators to configure and verify
   storage cleanup or lifecycle policies. Automatic application cleanup remains
   unimplemented: safe implementation needs a backend-specific design for
   reconciling object keys against expiring Redis metadata without deleting
   active uploads.
3. **Security reporting.** The repository publishes no private vulnerability
   reporting contact or channel. Maintainers need to choose and publish one
   before directing reporters to a specific route. The production CSP no longer
   advertises an unimplemented `report-uri`; CSP violation reports are not
   collected unless maintainers later configure a real reporting service.
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
6. **GitHub CI and image publication.** GitHub Actions replaces the retired
   GitLab and CircleCI configurations. A hosted CI run and first GHCR image
   publication have not yet occurred. After publishing, the GHCR package must
   be made public before the production host can pull the image anonymously;
   production must then be deliberately switched from the upstream image to a
   verified `ghcr.io/njinco/send` tag or digest.
7. **Browser compatibility and bundle warnings.** Edge 18 remains an explicit
   target, while lint reports existing CSS features it does not support. The
   production bundle still exceeds Webpack's 244 KiB asset/entrypoint guidance
   and includes a runtime chunk in the app entrypoint. The Inter variable-font
   change reduces generated font assets, but first-view transfer and visual
   pixel differences were not measured.

## Follow-up order

Before production release, validate the GitHub workflow and publish a tagged
GHCR image, make the package public, then resolve deployment-specific choices
and validate storage cleanup and proxy/TLS behavior on a staging host. Review
the production audit and choose a private security-reporting channel as well.
Remaining dependency-family migrations can proceed as separate reviewed
changes.
