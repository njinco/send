const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const helmet = require('helmet');

function startApp() {
  const app = express();
  app.use(helmet());
  app.use(
    helmet.hsts({
      maxAge: 31536000,
      force: true,
    }),
  );
  app.use(
    (req, res, next) => {
      req.cspNonce = crypto.randomBytes(16).toString('hex');
      next();
    },
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req) => `'nonce-${req.cspNonce}'`],
        reportUri: '/__cspreport__',
      },
    }),
  );
  app.get('/', (req, res) => res.sendStatus(200));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('security headers', function () {
  it('preserves Helmet defaults and HSTS', async function () {
    const server = await startApp();
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(
        response.headers.get('strict-transport-security'),
        'max-age=31536000; includeSubDomains',
      );
    } finally {
      server.close();
    }
  });

  it('supports the application CSP directives and report endpoint', async function () {
    const server = await startApp();
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/`,
      );
      const secondResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/`,
      );
      const policy = response.headers.get('content-security-policy');
      const secondPolicy = secondResponse.headers.get(
        'content-security-policy',
      );
      const nonce = policy.match(/script-src 'self' 'nonce-([^']+)'/)[1];
      const secondNonce = secondPolicy.match(
        /script-src 'self' 'nonce-([^']+)'/,
      )[1];
      assert.match(policy, /default-src 'self'/);
      assert.notEqual(nonce.length, 0);
      assert.notEqual(nonce, secondNonce);
      assert.match(policy, /report-uri \/__cspreport__/);
    } finally {
      server.close();
    }
  });
});
