const assert = require('assert');
const { EventEmitter } = require('events');
const path = require('path');
const { spawnSync } = require('child_process');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

class DeleteObjectCommand {
  constructor(input) {
    this.input = input;
  }
}
class GetObjectCommand {
  constructor(input) {
    this.input = input;
  }
}
class HeadBucketCommand {
  constructor(input) {
    this.input = input;
  }
}
class HeadObjectCommand {
  constructor(input) {
    this.input = input;
  }
}

const s3Stub = { send: sinon.stub() };
const S3Client = sinon.stub().returns(s3Stub);
const Upload = sinon.stub();

const S3Storage = proxyquire('../../server/storage/s3', {
  '@aws-sdk/client-s3': {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    S3Client
  },
  '@aws-sdk/lib-storage': { Upload }
});

const root = path.resolve(__dirname, '../..');

function commandSent(Command, input) {
  sinon.assert.calledWithMatch(s3Stub.send, sinon.match.instanceOf(Command));
  assert.deepEqual(s3Stub.send.lastCall.args[0].input, input);
}

function configResult(env) {
  return spawnSync(process.execPath, ['-e', "require('./server/config')"], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

describe('S3Storage', function() {
  beforeEach(function() {
    s3Stub.send.reset();
    S3Client.resetHistory();
    Upload.reset();
  });

  it('uses the bucket, region, endpoint, and path-style configuration', function() {
    const s = new S3Storage({
      s3_bucket: 'foo',
      s3_region: 'us-east-1',
      s3_endpoint: 'http://minio:9000',
      s3_use_path_style_endpoint: true
    });
    assert.equal(s.bucket, 'foo');
    sinon.assert.calledWithMatch(S3Client, {
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      region: 'us-east-1'
    });
  });

  it('does not configure an empty endpoint', function() {
    new S3Storage({
      s3_bucket: 'foo',
      s3_region: 'us-east-1',
      s3_endpoint: '',
      s3_use_path_style_endpoint: false
    });
    assert.deepEqual(S3Client.lastCall.args[0], {
      forcePathStyle: false,
      region: 'us-east-1'
    });
  });

  it('rejects S3 configuration without a region', function() {
    const result = configResult({ S3_BUCKET: 'bucket', AWS_REGION: '' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AWS_REGION must be a non-empty value/);
  });

  it('rejects a whitespace-only S3 region', function() {
    const result = configResult({ S3_BUCKET: 'bucket', AWS_REGION: '   ' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AWS_REGION must be a non-empty value/);
  });

  it('accepts a configured S3 region', function() {
    const result = configResult({
      S3_BUCKET: 'bucket',
      AWS_REGION: 'us-east-1'
    });
    assert.equal(result.status, 0, result.stderr);
  });

  describe('length', function() {
    it('returns the ContentLength', async function() {
      s3Stub.send.resolves({ ContentLength: 123 });
      const s = new S3Storage({ s3_bucket: 'foo' });
      assert.equal(await s.length('x'), 123);
      commandSent(HeadObjectCommand, { Bucket: 'foo', Key: 'x' });
    });

    it('propagates a head-object error', async function() {
      const err = new Error('not found');
      s3Stub.send.rejects(err);
      const s = new S3Storage({ s3_bucket: 'foo' });
      await assert.rejects(s.length('x'), value => value === err);
    });
  });

  describe('getStream', function() {
    it('returns the v3 response body stream', async function() {
      const stream = {};
      s3Stub.send.resolves({ Body: stream });
      const s = new S3Storage({ s3_bucket: 'foo' });
      assert.equal(await s.getStream('x'), stream);
      commandSent(GetObjectCommand, { Bucket: 'foo', Key: 'x' });
    });

    it('propagates a get-object error', async function() {
      const err = new Error('get failed');
      s3Stub.send.rejects(err);
      const s = new S3Storage({ s3_bucket: 'foo' });
      await assert.rejects(s.getStream('x'), value => value === err);
    });
  });

  describe('set', function() {
    it('uses managed multipart uploads with the v3 client', async function() {
      const file = new EventEmitter();
      const result = { ETag: 'etag' };
      const upload = {
        abort: sinon.stub(),
        done: sinon.stub().resolves(result)
      };
      Upload.returns(upload);
      const s = new S3Storage({ s3_bucket: 'foo' });

      assert.equal(await s.set('x', file), result);
      sinon.assert.calledWithMatch(Upload, {
        client: s3Stub,
        params: { Bucket: 'foo', Key: 'x', Body: file }
      });
      sinon.assert.calledOnce(upload.done);
    });

    it('aborts and preserves the source error when the file stream fails', async function() {
      const file = new EventEmitter();
      const sourceError = new Error('limit');
      const upload = {
        abort: sinon.stub(),
        done: sinon.stub().callsFake(
          () =>
            new Promise((resolve, reject) => {
              file.once('error', () => reject(new Error('upload aborted')));
            })
        )
      };
      Upload.returns(upload);
      const s = new S3Storage({ s3_bucket: 'foo' });
      const result = s.set('x', file);
      file.emit('error', sourceError);

      await assert.rejects(result, value => value === sourceError);
      sinon.assert.calledOnce(upload.abort);
    });

    it('propagates managed-upload errors', async function() {
      const file = new EventEmitter();
      const err = new Error('upload failed');
      Upload.returns({ abort: sinon.stub(), done: sinon.stub().rejects(err) });
      const s = new S3Storage({ s3_bucket: 'foo' });
      await assert.rejects(s.set('x', file), value => value === err);
    });
  });

  describe('del', function() {
    it('sends a delete-object command', async function() {
      const result = { Deleted: true };
      s3Stub.send.resolves(result);
      const s = new S3Storage({ s3_bucket: 'foo' });
      assert.equal(await s.del('x'), result);
      commandSent(DeleteObjectCommand, { Bucket: 'foo', Key: 'x' });
    });

    it('propagates deletion errors', async function() {
      const err = new Error('delete failed');
      s3Stub.send.rejects(err);
      const s = new S3Storage({ s3_bucket: 'foo' });
      await assert.rejects(s.del('x'), value => value === err);
    });
  });

  describe('ping', function() {
    it('sends a head-bucket command', async function() {
      const result = {};
      s3Stub.send.resolves(result);
      const s = new S3Storage({ s3_bucket: 'foo' });
      assert.equal(await s.ping(), result);
      commandSent(HeadBucketCommand, { Bucket: 'foo' });
    });

    it('propagates head-bucket errors', async function() {
      const err = new Error('unavailable');
      s3Stub.send.rejects(err);
      const s = new S3Storage({ s3_bucket: 'foo' });
      await assert.rejects(s.ping(), value => value === err);
    });
  });
});
