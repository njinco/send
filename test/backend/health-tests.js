const assert = require('assert');
const express = require('express');
const fetch = require('node-fetch');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function startRoutes(storage, abuse) {
  const routes = proxyquire('../../server/routes', {
    '../storage': storage,
    '../abuse': abuse
  });
  const app = express();
  routes(app);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function status(server, path) {
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}${path}`
  );
  return response.status;
}

describe('health probe rate-limit exemptions', function() {
  it('keeps liveness available during limiter and Redis failure', async function() {
    const storage = { ping: sinon.stub().rejects(new Error('redis down')) };
    const abuse = {
      limitRequests: sinon.stub().callsFake((req, res) => res.sendStatus(503)),
      limitUpload: sinon.stub()
    };
    const server = await startRoutes(storage, abuse);
    try {
      assert.equal(await status(server, '/__lbheartbeat__'), 200);
      assert.equal(await status(server, '/__heartbeat__'), 500);
      sinon.assert.notCalled(abuse.limitRequests);
    } finally {
      server.close();
    }
  });

  it('does not consume quota for successful health probes', async function() {
    const storage = { ping: sinon.stub().resolves() };
    const abuse = {
      limitRequests: sinon.stub().callsFake((req, res) => res.sendStatus(429)),
      limitUpload: sinon.stub()
    };
    const server = await startRoutes(storage, abuse);
    try {
      assert.equal(await status(server, '/__lbheartbeat__'), 200);
      assert.equal(await status(server, '/__heartbeat__'), 200);
      sinon.assert.notCalled(abuse.limitRequests);
    } finally {
      server.close();
    }
  });
});
