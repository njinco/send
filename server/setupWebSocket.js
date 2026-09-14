const expressWs = require('@dannycoates/express-ws');
const wsOptions = require('./wsOptions');
const attachEarlyErrorHandler = require('./webSocketErrors');

module.exports = function setupWebSocket(app) {
  const instance = expressWs(app, null, { wsOptions });
  attachEarlyErrorHandler(instance.getWss());
  return instance;
};
