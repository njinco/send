const assert = require('assert');
const http = require('http');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const WebSocket = require('ws');
const attachEarlyErrorHandler = require('../../server/webSocketErrors');

describe('WebSocket route transport errors', function() {
  it('handles maxPayload errors before delayed route middleware attaches', function() {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const socketServer = new WebSocket.Server({ server, maxPayload: 128 });
      attachEarlyErrorHandler(socketServer);
      const delayedRoute = sinon.stub();
      socketServer.on('connection', socket =>
        setTimeout(() => delayedRoute(socket), 50)
      );
      server.listen(0, '127.0.0.1', () => {
        const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
        socket.on('open', () => {
          socket.send(Buffer.alloc(100), { fin: false });
          socket.send(Buffer.alloc(29), { fin: true });
        });
        socket.on('close', async code => {
          try {
            assert.equal(code, 1009);
            await new Promise(done => setTimeout(done, 60));
            sinon.assert.calledOnce(delayedRoute);
            socketServer.close();
            server.close(resolve);
          } catch (error) {
            socketServer.close();
            server.close(() => reject(error));
          }
        });
        socket.on('error', reject);
      });
    });
  });

  it('closes oversized fragmented uploads with 1009 and cleans resources', function() {
    const storage = { set: sinon.stub().returns(new Promise(() => {})) };
    const release = sinon.stub().resolves();
    const abuse = { acquireUpload: sinon.stub().resolves({ release }) };
    const log = { error: sinon.stub() };
    const route = proxyquire('../../server/routes/ws', {
      '../storage': storage,
      '../config': {
        default_expire_seconds: 60,
        default_downloads: 1,
        max_file_size: 1024,
        max_expire_seconds: 3600,
        max_downloads: 10,
        max_control_message_size: 256,
        max_metadata_size: 8,
        deriveBaseUrl: () => 'https://example.test'
      },
      '../fxa': { verify: sinon.stub().resolves(null) },
      '../abuse': abuse,
      '../log': () => log
    });

    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const socketServer = new WebSocket.Server({ server, maxPayload: 256 });
      attachEarlyErrorHandler(socketServer);
      socketServer.on('connection', route);
      server.listen(0, '127.0.0.1', () => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${server.address().port}/api/ws`
        );
        socket.on('open', () => {
          socket.send(
            JSON.stringify({
              authorization: `send-v1 ${'A'.repeat(86)}`,
              fileMetadata: 'meta',
              timeLimit: 60,
              dlimit: 1
            })
          );
        });
        socket.once('message', () => {
          socket.send(Buffer.alloc(200), { fin: false });
          socket.send(Buffer.alloc(57), { fin: true });
        });
        socket.on('close', async code => {
          try {
            await new Promise(done => setImmediate(done));
            assert.equal(code, 1009);
            sinon.assert.calledOnce(release);
            sinon.assert.calledWith(log.error, 'WebSocket:');
            assert.equal(storage.set.firstCall.args[1].destroyed, true);
            socketServer.close();
            server.close(resolve);
          } catch (error) {
            socketServer.close();
            server.close(() => reject(error));
          }
        });
        socket.on('error', reject);
      });
    });
  });
});
