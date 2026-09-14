const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function request(metadata, authorization) {
  return {
    header: sinon
      .stub()
      .callsFake(name =>
        name === 'X-File-Metadata' ? metadata : authorization
      )
  };
}

function response() {
  return { sendStatus: sinon.stub() };
}

const storage = { set: sinon.stub() };
const upload = proxyquire('../../server/routes/upload', {
  '../storage': storage,
  '../config': { max_metadata_size: 8 }
});

describe('/api/upload validation', function() {
  afterEach(function() {
    storage.set.reset();
  });

  it('rejects malformed authorization without opening storage', async function() {
    const res = response();
    await upload(request('meta', `Send-v1 ${'A'.repeat(86)}`), res);
    sinon.assert.calledWith(res.sendStatus, 400);
    sinon.assert.notCalled(storage.set);
  });

  it('rejects empty metadata without opening storage', async function() {
    const res = response();
    await upload(request('', `send-v1 ${'A'.repeat(86)}`), res);
    sinon.assert.calledWith(res.sendStatus, 400);
    sinon.assert.notCalled(storage.set);
  });

  it('rejects oversized metadata with 413', async function() {
    const res = response();
    await upload(request('123456789', `send-v1 ${'A'.repeat(86)}`), res);
    sinon.assert.calledWith(res.sendStatus, 413);
    sinon.assert.notCalled(storage.set);
  });
});
