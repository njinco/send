const storage = require('../storage');
const { decodeBase64Url } = require('../validation');

module.exports = async function(req, res) {
  const id = req.params.id;
  const auth = req.body.auth;
  if (!decodeBase64Url(auth, [32, 64])) {
    return res.sendStatus(400);
  }

  try {
    await storage.setFields(id, { auth, pwd: true });
    res.sendStatus(200);
  } catch (e) {
    return res.sendStatus(404);
  }
};
