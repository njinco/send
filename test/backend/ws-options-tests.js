const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const wsOptions = require('../../server/wsOptions');

describe('WebSocket transport limits', function() {
  it('disables compression and permits encrypted upload frames', function() {
    assert.equal(wsOptions.perMessageDeflate, false);
    assert.ok(wsOptions.maxPayload >= 64 * 1024);
  });

  it('keeps the transport frame-safe when the control cap is lower', function() {
    const proxyquire = require('proxyquire').noCallThru();
    const options = proxyquire('../../server/wsOptions', {
      './config': { max_control_message_size: 1024 }
    });
    assert.equal(options.maxPayload, 64 * 1024);
  });

  it('accepts a 64 KiB encrypted upload frame', function() {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const socketServer = new WebSocket.Server({ server, ...wsOptions });
      socketServer.on('connection', socket => {
        socket.once('message', message => {
          try {
            assert.equal(message.length, 64 * 1024);
            socket.close();
            socketServer.close();
            server.close();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
        socket.on('open', () => socket.send(Buffer.alloc(64 * 1024)));
        socket.on('error', reject);
      });
    });
  });
});
