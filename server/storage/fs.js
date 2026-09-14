const fs = require('fs');
const path = require('path');
const promisify = require('util').promisify;
const pipeline = promisify(require('stream').pipeline);

const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

class FSStorage {
  constructor(config, log) {
    this.log = log;
    this.dir = config.file_dir;
    fs.mkdirSync(this.dir, {
      recursive: true
    });
  }

  async length(id) {
    const result = await stat(path.join(this.dir, id));
    return result.size;
  }

  getStream(id) {
    return fs.createReadStream(path.join(this.dir, id));
  }

  async set(id, file) {
    const filepath = path.join(this.dir, id);
    try {
      await pipeline(file, fs.createWriteStream(filepath));
    } catch (err) {
      try {
        await unlink(filepath);
      } catch (unlinkErr) {
        if (unlinkErr.code !== 'ENOENT') {
          this.log.error('File cleanup:', unlinkErr);
        }
      }
      throw err;
    }
  }

  del(id) {
    return unlink(path.join(this.dir, id));
  }

  ping() {
    return Promise.resolve();
  }
}

module.exports = FSStorage;
