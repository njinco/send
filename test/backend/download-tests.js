const assert = require('assert');
const EventEmitter = require('events');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function createContext(reservation) {
  const storage = {
    reserveDownload: sinon.stub().resolves(reservation),
    length: sinon.stub().resolves(12),
    get: sinon.stub(),
    del: sinon.stub().resolves()
  };
  const fileStream = new EventEmitter();
  fileStream.destroy = sinon.stub();
  fileStream.pipe = sinon.stub();
  const req = new EventEmitter();
  req.params = { id: 'x' };
  const res = new EventEmitter();
  res.sendStatus = sinon.stub();
  res.writeHead = sinon.stub();
  res.destroy = sinon.stub();
  res.headersSent = false;
  fileStream.pipe.returns(res);
  storage.get.resolves(fileStream);
  const log = { info: sinon.stub() };
  const download = proxyquire('../../server/routes/download', {
    '../storage': storage,
    '../log': () => log
  });
  return { download, fileStream, log, req, res, storage };
}

describe('/api/download', function() {
  it('reserves a download before opening the object', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 2,
      finalDownload: false
    });

    await context.download(context.req, context.res);

    sinon.assert.callOrder(
      context.storage.reserveDownload,
      context.storage.length,
      context.storage.get
    );
    sinon.assert.calledWith(context.res.writeHead, 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': 12
    });
  });

  it('rejects a download when no reservation remains', async function() {
    const context = createContext(null);

    await context.download(context.req, context.res);

    sinon.assert.calledWith(context.res.sendStatus, 404);
    sinon.assert.notCalled(context.storage.length);
    sinon.assert.notCalled(context.storage.get);
  });

  it('does not roll back a reservation when a download is cancelled', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 2,
      finalDownload: false
    });
    await context.download(context.req, context.res);

    context.req.emit('aborted');
    await tick();

    sinon.assert.calledOnce(context.fileStream.destroy);
    sinon.assert.notCalled(context.storage.del);
    sinon.assert.calledOnce(context.storage.reserveDownload);
  });

  it('deletes the object after the final download finishes', async function() {
    const context = createContext({
      downloadCount: 2,
      downloadLimit: 2,
      finalDownload: true
    });
    await context.download(context.req, context.res);

    context.res.emit('finish');
    await tick();

    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
  });

  it('deletes the object when the final download is cancelled', async function() {
    const context = createContext({
      downloadCount: 2,
      downloadLimit: 2,
      finalDownload: true
    });
    await context.download(context.req, context.res);

    context.req.emit('aborted');
    context.res.emit('finish');
    await tick();

    sinon.assert.calledOnce(context.fileStream.destroy);
    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
  });

  it('cleans up a final reservation when the response closes', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    await context.download(context.req, context.res);

    context.res.emit('close');
    await tick();

    sinon.assert.calledOnce(context.fileStream.destroy);
    sinon.assert.calledOnce(context.res.destroy);
    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
  });

  it('handles cancellation while object setup is still pending', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    const length = deferred();
    context.storage.length.returns(length.promise);

    const result = context.download(context.req, context.res);
    await tick();
    context.req.emit('aborted');
    length.resolve(12);
    await result;

    sinon.assert.notCalled(context.storage.get);
    sinon.assert.notCalled(context.res.writeHead);
    sinon.assert.calledOnce(context.res.destroy);
    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
  });

  it('does not write a status if cancelled object setup later rejects', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    const length = deferred();
    context.storage.length.returns(length.promise);

    const result = context.download(context.req, context.res);
    await tick();
    context.req.emit('aborted');
    length.reject(new Error('late setup failure'));
    await result;

    sinon.assert.notCalled(context.res.sendStatus);
    sinon.assert.notCalled(context.res.writeHead);
    sinon.assert.calledOnce(context.res.destroy);
    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
  });

  it('handles source stream errors without leaving the final reservation open', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    await context.download(context.req, context.res);

    context.fileStream.emit('error', new Error('source failed'));
    await tick();

    sinon.assert.calledOnce(context.fileStream.destroy);
    sinon.assert.calledOnce(context.res.destroy);
    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
    sinon.assert.calledWith(context.log.info, 'StorageError:', 'x');
  });

  it('handles response errors without leaving the final reservation open', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    await context.download(context.req, context.res);

    context.res.emit('error', new Error('response failed'));
    await tick();

    sinon.assert.calledOnce(context.fileStream.destroy);
    sinon.assert.calledOnce(context.res.destroy);
    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
  });

  it('keeps the final reservation closed if object setup fails', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    context.storage.length.rejects(new Error('object unavailable'));

    await context.download(context.req, context.res);

    sinon.assert.calledOnceWithExactly(context.storage.del, 'x');
    sinon.assert.calledWith(context.res.sendStatus, 404);
  });

  it('reports final cleanup errors without reopening the reservation', async function() {
    const context = createContext({
      downloadCount: 1,
      downloadLimit: 1,
      finalDownload: true
    });
    const error = new Error('delete failed');
    context.storage.del.rejects(error);
    await context.download(context.req, context.res);

    context.res.emit('finish');
    await tick();

    sinon.assert.calledWith(context.log.info, 'StorageError:', 'x');
    assert.equal(context.storage.del.callCount, 1);
  });
});
