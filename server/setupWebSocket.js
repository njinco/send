const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const wsOptions = require('./wsOptions');
const attachEarlyErrorHandler = require('./webSocketErrors');

// WebSocket route integration adapted from express-ws (BSD-2-Clause).
// See THIRD_PARTY_NOTICES for attribution.
function websocketUrl(url) {
  const separator = url.indexOf('?');
  const path = separator === -1 ? url : url.slice(0, separator);
  const query = separator === -1 ? '' : url.slice(separator);
  return `${path.endsWith('/') ? path : `${path}/`}.websocket${query}`;
}

function wrapMiddleware(middleware) {
  return (req, res, next) => {
    if (!req.ws) {
      return next();
    }
    req.wsHandled = true;
    try {
      middleware(req.ws, req, next);
    } catch (error) {
      next(error);
    }
  };
}

function addWsMethod(target) {
  if (target.ws) {
    return;
  }
  target.ws = function addWsRoute(route, ...middlewares) {
    this.get(websocketUrl(route), ...middlewares.map(wrapMiddleware));
    return this;
  };
}

module.exports = function setupWebSocket(app) {
  const server = http.createServer(app);
  app.listen = (...args) => server.listen(...args);
  addWsMethod(app);
  addWsMethod(express.Router);

  const socketServer = new WebSocket.Server({ ...wsOptions, server });
  attachEarlyErrorHandler(socketServer);
  socketServer.on('connection', (socket, request) => {
    request.ws = socket;
    request.wsHandled = false;
    request.url = websocketUrl(request.url);

    const response = new http.ServerResponse(request);
    response.writeHead = function writeHead(statusCode) {
      if (statusCode > 200) {
        response._header = '';
        socket.close();
      }
    };

    app.handle(request, response, () => {
      if (!request.wsHandled) {
        socket.close();
      }
    });
  });

  return {
    app,
    getWss: () => socketServer,
    applyTo: addWsMethod
  };
};
