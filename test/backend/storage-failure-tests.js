const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function createStorage() {
  const adapter = {
    set: sinon.stub().resolves(),
    del: sinon.stub().resolves(),
    length: sinon.stub(),
    getStream: sinon.stub(),
    ping: sinon.stub().resolves()
  };
  const redis = {
    on: sinon.stub(),
    ttlAsync: sinon.stub().resolves(30),
    hgetallAsync: sinon.stub().resolves({ prefix: '1', metadata: 'encrypted' }),
    hgetAsync: sinon.stub(),
    hmsetAsync: sinon.stub().resolves(),
    hsetAsync: sinon.stub().resolves(),
    hincrbyAsync: sinon.stub().resolves(),
    zremAsync: sinon.stub().resolves(1),
    evalAsync: sinon.stub(),
    expireAsync: sinon.stub().resolves(),
    delAsync: sinon.stub().resolves(),
    pingAsync: sinon.stub().resolves()
  };
  const log = { error: sinon.stub() };
  class MockStorage {
    constructor() {
      return adapter;
    }
  }
  const storage = proxyquire('../../server/storage', {
    '../config': {
      s3_bucket: 'bucket',
      default_expire_seconds: 30
    },
    '../log': () => log,
    './s3': MockStorage,
    './redis': () => redis
  });
  return { adapter, log, redis, storage };
}

