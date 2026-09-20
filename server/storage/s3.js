const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

class S3Storage {
  constructor(config, log) {
    this.bucket = config.s3_bucket;
    this.log = log;
    const cfg = {
      forcePathStyle: config.s3_use_path_style_endpoint,
      region: config.s3_region
    };
    if (config.s3_endpoint != '') {
      cfg.endpoint = config.s3_endpoint;
    }
    this.s3 = new S3Client(cfg);
  }

  async length(id) {
    const result = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: id })
    );
    return Number(result.ContentLength);
  }

  async getStream(id) {
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: id })
    );
    return result.Body;
  }

  async set(id, file) {
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: id,
        Body: file
      }
    });
    let sourceError;
    file.once('error', err => {
      sourceError = err;
      upload.abort();
    });
    try {
      return await upload.done();
    } catch (err) {
      // Upload.abort() reports an SDK abort error. Preserve the source stream
      // error exposed by the v2 adapter instead.
      throw sourceError || err;
    }
  }

  del(id) {
    return this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: id })
    );
  }

  ping() {
    return this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

module.exports = S3Storage;
