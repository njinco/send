const assert = require('assert');
const { spawnSync } = require('child_process');
const express = require('express');
const fetch = require('node-fetch');

function configuredIp(trustProxy) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.get('/', (req, res) => res.send(req.ip));
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/`,
          { headers: { 'X-Forwarded-For': '198.51.100.7' } }
        );
        resolve(await response.text());
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

describe('trusted proxy configuration', function() {
  it('ignores spoofed forwarding headers by default', async function() {
    assert.equal(await configuredIp(false), '127.0.0.1');
  });

  it('honors forwarding headers only for an explicitly trusted hop', async function() {
    assert.equal(await configuredIp(['loopback']), '198.51.100.7');
  });

  it('rejects unsafe and invalid TRUST_PROXY values', function() {
    for (const value of ['true', 'not-a-network']) {
      const result = spawnSync(
        process.execPath,
        ['-e', "require('./server/config')"],
        {
          cwd: process.cwd(),
          env: { ...process.env, TRUST_PROXY: value },
          encoding: 'utf8'
        }
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /trust_proxy/);
    }
  });

  it('accepts a hop count and named trusted ranges', function() {
    for (const value of ['1', 'loopback,uniquelocal']) {
      const result = spawnSync(
        process.execPath,
        ['-e', "require('./server/config')"],
        {
          cwd: process.cwd(),
          env: { ...process.env, TRUST_PROXY: value },
          encoding: 'utf8'
        }
      );
      assert.equal(result.status, 0, result.stderr);
    }
  });
});
