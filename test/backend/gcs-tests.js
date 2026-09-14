const assert = require('assert');
const { PassThrough } = require('stream');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const output = new PassThrough();
const fileStub = {
  createWriteStream: sinon.stub().returns(output),
  delete: sinon.stub()
};
const bucketStub = {
  file: sinon.stub().returns(fileStub)
};

const GCSStorage = proxyquire('../../server/storage/gcs', {
  '@google-cloud/storage': {
    Storage: function() {
      return {
        bucket: sinon.stub().returns(bucketStub)
      };
    }
  }
});

describe('GCSStorage', function() {
  it('propagates source stream failures', async function() {
    const storage = new GCSStorage({ gcs_bucket: 'bucket' });
    const source = new PassThrough();
    const err = new Error('source failed');
    const result = storage.set('x', source);
    source.destroy(err);

    await assert.rejects(result, value => value === err);
  });

  it('propagates deletion failures', async function() {
    const storage = new GCSStorage({ gcs_bucket: 'bucket' });
    const err = new Error('delete failed');
    fileStub.delete.rejects(err);

    await assert.rejects(storage.del('x'), value => value === err);
  });
});
