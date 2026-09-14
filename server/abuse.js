const crypto = require('crypto');
const config = require('./config');
const storage = require('./storage');

function userId(user) {
  if (!user) return null;
  if (typeof user === 'string' || typeof user === 'number') return String(user);
  return user.uid || user.sub || user.email || null;
}

function principal(req, user = req.user) {
  const account = userId(user);
  const raw = account ? `user:${account}` : `ip:${req.ip || 'unknown'}`;
  return crypto
    .createHash('sha256')
    .update(raw)
    .digest('hex');
}

function key(kind, principalId) {
  return `send:abuse:${kind}:${principalId}`;
}

function rejectRate(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  return res.sendStatus(429);
}

async function limitRequests(req, res, next) {
  try {
    const result = await storage.takeRateLimit(
      key('requests', principal(req)),
      config.request_rate_limit,
      config.request_rate_window_seconds * 1000
    );
    return result.allowed ? next() : rejectRate(res, result.retryAfter);
  } catch (error) {
    return res.sendStatus(503);
  }
}

async function acquireUpload(req, user = req.user, onLeaseLost = () => {}) {
  const principalId = principal(req, user);
  const rate = await storage.takeRateLimit(
    key('uploads', principalId),
    config.upload_rate_limit,
    config.upload_rate_window_seconds * 1000
  );
  if (!rate.allowed) return { retryAfter: rate.retryAfter };

  const leaseKey = key('active-uploads', principalId);
  const token = crypto.randomBytes(16).toString('hex');
  const leaseMs = config.upload_lease_seconds * 1000;
  if (
    !(await storage.acquireLease(
      leaseKey,
      token,
      config.max_concurrent_uploads,
      leaseMs
    ))
  ) {
    return { retryAfter: 1 };
  }

  let released = false;
  let leaseLost = false;
  const loseLease = () => {
    if (released || leaseLost) return;
    leaseLost = true;
    clearInterval(refresh);
    onLeaseLost();
  };
  const refresh = setInterval(async () => {
    try {
      if (!(await storage.refreshLease(leaseKey, token, leaseMs))) loseLease();
    } catch (error) {
      loseLease();
    }
  }, Math.max(Math.floor(leaseMs / 3), 100));
  refresh.unref();
  return {
    async release() {
      if (released || leaseLost) return;
      released = true;
      clearInterval(refresh);
      await storage.releaseLease(leaseKey, token);
    }
  };
}

async function limitUpload(req, res, next) {
  let disconnected = false;
  const markDisconnected = () => (disconnected = true);
  req.once('aborted', markDisconnected);
  res.once('close', markDisconnected);
  try {
    const reservation = await acquireUpload(req, req.user, () => {
      if (typeof req.destroy === 'function') req.destroy();
      if (res.headersSent && typeof res.destroy === 'function') res.destroy();
      else if (!res.headersSent) res.sendStatus(503);
    });
    if (!reservation.release) {
      return rejectRate(res, reservation.retryAfter);
    }
    const release = () => reservation.release().catch(() => {});
    res.once('finish', release);
    res.once('close', release);
    if (disconnected) {
      await reservation.release();
      return;
    }
    return next();
  } catch (error) {
    return res.sendStatus(503);
  }
}

module.exports = { acquireUpload, limitRequests, limitUpload, principal };
