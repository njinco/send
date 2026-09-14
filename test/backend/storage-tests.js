const assert = require('assert');
const proxyquire = require('proxyquire').noCallThru();

const stream = {};
class MockStorage {
  length() {
    return Promise.resolve(12);
  }
  getStream() {
    return stream;
  }
  set() {
    return Promise.resolve();
  }
  del() {
    return Promise.resolve();
  }
  ping() {
    return Promise.resolve();
  }
}

const config = {
  s3_bucket: 'foo',
  default_expire_seconds: 20,
  expire_times_seconds: [10, 20, 30],
  env: 'development',
  redis_host: 'localhost'
};

const storage = proxyquire('../../server/storage', {
  '../config': config,
  '../log': () => {},
  './s3': MockStorage
});

describe('Storage', function() {
  describe('ttl', function() {
    it('returns milliseconds remaining', async function() {
      const time = 40;
      await storage.set('x', null, { foo: 'bar' }, time);
      const ms = await storage.ttl('x');
      await storage.del('x');
      assert.equal(ms, time * 1000);
    });
  });

  describe('length', function() {
    it('returns the file size', async function() {
      const len = await storage.length('x');
      assert.equal(len, 12);
    });
  });

  describe('get', function() {
    it('returns a stream', async function() {
      const s = await storage.get('x');
      assert.equal(s, stream);
    });
  });

  describe('set', function() {
    it('sets expiration to expire time', async function() {
      const seconds = 100;
      await storage.set('x', null, { foo: 'bar' }, seconds);
      const s = await storage.redis.ttlAsync('x');
      await storage.del('x');
      assert.equal(Math.ceil(s), seconds);
    });

    it('adds right prefix based on expire time', async function() {
      await storage.set('x', null, { foo: 'bar' }, 300);
      const path_x = await storage.getPrefixedId('x');
      assert.equal(path_x, '1-x');
      await storage.del('x');

      await storage.set('y', null, { foo: 'bar' }, 86400);
      const path_y = await storage.getPrefixedId('y');
      assert.equal(path_y, '1-y');
      await storage.del('y');

      await storage.set('z', null, { foo: 'bar' }, 86400 * 7);
      const path_z = await storage.getPrefixedId('z');
      assert.equal(path_z, '7-z');
      await storage.del('z');
    });

    it('sets metadata', async function() {
      const m = { foo: 'bar' };
      await storage.set('x', null, m);
      const meta = await storage.redis.hgetallAsync('x');
      delete meta.prefix;
      await storage.del('x');
      assert.deepEqual(meta, m);
    });
  });

  describe('setField', function() {
    it('works', async function() {
      await storage.set('x', null);
      await storage.setField('x', 'y', 'z');
      const z = await storage.redis.hgetAsync('x', 'y');
      assert.equal(z, 'z');
      await storage.del('x');
    });
  });

  describe('atomic download state', function() {
    it('allows only one parallel rotation of the same nonce', async function() {
      await storage.set('x', null, {
        dlimit: 1,
        nonce: 'original'
      });

      const results = await Promise.all([
        storage.rotateNonce('x', 'original', 'first'),
        storage.rotateNonce('x', 'original', 'second')
      ]);
      const meta = await storage.metadata('x');

      assert.deepEqual(results.sort(), [false, true]);
      assert.ok(meta.nonce === 'first' || meta.nonce === 'second');
      await storage.del('x');
    });

    it('rejects stale nonce replays', async function() {
      await storage.set('x', null, {
        dlimit: 1,
        nonce: 'original'
      });

      assert.equal(await storage.rotateNonce('x', 'original', 'next'), true);
      assert.equal(await storage.rotateNonce('x', 'original', 'replay'), false);
      assert.equal((await storage.metadata('x')).nonce, 'next');
      await storage.del('x');
    });

    it('never reserves more parallel downloads than the limit', async function() {
      await storage.set('x', null, {
        dl: 0,
        dlimit: 2,
        nonce: 'nonce'
      });

      const reservations = await Promise.all(
        Array.from({ length: 10 }, () => storage.reserveDownload('x'))
      );
      const accepted = reservations.filter(Boolean);
      const meta = await storage.metadata('x');

      assert.equal(accepted.length, 2);
      assert.equal(accepted.filter(item => item.finalDownload).length, 1);
      assert.equal(meta.dl, 2);
      assert.equal(await storage.reserveDownload('x'), null);
      await storage.del('x');
    });

    it('marks a one-download reservation as final', async function() {
      await storage.set('x', null, {
        dl: 0,
        dlimit: 1,
        nonce: 'nonce'
      });

      assert.deepEqual(await storage.reserveDownload('x'), {
        downloadCount: 1,
        downloadLimit: 1,
        finalDownload: true
      });
      assert.equal(await storage.reserveDownload('x'), null);
      await storage.del('x');
    });

    it('keeps the one-download default for legacy metadata', async function() {
      await storage.set('x', null, {
        nonce: 'nonce'
      });

      assert.deepEqual(await storage.reserveDownload('x'), {
        downloadCount: 1,
        downloadLimit: 1,
        finalDownload: true
      });
      await storage.del('x');
    });

    it('does not recreate metadata when reserving a missing file', async function() {
      assert.equal(await storage.reserveDownload('missing'), null);
      assert.equal(await storage.redis.hgetallAsync('missing'), null);
    });
  });

  describe('shared abuse state', function() {
    const rateKey = 'send:test:rate';
    const leaseKey = 'send:test:leases';

    afterEach(async function() {
      await storage.redis.delAsync(rateKey);
      await storage.redis.delAsync(leaseKey);
    });

    it('atomically enforces a fixed-window rate limit', async function() {
      const second = new storage.DB(config);
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          (index % 2 ? second : storage).takeRateLimit(rateKey, 2, 10000)
        )
      );
      assert.equal(results.filter(result => result.allowed).length, 2);
      assert.ok(results.every(result => result.retryAfter > 0));
    });

    it('shares concurrent leases across DB instances', async function() {
      const second = new storage.DB(config);
      assert.equal(
        await storage.acquireLease(leaseKey, 'one', 1, 10000, 1),
        true
      );
      assert.equal(
        await second.acquireLease(leaseKey, 'two', 1, 10000, 1),
        false
      );
      await storage.releaseLease(leaseKey, 'one');
      assert.equal(
        await second.acquireLease(leaseKey, 'two', 1, 10000, 1),
        true
      );
    });

    it('removes expired leases before checking capacity', async function() {
      assert.equal(
        await storage.acquireLease(leaseKey, 'old', 1, 10000, 1),
        true
      );
      assert.equal(
        await storage.acquireLease(leaseKey, 'new', 1, 10000, 10002),
        true
      );
    });

    it('refreshes only an existing lease token', async function() {
      await storage.acquireLease(leaseKey, 'one', 1, 10000, 1);
      assert.equal(await storage.refreshLease(leaseKey, 'one', 10000, 2), true);
      assert.equal(
        await storage.refreshLease(leaseKey, 'missing', 10000, 2),
        false
      );
    });
  });

  describe('del', function() {
    it('works', async function() {
      await storage.set('x', null, { foo: 'bar' });
      await storage.del('x');
      const meta = await storage.metadata('x');
      assert.equal(meta, null);
    });
  });

  describe('ping', function() {
    it('works', async function() {
      await storage.ping();
    });
  });

  describe('metadata', function() {
    it('returns all metadata fields', async function() {
      const m = {
        pwd: true,
        dl: 1,
        dlimit: 1,
        auth: 'foo',
        metadata: 'bar',
        nonce: 'baz',
        owner: 'bmo'
      };
      await storage.set('x', null, m);
      const meta = await storage.metadata('x');
      assert.deepEqual(meta, m);
    });
  });
});
