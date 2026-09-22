# Contributing

## Development setup

Use Node.js 24.x, as declared by `package.json` and `.nvmrc`. From a fresh
checkout, install the lockfile-defined dependencies and start the development
server:

```sh
npm run check:runtime
npm ci
npm start
```

The development server uses an in-memory Redis substitute, so a local Redis
server is not needed for the normal UI and frontend-test workflow. Backend
storage tests use their own test configuration. A production deployment
requires Redis for upload metadata; see [deployment](deployment.md) and
[Docker](docker.md).

## Before opening a change

Run the checks relevant to the change:

```sh
npm run lint
npm test
npm run build
```

`npm test` runs backend and headless-browser frontend tests. `npm run build`
checks the production asset bundle. Changes to locale data should also run
`npm run lint-locales`; use `npm run lint-locales:prod` to check the production
locale set.

Keep pull requests focused and describe behavior changes, validation performed,
and any remaining limitations. Do not include credentials, private keys, or
production data in commits or test fixtures. Use placeholders in examples and
provide deployment secrets through the operator's secret-management process.

## Help and bug reports

Users of a self-hosted instance should contact that instance's operator for
account, availability, or configuration help. For a reproducible software bug,
open an issue in the project repository with the Send version, environment, and
steps to reproduce. Never include a share URL, its secret fragment, uploaded
files, credentials, or other private data in an issue.

## Security reports

The project does not currently publish a private security contact or reporting
channel. Do not post exploitable vulnerability details in a public issue.
Maintainers need to publish a private reporting route before reporters can be
directed to one. Until then, share details only through a private contact route
you already have with a maintainer. Include affected versions and a minimal
reproduction where safe.
