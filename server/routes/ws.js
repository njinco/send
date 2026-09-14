const crypto = require('crypto');
const storage = require('../storage');
const config = require('../config');
const mozlog = require('../log');
const Limiter = require('../limiter');
const fxa = require('../fxa');
const abuse = require('../abuse');
const { isBoundedInteger, parseAuthorization } = require('../validation');
const { encryptedSize } = require('../../app/utils');

const { Transform } = require('stream');

const log = mozlog('send.upload');

module.exports = function(ws, req) {
  let fileStream;
  let releaseUpload;
  let fileStreamDestroyed = false;
  let disconnected = false;

  async function releaseCurrentUpload() {
    if (!releaseUpload) return;
    const release = releaseUpload;
    releaseUpload = null;
    try {
      await release();
    } catch (error) {
      log.error('Upload lease release:', error);
    }
  }

  function destroyFileStream() {
    if (fileStream !== undefined && !fileStreamDestroyed) {
      fileStreamDestroyed = true;
      fileStream.destroy();
    }
  }

  ws.on('error', error => {
    log.error('WebSocket:', error);
    releaseCurrentUpload();
    destroyFileStream();
  });

  ws.on('close', e => {
    disconnected = true;
    releaseCurrentUpload();
    if (e !== 1000) destroyFileStream();
  });

  ws.once('message', async function(message) {
    try {
      if (Buffer.byteLength(message) > config.max_control_message_size) {
        ws.send(JSON.stringify({ error: 413 }));
        return ws.close();
      }
      const newId = crypto.randomBytes(8).toString('hex');
      const owner = crypto.randomBytes(10).toString('hex');

      let fileInfo;
      try {
        fileInfo = JSON.parse(message);
      } catch (e) {
        ws.send(JSON.stringify({ error: 400 }));
        return ws.close();
      }
      if (
        !fileInfo ||
        typeof fileInfo !== 'object' ||
        Array.isArray(fileInfo)
      ) {
        ws.send(JSON.stringify({ error: 400 }));
        return ws.close();
      }
      const timeLimit =
        fileInfo.timeLimit === undefined
          ? config.default_expire_seconds
          : fileInfo.timeLimit;
      const dlimit =
        fileInfo.dlimit === undefined
          ? config.default_downloads
          : fileInfo.dlimit;
      const metadata = fileInfo.fileMetadata;
      const auth = parseAuthorization(fileInfo.authorization, 'send-v1', [64]);
      const user = await fxa.verify(fileInfo.bearer);
      const maxFileSize = config.max_file_size;
      const maxExpireSeconds = config.max_expire_seconds;
      const maxDownloads = config.max_downloads;

      if (config.fxa_required && !user) {
        ws.send(
          JSON.stringify({
            error: 401
          })
        );
        return ws.close();
      }
      if (
        typeof metadata !== 'string' ||
        metadata.length === 0 ||
        !auth ||
        !isBoundedInteger(timeLimit, 1, maxExpireSeconds) ||
        !isBoundedInteger(dlimit, 1, maxDownloads)
      ) {
        ws.send(
          JSON.stringify({
            error: 400
          })
        );
        return ws.close();
      }
      if (Buffer.byteLength(metadata) > config.max_metadata_size) {
        ws.send(JSON.stringify({ error: 413 }));
        return ws.close();
      }

      const uploadReservation = await abuse.acquireUpload(req, user, () => {
        destroyFileStream();
        if (ws.readyState === 1) ws.close(1011);
        else if (typeof ws.terminate === 'function') ws.terminate();
      });
      if (!uploadReservation.release) {
        ws.send(JSON.stringify({ error: 429 }));
        return ws.close();
      }
      releaseUpload = uploadReservation.release;
      if (disconnected || ws.readyState !== 1) {
        await releaseCurrentUpload();
        return;
      }

      const meta = {
        owner,
        metadata,
        dlimit,
        auth,
        nonce: crypto.randomBytes(16).toString('base64')
      };

      const url = `${config.deriveBaseUrl(req)}/download/${newId}/`;

      ws.send(
        JSON.stringify({
          url,
          ownerToken: meta.owner,
          id: newId
        })
      );
      const limiter = new Limiter(encryptedSize(maxFileSize));
      const eof = new Transform({
        transform: function(chunk, encoding, callback) {
          if (chunk.length === 1 && chunk[0] === 0) {
            this.push(null);
          } else {
            this.push(chunk);
          }
          callback();
        }
      });
      const wsStream = ws.constructor.createWebSocketStream(ws);
      wsStream.on('error', error => {
        log.error('WebSocket stream:', error);
        releaseCurrentUpload();
        destroyFileStream();
      });

      fileStream = wsStream.pipe(eof).pipe(limiter); // limiter needs to be the last in the chain

      await storage.set(newId, fileStream, meta, timeLimit);
      await releaseCurrentUpload();

      if (ws.readyState === 1) {
        // if the socket is closed by a cancelled upload the stream
        // ends without an error so we need to check the state
        // before sending a reply.

        // TODO: we should handle cancelled uploads differently
        // in order to avoid having to check socket state and clean
        // up storage, possibly with an exception that we can catch.
        ws.send(JSON.stringify({ ok: true }));
      }
    } catch (e) {
      log.error('upload', e);
      await releaseCurrentUpload();
      if (ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            error: e.message === 'limit' ? 413 : 500
          })
        );
      }
    }
    ws.close();
  });
};
