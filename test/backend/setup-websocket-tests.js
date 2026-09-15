const assert = require('assert');
const express = require('express');
const WebSocket = require('ws');
const setupWebSocket = require('../../server/setupWebSocket');

describe('WebSocket setup', function() {
  it('routes WebSocket connections without the legacy ESM loader', function() {
    return new Promise((resolve, reject) => {
      const app = express();
      const instance = setupWebSocket(app);
      app.ws('/socket', socket => socket.send('connected'));
      const server = app.listen(0, '127.0.0.1', () => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${server.address().port}/socket`
        );
        socket.once('message', message => {
          try {
            assert.equal(message.toString(), 'connected');
            socket.close();
            instance.getWss().close();
            server.close(resolve);
          } catch (error) {
            reject(error);
          }
        });
        socket.once('error', reject);
      });
    });
  });
});
