const storage = require('../storage');
const mozlog = require('../log');
const log = mozlog('send.download');

module.exports = async function(req, res) {
  const id = req.params.id;
  let reservation;
  let fileStream;
  let finalCleanup;
  let cancelled = false;
  let finished = false;

  const cleanupFinalDownload = () => {
    if (!reservation || !reservation.finalDownload) {
      return Promise.resolve();
    }
    if (!finalCleanup) {
      finalCleanup = storage.del(id).catch(() => {
        log.info('StorageError:', id);
      });
    }
    return finalCleanup;
  };

  const cancelTransfer = () => {
    cancelled = true;
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
    }
    if (typeof res.destroy === 'function' && !res.destroyed) {
      res.destroy();
    }
    cleanupFinalDownload();
  };

  try {
    reservation = await storage.reserveDownload(id);
    if (!reservation) {
      return res.sendStatus(404);
    }

    req.once('aborted', cancelTransfer);
    res.once('error', cancelTransfer);
    res.once('close', () => {
      if (!finished) {
        cancelTransfer();
      } else {
        cleanupFinalDownload();
      }
    });
    res.once('finish', () => {
      finished = true;
      cleanupFinalDownload();
    });

    if (req.aborted || res.destroyed) {
      cancelTransfer();
      await cleanupFinalDownload();
      return;
    }

    const contentLength = await storage.length(id);
    if (cancelled) {
      await cleanupFinalDownload();
      return;
    }

    fileStream = await storage.get(id);
    fileStream.once('error', () => {
      log.info('StorageError:', id);
      cancelTransfer();
    });
    if (cancelled) {
      fileStream.destroy();
      await cleanupFinalDownload();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': contentLength
    });
    fileStream.pipe(res);
  } catch (e) {
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
    }
    await cleanupFinalDownload();
    if (cancelled || res.destroyed) {
      return;
    } else if (!res.headersSent) {
      res.sendStatus(404);
    } else if (typeof res.destroy === 'function') {
      res.destroy();
    }
  }
};
