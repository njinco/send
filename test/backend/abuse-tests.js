const assert = require('assert');
const EventEmitter = require('events');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function loadAbuse(overrides = {}) {
  const storage = {
    takeRateLimit: sinon.stub().resolves({ allowed: true, retryAfter: 60 }),
    acquireLease: sinon.stub().resolves(true),
    refreshLease: sinon.stub().resolves(true),
    releaseLease: sinon.stub().resolves(1)
  };
  const abuse = proxyquire('../../server/abuse', {
    './config': {
      request_rate_limit: 1,
      request_rate_window_seconds: 60,
      upload_rate_limit: 10,
      upload_rate_window_seconds: 60,
      max_concurrent_uploads: 1,
      upload_lease_seconds: 60,
      ...overrides
    },
    './storage': storage
  });
  return { abuse, storage };
}

function request() {
  const req = new EventEmitter();
  req.ip = '192.0.2.1';
  req.destroy = sinon.stub();
  return req;
}

function response() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.set = sinon.stub();
  res.sendStatus = sinon.stub();
  res.destroy = sinon.stub();
  return res;
}

describe('abuse controls', function() {
  it('returns a stable 429 with Retry-After at the request limit', async function() {
    const { abuse, storage } = loadAbuse();
    storage.takeRateLimit.resolves({ allowed: false, retryAfter: 17 });
    const res = { set: sinon.stub(), sendStatus: sinon.stub() };
    await abuse.limitRequests({ ip: '192.0.2.1' }, res, sinon.stub());
    sinon.assert.calledWith(res.sendStatus, 429);
    sinon.assert.calledWith(res.set, 'Retry-After', '17');
  });

  it('uses separate shared-store keys for authenticated users', async function() {
    const { abuse, storage } = loadAbuse();
    const req = { ip: '192.0.2.1' };
    const first = await abuse.acquireUpload(req, { uid: 'one' });
    const second = await abuse.acquireUpload(req, { uid: 'two' });
    assert.equal(typeof first.release, 'function');
    assert.equal(typeof second.release, 'function');
    assert.notEqual(
      storage.acquireLease.firstCall.args[0],
      storage.acquireLease.secondCall.args[0]
    );
    await first.release();
    await second.release();
  });

  it('returns 429 when the shared concurrent lease is full', async function() {
    const { abuse, storage } = loadAbuse();
    storage.acquireLease.resolves(false);
    const result = await abuse.acquireUpload({ ip: '192.0.2.1' });
    assert.deepEqual(result, { retryAfter: 1 });
  });

  it('releases HTTP capacity once on finish and close', async function() {
    const { abuse, storage } = loadAbuse();
    const req = request();
    const res = response();
    const next = sinon.stub();
    await abuse.limitUpload(req, res, next);
    res.emit('finish');
    res.emit('close');
    await new Promise(resolve => setImmediate(resolve));
    sinon.assert.calledOnce(next);
    sinon.assert.calledOnce(storage.releaseLease);
  });

  it('releases a lease acquired after the request disconnects', async function() {
    const { abuse, storage } = loadAbuse();
    let finishAcquire;
    storage.acquireLease.returns(
      new Promise(resolve => (finishAcquire = resolve))
    );
    const req = request();
    const res = response();
    const next = sinon.stub();
    const limiting = abuse.limitUpload(req, res, next);
    await new Promise(resolve => setImmediate(resolve));
    req.emit('aborted');
    finishAcquire(true);
    await limiting;
    sinon.assert.calledOnce(storage.releaseLease);
    sinon.assert.notCalled(next);
  });

  for (const outcome of ['false', 'reject']) {
    it(`aborts HTTP upload when lease refresh returns ${outcome}`, async function() {
      const clock = sinon.useFakeTimers();
      try {
        const { abuse, storage } = loadAbuse({ upload_lease_seconds: 1 });
        if (outcome === 'false') storage.refreshLease.resolves(false);
        else storage.refreshLease.rejects(new Error('redis unavailable'));
        const req = request();
        const res = response();
        await abuse.limitUpload(req, res, sinon.stub());
        clock.tick(334);
        await Promise.resolve();
        await Promise.resolve();
        sinon.assert.calledOnce(storage.refreshLease);
        sinon.assert.calledOnce(req.destroy);
        sinon.assert.calledWith(res.sendStatus, 503);
      } finally {
        clock.restore();
      }
    });
  }

  it('fails closed when the shared limiter is unavailable', async function() {
    const { abuse, storage } = loadAbuse();
    storage.takeRateLimit.rejects(new Error('redis unavailable'));
    const res = { set: sinon.stub(), sendStatus: sinon.stub() };
    await abuse.limitRequests({ ip: '192.0.2.1' }, res, sinon.stub());
    sinon.assert.calledWith(res.sendStatus, 503);
  });
});
