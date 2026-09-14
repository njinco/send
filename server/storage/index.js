const config = require('../config');
const Metadata = require('../metadata');
const mozlog = require('../log');
const createRedisClient = require('./redis');

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
      this.log.error('Storage cleanup:', err);
      return;
    }
    try {
      await this.storage.del(filePath);
    } catch (err) {
      this.log.error('Storage cleanup:', err);
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
