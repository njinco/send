const EventEmitter = require('events');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
}

function createContext(config = {}) {
  const storage = { set: sinon.stub() };
  storage.set.resolves();
  const fileStream = new EventEmitter();
  fileStream.destroy = sinon.stub();
  const wsStream = { pipe: sinon.stub() };
  wsStream.on = sinon.stub();
  wsStream.pipe.returns({ pipe: sinon.stub().returns(fileStream) });
  const ws = new EventEmitter();
  ws.send = sinon.stub();
  ws.close = sinon.stub();
  ws.readyState = 1;
  ws.constructor = { createWebSocketStream: sinon.stub().returns(wsStream) };
  const abuse = {
    acquireUpload: sinon.stub().returns({ release: sinon.stub() })
  };
  const route = proxyquire('../../server/routes/ws', {
    '../storage': storage,
    '../config': {
      default_expire_seconds: 60,
      default_downloads: 1,
      max_file_size: 1024,
      max_expire_seconds: 3600,
      max_downloads: 10,
      max_control_message_size: 128,
      max_metadata_size: 8,
      deriveBaseUrl: () => 'https://example.test',
      ...config
    },
    '../fxa': { verify: sinon.stub().resolves(null) },
    '../abuse': abuse,
    '../log': () => ({ error: sinon.stub() })
  });
  route(ws, { ip: '192.0.2.1' });
  return { abuse, fileStream, storage, ws };
}

describe('/api/ws control message validation', function() {
  it('rejects oversized control messages with 413', async function() {
    const { storage, ws } = createContext();
    ws.emit('message', Buffer.alloc(129));
    await tick();
    sinon.assert.calledWith(ws.send, JSON.stringify({ error: 413 }));
    sinon.assert.calledOnce(ws.close);
    sinon.assert.notCalled(storage.set);
  });

  it('rejects oversized metadata with 413', async function() {
    const { storage, ws } = createContext({ max_control_message_size: 512 });
    ws.emit(
      'message',
      JSON.stringify({
        authorization: `send-v1 ${'A'.repeat(86)}`,
        fileMetadata: '123456789',
        timeLimit: 60,
        dlimit: 1
      })
    );
    await tick();
    sinon.assert.calledWith(ws.send, JSON.stringify({ error: 413 }));
    sinon.assert.notCalled(storage.set);
  });

  it('rejects malformed JSON and non-object controls with 400', async function() {
    for (const message of ['{', 'null', '[]']) {
      const { storage, ws } = createContext();
      ws.emit('message', message);
      await tick();
      sinon.assert.calledWith(ws.send, JSON.stringify({ error: 400 }));
      sinon.assert.notCalled(storage.set);
    }
  });

  it('rejects coerced and fractional limits with 400', async function() {
    for (const [timeLimit, dlimit] of [
      ['60', 1],
      [60, 1.5]
    ]) {
      const { storage, ws } = createContext({
        max_control_message_size: 512
      });
      ws.emit(
        'message',
        JSON.stringify({
          authorization: `send-v1 ${'A'.repeat(86)}`,
          fileMetadata: 'meta',
          timeLimit,
          dlimit
        })
      );
      await tick();
      sinon.assert.calledWith(ws.send, JSON.stringify({ error: 400 }));
      sinon.assert.notCalled(storage.set);
    }
  });

  it('accepts boundary limits and preserves omitted defaults', async function() {
    for (const limits of [{ timeLimit: 3600, dlimit: 10 }, {}]) {
      const { abuse, storage, ws } = createContext({
        max_control_message_size: 512
      });
      ws.emit(
        'message',
        JSON.stringify({
          authorization: `send-v1 ${'A'.repeat(86)}`,
          fileMetadata: '12345678',
          ...limits
        })
      );
      await tick();
      sinon.assert.calledOnce(storage.set);
      sinon.assert.calledOnce(abuse.acquireUpload);
    }
  });

  it('returns 429 when the principal has no upload capacity', async function() {
    const { abuse, storage, ws } = createContext({
      max_control_message_size: 512
    });
    abuse.acquireUpload.returns({ retryAfter: 1 });
    ws.emit(
      'message',
      JSON.stringify({
        authorization: `send-v1 ${'A'.repeat(86)}`,
        fileMetadata: 'meta',
        timeLimit: 60,
        dlimit: 1
      })
    );
    await tick();
    sinon.assert.calledWith(ws.send, JSON.stringify({ error: 429 }));
    sinon.assert.notCalled(storage.set);
  });

  it('releases the upload lease when storage setup fails', async function() {
    const { abuse, storage, ws } = createContext({
      max_control_message_size: 512
    });
    storage.set.rejects(new Error('storage failed'));
    ws.emit(
      'message',
      JSON.stringify({
        authorization: `send-v1 ${'A'.repeat(86)}`,
        fileMetadata: 'meta',
        timeLimit: 60,
        dlimit: 1
      })
    );
    await tick();
    await tick();
    sinon.assert.calledOnce(abuse.acquireUpload.firstCall.returnValue.release);
    sinon.assert.calledWith(ws.send, JSON.stringify({ error: 500 }));
  });

  it('releases the upload lease once when the socket closes mid-upload', async function() {
    const { abuse, storage, ws } = createContext({
      max_control_message_size: 512
    });
    let completeStorage;
    storage.set.returns(new Promise(resolve => (completeStorage = resolve)));
    ws.emit(
      'message',
      JSON.stringify({
        authorization: `send-v1 ${'A'.repeat(86)}`,
        fileMetadata: 'meta',
        timeLimit: 60,
        dlimit: 1
      })
    );
    await tick();
    ws.emit('close', 1001);
    completeStorage();
    await tick();
    sinon.assert.calledOnce(abuse.acquireUpload.firstCall.returnValue.release);
  });

  it('releases a lease acquired after the socket disconnects', async function() {
    const { abuse, storage, ws } = createContext({
      max_control_message_size: 512
    });
    const acquisition = deferred();
    const release = sinon.stub().resolves();
    abuse.acquireUpload.returns(acquisition.promise);
    ws.emit(
      'message',
      JSON.stringify({
        authorization: `send-v1 ${'A'.repeat(86)}`,
        fileMetadata: 'meta',
        timeLimit: 60,
        dlimit: 1
      })
    );
    await tick();
    ws.emit('close', 1001);
    acquisition.resolve({ release });
    await tick();
    sinon.assert.calledOnce(release);
    sinon.assert.notCalled(storage.set);
  });

  it('closes and destroys the upload when its lease is lost', async function() {
    const { abuse, fileStream, storage, ws } = createContext({
      max_control_message_size: 512
    });
    storage.set.returns(new Promise(() => {}));
    ws.emit(
      'message',
      JSON.stringify({
        authorization: `send-v1 ${'A'.repeat(86)}`,
        fileMetadata: 'meta',
        timeLimit: 60,
        dlimit: 1
      })
    );
    await tick();
    const onLeaseLost = abuse.acquireUpload.firstCall.args[2];
    onLeaseLost();
    sinon.assert.calledWith(ws.close, 1011);
    sinon.assert.calledOnce(fileStream.destroy);
  });
});
