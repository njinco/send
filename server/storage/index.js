const config = require('../config');
const Metadata = require('../metadata');
const mozlog = require('../log');
const createRedisClient = require('./redis');

const ROTATE_NONCE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'nonce') ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'nonce', ARGV[2])
return 1
`;

const RESERVE_DOWNLOAD_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 or
   redis.call('HEXISTS', KEYS[1], 'prefix') == 0 then
  return {0, 0}
end
local limit = tonumber(redis.call('HGET', KEYS[1], 'dlimit') or '1')
local downloads = tonumber(redis.call('HGET', KEYS[1], 'dl') or '0')
if not limit or not downloads or downloads >= limit then
  return {0, 0}
end
local reserved = redis.call('HINCRBY', KEYS[1], 'dl', 1)
return {reserved, limit}
`;

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('PTTL', KEYS[1])
if count > tonumber(ARGV[1]) then
  return {0, ttl}
end
return {1, ttl}
`;

const ACQUIRE_LEASE_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

const REFRESH_LEASE_SCRIPT = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

let atomicFallback = Promise.resolve();

function getPrefix(seconds) {
  return Math.max(Math.floor(seconds / 86400), 1);
}

class DB {
  constructor(config) {
    let Storage = null;
    if (config.s3_bucket) {
      Storage = require('./s3');
    } else if (config.gcs_bucket) {
      Storage = require('./gcs');
    } else {
      Storage = require('./fs');
    }
    this.log = mozlog('send.storage');

    this.storage = new Storage(config, this.log);

    this.redis = createRedisClient(config);
    this.redis.on('error', err => {
      this.log.error('Redis:', err);
    });
  }

  async ttl(id) {
    const result = await this.redis.ttlAsync(id);
    return Math.ceil(result) * 1000;
  }

  async getPrefixedId(id) {
    const prefix = await this.redis.hgetAsync(id, 'prefix');
    return `${prefix}-${id}`;
  }

  async length(id) {
    const filePath = await this.getPrefixedId(id);
    return this.storage.length(filePath);
  }

  async get(id) {
    const filePath = await this.getPrefixedId(id);
    return this.storage.getStream(filePath);
  }

  async set(id, file, meta, expireSeconds = config.default_expire_seconds) {
    const prefix = getPrefix(expireSeconds);
    const filePath = `${prefix}-${id}`;
    try {
      await this.storage.set(filePath, file);
      await this.redis.hmsetAsync(id, { prefix, ...meta });
      await this.redis.expireAsync(id, expireSeconds);
    } catch (err) {
      await this.cleanupFailedSet(id, filePath);
      throw err;
    }
  }

  async cleanupFailedSet(id, filePath) {
    try {
      await this.redis.delAsync(id);
    } catch (err) {
      this.log.error('storageCleanup', err);
      return;
    }
    try {
      await this.storage.del(filePath);
    } catch (err) {
      this.log.error('storageCleanup', err);
    }
  }

  setField(id, key, value) {
    return this.redis.hsetAsync(id, key, value);
  }

  setFields(id, values) {
    return this.redis.hmsetAsync(id, values);
  }

  incrementField(id, key, increment = 1) {
    return this.redis.hincrbyAsync(id, key, increment);
  }

  runAtomicFallback(operation) {
    const result = atomicFallback.then(operation);
    atomicFallback = result.catch(() => {});
    return result;
  }

  async takeRateLimit(key, limit, windowMs) {
    let result;
    if (this.redis.supportsAtomicScripts) {
      result = await this.redis.evalAsync(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        limit,
        windowMs
      );
    } else {
      result = await this.runAtomicFallback(async () => {
        const count = await this.redis.incrAsync(key);
        if (count === 1) {
          await this.redis.pexpireAsync(key, windowMs);
        }
        const ttl = await this.redis.pttlAsync(key);
        return [count <= limit ? 1 : 0, ttl];
      });
    }
    return {
      allowed: Number(result[0]) === 1,
      retryAfter: Math.max(Math.ceil(Number(result[1]) / 1000), 1)
    };
  }

  async acquireLease(key, token, limit, leaseMs, now = Date.now()) {
    const expiresAt = now + leaseMs;
    if (this.redis.supportsAtomicScripts) {
      return (
        (await this.redis.evalAsync(
          ACQUIRE_LEASE_SCRIPT,
          1,
          key,
          now,
          limit,
          expiresAt,
          token,
          leaseMs
        )) === 1
      );
    }
    return this.runAtomicFallback(async () => {
      await this.redis.zremrangebyscoreAsync(key, '-inf', now);
      if ((await this.redis.zcardAsync(key)) >= limit) {
        return false;
      }
      await this.redis.zaddAsync(key, expiresAt, token);
      await this.redis.pexpireAsync(key, leaseMs);
      return true;
    });
  }

  async refreshLease(key, token, leaseMs, now = Date.now()) {
    const expiresAt = now + leaseMs;
    if (this.redis.supportsAtomicScripts) {
      return (
        (await this.redis.evalAsync(
          REFRESH_LEASE_SCRIPT,
          1,
          key,
          token,
          expiresAt,
          leaseMs
        )) === 1
      );
    }
    return this.runAtomicFallback(async () => {
      const score = await this.redis.zscoreAsync(key, token);
      if (score === null) {
        return false;
      }
      await this.redis.zaddAsync(key, expiresAt, token);
      await this.redis.pexpireAsync(key, leaseMs);
      return true;
    });
  }

  releaseLease(key, token) {
    return this.redis.zremAsync(key, token);
  }

  async rotateNonce(id, expectedNonce, newNonce) {
    if (this.redis.supportsAtomicScripts) {
      const result = await this.redis.evalAsync(
        ROTATE_NONCE_SCRIPT,
        1,
        id,
        expectedNonce,
        newNonce
      );
      return result === 1;
    }

    // redis-mock has no EVAL support. Serialize this test/development fallback
    // so its behavior matches the production Lua compare-and-set operation.
    return this.runAtomicFallback(async () => {
      const nonce = await this.redis.hgetAsync(id, 'nonce');
      if (nonce !== expectedNonce) {
        return false;
      }
      await this.redis.hsetAsync(id, 'nonce', newNonce);
      return true;
    });
  }

  async reserveDownload(id) {
    let result;
    if (this.redis.supportsAtomicScripts) {
      result = await this.redis.evalAsync(RESERVE_DOWNLOAD_SCRIPT, 1, id);
    } else {
      // See rotateNonce: this path exists only because redis-mock cannot run
      // Lua. Real Redis always performs the check and increment atomically.
      result = await this.runAtomicFallback(async () => {
        const values = await this.redis.hgetallAsync(id);
        if (!values || !values.prefix) {
          return [0, 0];
        }
        const limit = values && Number(values.dlimit || 1);
        const downloads = values && Number(values.dl || 0);
        if (!limit || !Number.isFinite(downloads) || downloads >= limit) {
          return [0, 0];
        }
        const reserved = await this.redis.hincrbyAsync(id, 'dl', 1);
        return [reserved, limit];
      });
    }

    const downloadCount = Number(result[0]);
    const downloadLimit = Number(result[1]);
    if (!downloadCount || !downloadLimit) {
      return null;
    }
    return {
      downloadCount,
      downloadLimit,
      finalDownload: downloadCount >= downloadLimit
    };
  }

  async del(id) {
    const metadata = await this.redis.hgetallAsync(id);
    const ttl = await this.redis.ttlAsync(id);
    const expiresAt = ttl >= 0 ? Date.now() + ttl * 1000 : null;
    const filePath = `${metadata && metadata.prefix}-${id}`;

    await this.redis.delAsync(id);
    try {
      await this.storage.del(filePath);
    } catch (err) {
      if (metadata && ttl !== -2) {
        let metadataRestored = false;
        try {
          await this.redis.hmsetAsync(id, metadata);
          metadataRestored = true;
          if (ttl >= 0) {
            const remainingTtl = Math.max(
              Math.ceil((expiresAt - Date.now()) / 1000),
              1
            );
            await this.redis.expireAsync(id, remainingTtl);
          }
        } catch (restoreErr) {
          this.log.error('Metadata restore:', restoreErr);
          if (metadataRestored) {
            try {
              await this.redis.delAsync(id);
            } catch (cleanupErr) {
              this.log.error('Metadata restore cleanup:', cleanupErr);
            }
          }
        }
      }
      throw err;
    }
  }

  async ping() {
    await this.redis.pingAsync();
    await this.storage.ping();
  }

  async metadata(id) {
    const result = await this.redis.hgetallAsync(id);
    return result && new Metadata(result);
  }
}

module.exports = new DB(config);
module.exports.DB = DB;
