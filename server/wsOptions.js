const config = require('./config');
const MIN_WEBSOCKET_PAYLOAD_SIZE = 64 * 1024;

module.exports = {
  perMessageDeflate: false,
  maxPayload: Math.max(
    config.max_control_message_size,
    MIN_WEBSOCKET_PAYLOAD_SIZE
  )
};

module.exports.MIN_WEBSOCKET_PAYLOAD_SIZE = MIN_WEBSOCKET_PAYLOAD_SIZE;
