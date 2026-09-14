const config = require('../config');
const storage = require('../storage');
const { isBoundedInteger } = require('../validation');

module.exports = async function(req, res) {
  const max = config.max_downloads;
  const dlimit = req.body.dlimit;
  if (!isBoundedInteger(dlimit, 1, max)) {
    return res.sendStatus(400);
  }

  try {
    await storage.setField(req.params.id, 'dlimit', dlimit);
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(404);
  }
};
