const assert = require('assert');
const { PassThrough } = require('stream');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const fileStub = {
  createReadStream: sinon.stub(),
  createWriteStream: sinon.stub(),
  delete: sinon.stub(),
  getMetadata: sinon.stub()
};
const bucketStub = {
  exists: sinon.stub(),
  file: sinon.stub().returns(fileStub)
};
const Storage = sinon.stub().returns({
  bucket: sinon.stub().returns(bucketStub)
});

const GCSStorage = proxyquire('../../server/storage/gcs', {
  '@google-cloud/storage': { Storage }
});

describe('GCSStorage', function() {
  beforeEach(function() {
    bucketStub.exists.reset();
    bucketStub.file.resetHistory();
    fileStub.createReadStream.reset();
    fileStub.createWriteStream.reset();
    fileStub.delete.reset();
    fileStub.getMetadata.reset();
  });

  it('uses Application Default Credentials and selects the configured bucket', function() {
    const storage = new GCSStorage({ gcs_bucket: 'bucket' });

    sinon.assert.calledOnceWithExactly(Storage);
    sinon.assert.calledWithExactly(
      Storage.firstCall.returnValue.bucket,
      'bucket'
    );
    assert.equal(storage.bucket, bucketStub);
  });

  describe('length', function() {
    it('returns the object metadata size', async function() {
      fileStub.getMetadata.resolves([{ size: '123' }]);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      assert.equal(await storage.length('x'), '123');
      sinon.assert.calledWithExactly(bucketStub.file, 'x');
    });

    it('propagates metadata failures', async function() {
      const err = new Error('metadata failed');
      fileStub.getMetadata.rejects(err);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      await assert.rejects(storage.length('x'), value => value === err);
    });
  });

  describe('getStream', function() {
    it('returns a checksum-disabled object read stream', function() {
      const stream = new PassThrough();
      fileStub.createReadStream.returns(stream);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      assert.equal(storage.getStream('x'), stream);
      sinon.assert.calledWithExactly(fileStub.createReadStream, {
        validation: false
      });
    });

    it('propagates read-stream creation failures', function() {
      const err = new Error('read failed');
      fileStub.createReadStream.throws(err);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      assert.throws(
        () => storage.getStream('x'),
        value => value === err
      );
    });
  });

  describe('set', function() {
    it('pipes uploads to a resumable checksum-disabled object write stream', async function() {
      const source = new PassThrough();
      const output = new PassThrough();
      fileStub.createWriteStream.returns(output);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      const result = storage.set('x', source);
      source.end('file contents');
      await result;

      sinon.assert.calledWithExactly(fileStub.createWriteStream, {
        validation: false,
        resumable: true
      });
    });

    it('propagates source stream failures', async function() {
      const source = new PassThrough();
      const output = new PassThrough();
      fileStub.createWriteStream.returns(output);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });
      const err = new Error('source failed');
      const result = storage.set('x', source);
      source.destroy(err);

      await assert.rejects(result, value => value === err);
      assert.equal(output.destroyed, true);
    });

    it('propagates destination stream failures', async function() {
      const source = new PassThrough();
      const output = new PassThrough();
      fileStub.createWriteStream.returns(output);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });
      const err = new Error('write failed');
      const result = storage.set('x', source);
      output.destroy(err);

      await assert.rejects(result, value => value === err);
      assert.equal(source.destroyed, true);
    });
  });

  describe('del', function() {
    it('deletes the named object', async function() {
      const result = {};
      fileStub.delete.resolves(result);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      assert.equal(await storage.del('x'), result);
      sinon.assert.calledWithExactly(bucketStub.file, 'x');
    });

    it('propagates deletion failures', async function() {
      const err = new Error('delete failed');
      fileStub.delete.rejects(err);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      await assert.rejects(storage.del('x'), value => value === err);
    });
  });

  describe('ping', function() {
    it('checks whether the bucket exists', async function() {
      const result = [true];
      bucketStub.exists.resolves(result);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      assert.equal(await storage.ping(), result);
      sinon.assert.calledOnce(bucketStub.exists);
    });

    it('propagates bucket health-check failures', async function() {
      const err = new Error('unavailable');
      bucketStub.exists.rejects(err);
      const storage = new GCSStorage({ gcs_bucket: 'bucket' });

      await assert.rejects(storage.ping(), value => value === err);
    });
  });
});