describe('Storage failure handling', function() {
  it('cleans both stores when the object write fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('object write failed');
    adapter.set.rejects(err);

    await assert.rejects(storage.set('x', null, { owner: 'owner' }), err);

    sinon.assert.calledWith(adapter.del, '1-x');
    sinon.assert.calledWith(redis.delAsync, 'x');
  });

  it('removes the object and partial metadata when metadata write fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('metadata write failed');
    redis.hmsetAsync.rejects(err);

    await assert.rejects(storage.set('x', null, { owner: 'owner' }), err);

    sinon.assert.calledWith(adapter.del, '1-x');
    sinon.assert.calledWith(redis.delAsync, 'x');
  });

  it('removes the object and metadata when expiry fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('expiry failed');
    redis.expireAsync.rejects(err);

    await assert.rejects(storage.set('x', null, { owner: 'owner' }), err);

    sinon.assert.calledWith(adapter.del, '1-x');
    sinon.assert.calledWith(redis.delAsync, 'x');
  });

  it('does not delete the object when metadata cleanup fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('metadata write failed');
    redis.hmsetAsync.rejects(err);
    redis.delAsync.rejects(new Error('metadata cleanup failed'));

    await assert.rejects(storage.set('x', null, { owner: 'owner' }), err);
    sinon.assert.notCalled(adapter.del);
  });

  it('does not mask the write failure when object cleanup fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('metadata write failed');
    redis.hmsetAsync.rejects(err);
    adapter.del.rejects(new Error('object cleanup failed'));

    await assert.rejects(storage.set('x', null, { owner: 'owner' }), err);
  });

  it('propagates field and increment failures', async function() {
    const { redis, storage } = createStorage();
    const writeErr = new Error('write failed');
    const incrementErr = new Error('increment failed');
    redis.hsetAsync.rejects(writeErr);
    redis.hincrbyAsync.rejects(incrementErr);

    await assert.rejects(storage.setField('x', 'owner', 'y'), writeErr);
    await assert.rejects(storage.incrementField('x', 'dl'), incrementErr);
  });

  it('uses Redis scripts for production nonce compare-and-set', async function() {
    const { redis, storage } = createStorage();
    redis.supportsAtomicScripts = true;
    redis.evalAsync.resolves(1);

    assert.equal(await storage.rotateNonce('x', 'old', 'new'), true);
    sinon.assert.calledOnce(redis.evalAsync);
    const args = redis.evalAsync.firstCall.args;
    assert.match(args[0], /HGET.*nonce/);
    assert.match(args[0], /HSET/);
    assert.deepEqual(args.slice(1), [1, 'x', 'old', 'new']);
  });

  it('uses one Redis script to check and reserve a download', async function() {
    const { redis, storage } = createStorage();
    redis.supportsAtomicScripts = true;
    redis.evalAsync.resolves([2, 2]);

    assert.deepEqual(await storage.reserveDownload('x'), {
      downloadCount: 2,
      downloadLimit: 2,
      finalDownload: true
    });
    sinon.assert.calledOnce(redis.evalAsync);
    const args = redis.evalAsync.firstCall.args;
    assert.match(args[0], /EXISTS/);
    assert.match(args[0], /HEXISTS.*prefix/);
    assert.ok(args[0].indexOf('EXISTS') < args[0].indexOf('HINCRBY'));
    assert.match(args[0], /HINCRBY.*dl/);
    assert.deepEqual(args.slice(1), [1, 'x']);
  });

  it('uses one Redis script for a fixed-window rate decision', async function() {
    const { redis, storage } = createStorage();
    redis.supportsAtomicScripts = true;
    redis.evalAsync.resolves([0, 1500]);
    assert.deepEqual(await storage.takeRateLimit('rate', 2, 10000), {
      allowed: false,
      retryAfter: 2
    });
    const args = redis.evalAsync.firstCall.args;
    assert.match(args[0], /INCR/);
    assert.match(args[0], /PEXPIRE/);
    assert.deepEqual(args.slice(1), [1, 'rate', 2, 10000]);
  });

  it('uses one Redis script to prune and acquire an upload lease', async function() {
    const { redis, storage } = createStorage();
    redis.supportsAtomicScripts = true;
    redis.evalAsync.resolves(1);
    assert.equal(
      await storage.acquireLease('leases', 'token', 3, 60000, 10),
      true
    );
    const args = redis.evalAsync.firstCall.args;
    assert.match(args[0], /ZREMRANGEBYSCORE/);
    assert.match(args[0], /ZCARD/);
    assert.match(args[0], /ZADD/);
    assert.deepEqual(args.slice(1), [
      1,
      'leases',
      10,
      3,
      60010,
      'token',
      60000
    ]);
  });

  it('refreshes and explicitly releases the matching lease token', async function() {
    const { redis, storage } = createStorage();
    redis.supportsAtomicScripts = true;
    redis.evalAsync.resolves(1);
    assert.equal(
      await storage.refreshLease('leases', 'token', 60000, 10),
      true
    );
    assert.match(redis.evalAsync.firstCall.args[0], /ZSCORE/);
    assert.deepEqual(redis.evalAsync.firstCall.args.slice(1), [
      1,
      'leases',
      'token',
      60010,
      60000
    ]);
    await storage.releaseLease('leases', 'token');
    sinon.assert.calledWith(redis.zremAsync, 'leases', 'token');
  });

  it('maps the production script missing-key result to no reservation', async function() {
    const { redis, storage } = createStorage();
    redis.supportsAtomicScripts = true;
    redis.evalAsync.callsFake(script => {
      assert.match(script, /return {0, 0}/);
      assert.match(script, /EXISTS/);
      return Promise.resolve([0, 0]);
    });

    assert.equal(await storage.reserveDownload('expired'), null);
    sinon.assert.calledOnce(redis.evalAsync);
    sinon.assert.notCalled(redis.hincrbyAsync);
  });

  it('propagates atomic Redis script failures', async function() {
    const { redis, storage } = createStorage();
    const err = new Error('script failed');
    redis.supportsAtomicScripts = true;
    redis.evalAsync.rejects(err);

    await assert.rejects(storage.rotateNonce('x', 'old', 'new'), err);
    await assert.rejects(storage.reserveDownload('x'), err);
  });

  it('does not delete the object when metadata deletion fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('metadata delete failed');
    redis.delAsync.rejects(err);

    await assert.rejects(storage.del('x'), err);
    sinon.assert.notCalled(adapter.del);
  });

  it('restores metadata when object deletion fails', async function() {
    const { adapter, redis, storage } = createStorage();
    const err = new Error('object delete failed');
    adapter.del.rejects(err);

    await assert.rejects(storage.del('x'), err);

    sinon.assert.calledWith(redis.hmsetAsync, 'x', {
      prefix: '1',
      metadata: 'encrypted'
    });
    sinon.assert.calledWith(redis.expireAsync, 'x', 30);
  });

  it('does not restore metadata that expired during deletion', async function() {
    const { adapter, redis, storage } = createStorage();
    redis.ttlAsync.resolves(-2);
    adapter.del.rejects(new Error('object delete failed'));

    await assert.rejects(storage.del('x'));

    sinon.assert.notCalled(redis.hmsetAsync);
    sinon.assert.notCalled(redis.expireAsync);
  });

  it('restores persistent metadata without adding an expiry', async function() {
    const { adapter, redis, storage } = createStorage();
    redis.ttlAsync.resolves(-1);
    adapter.del.rejects(new Error('object delete failed'));

    await assert.rejects(storage.del('x'));

    sinon.assert.calledWith(redis.hmsetAsync, 'x', {
      prefix: '1',
      metadata: 'encrypted'
    });
    sinon.assert.notCalled(redis.expireAsync);
  });

  it('restores metadata expiring now with a minimum one-second TTL', async function() {
    const { adapter, redis, storage } = createStorage();
    redis.ttlAsync.resolves(0);
    adapter.del.rejects(new Error('object delete failed'));

    await assert.rejects(storage.del('x'));

    sinon.assert.calledWith(redis.hmsetAsync, 'x', {
      prefix: '1',
      metadata: 'encrypted'
    });
    sinon.assert.calledWith(redis.expireAsync, 'x', 1);
  });

  it('removes partially restored metadata when restoring its expiry fails', async function() {
    const { adapter, log, redis, storage } = createStorage();
    const err = new Error('object delete failed');
    const cleanupErr = new Error('metadata cleanup failed');
    adapter.del.rejects(err);
    redis.expireAsync.rejects(new Error('expiry restore failed'));
    redis.delAsync.onSecondCall().rejects(cleanupErr);

    await assert.rejects(storage.del('x'), value => value === err);

    sinon.assert.calledWith(redis.hmsetAsync, 'x', {
      prefix: '1',
      metadata: 'encrypted'
    });
    sinon.assert.calledTwice(redis.delAsync);
    sinon.assert.alwaysCalledWith(redis.delAsync, 'x');
    sinon.assert.calledWith(log.error, 'Metadata restore cleanup:', cleanupErr);
  });
});
