const mozlog = require('./log');

const log = mozlog('send.websocket');

module.exports = function attachEarlyErrorHandler(wsServer) {
  wsServer.on('connection', ws => {
    ws.on('error', error => log.error('WebSocket:', error));
  });
};
