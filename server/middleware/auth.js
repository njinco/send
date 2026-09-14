const assert = require('assert');
const crypto = require('crypto');
const storage = require('../storage');
const config = require('../config');
const fxa = require('../fxa');
const {
  decodeBase64,
  decodeBase64Url,
  parseAuthorization
} = require('../validation');

module.exports = {
  hmac: async function(req, res, next) {
    const id = req.params.id;
    const auth = parseAuthorization(req.header('Authorization'), 'send-v1', [
      32
    ]);
    if (id && auth) {
      try {
        const meta = await storage.metadata(id);
        if (!meta) {
          return res.sendStatus(404);
        }
        const authKey = decodeBase64Url(meta.auth, [32, 64]);
        const nonce = decodeBase64(meta.nonce, [16]);
        if (!authKey || !nonce) {
          return res.sendStatus(401);
        }
        const hmac = crypto.createHmac('sha256', authKey);
        hmac.update(nonce);
        const verifyHash = hmac.digest();
        if (crypto.timingSafeEqual(verifyHash, decodeBase64Url(auth, [32]))) {
          req.nonce = crypto.randomBytes(16).toString('base64');
          if (await storage.rotateNonce(id, meta.nonce, req.nonce)) {
            res.set('WWW-Authenticate', `send-v1 ${req.nonce}`);
            req.authorized = true;
            req.meta = meta;
          } else {
            const currentMeta = await storage.metadata(id);
            if (!currentMeta) {
              return res.sendStatus(404);
            }
            res.set('WWW-Authenticate', `send-v1 ${currentMeta.nonce}`);
          }
        } else {
          res.set('WWW-Authenticate', `send-v1 ${meta.nonce}`);
          req.authorized = false;
        }
      } catch (e) {
        req.authorized = false;
      }
    }
    if (req.authorized) {
      next();
    } else {
      res.sendStatus(401);
    }
  },
  owner: async function(req, res, next) {
    const id = req.params.id;
    const ownerToken = req.body.owner_token;
    if (id && ownerToken) {
      try {
        req.meta = await storage.metadata(id);
        if (!req.meta) {
          return res.sendStatus(404);
        }
        const metaOwner = Buffer.from(req.meta.owner, 'utf8');
        const owner = Buffer.from(ownerToken, 'utf8');
        assert(metaOwner.length > 0);
        assert(metaOwner.length === owner.length);
        req.authorized = crypto.timingSafeEqual(metaOwner, owner);
      } catch (e) {
        req.authorized = false;
      }
    }
    if (req.authorized) {
      next();
    } else {
      res.sendStatus(401);
    }
  },
  fxa: async function(req, res, next) {
    const authHeader = req.header('Authorization');
    const match =
      typeof authHeader === 'string' && authHeader.match(/^Bearer ([^ ]+)$/);
    if (match) {
      const token = match[1];
      req.user = await fxa.verify(token);
    }

    if (config.fxa_required && !req.user) {
      res.sendStatus(401);
    } else {
      next();
    }
  }
};
