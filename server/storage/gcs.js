const { Storage } = require('@google-cloud/storage');
const promisify = require('util').promisify;
const pipeline = promisify(require('stream').pipeline);
const storage = new Storage();

class GCSStorage {
  constructor(config, log) {
    this.bucket = storage.bucket(config.gcs_bucket);
    this.log = log;
  }

  async length(id) {
    const data = await this.bucket.file(id).getMetadata();
    return data[0].size;
  }

  getStream(id) {
    return this.bucket.file(id).createReadStream({ validation: false });
  }

  set(id, file) {
    return pipeline(
      file,
      this.bucket.file(id).createWriteStream({
        validation: false,
        resumable: true
      })
    );
  }

  del(id) {
    return this.bucket.file(id).delete();
  }

  ping() {
    return this.bucket.exists();
  }
}

module.exports = GCSStorage;
