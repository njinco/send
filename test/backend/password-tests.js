const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const storage = {
  setFields: sinon.stub()
};

function request(id, body) {
  return {
    params: { id },
    body
  };
}

function response() {
  return {
    sendStatus: sinon.stub()
  };
}

const passwordRoute = proxyquire('../../server/routes/password', {
  '../storage': storage
});
const validAuth = 'A'.repeat(43);

describe('/api/password', function() {
  afterEach(function() {
    storage.setFields.reset();
  });

  it('sets the password fields', async function() {
    const req = request('x', { auth: validAuth });
    const res = response();
    await passwordRoute(req, res);
    sinon.assert.calledWith(storage.setFields, 'x', {
      auth: validAuth,
      pwd: true
    });
    sinon.assert.calledWith(res.sendStatus, 200);
  });

  it('sends a 400 if auth is missing', async function() {
    const req = request('x', {});
    const res = response();
    await passwordRoute(req, res);
    sinon.assert.calledWith(res.sendStatus, 400);
  });

  it('sends a 400 if auth is not canonical base64url key material', async function() {
    for (const auth of ['z', `${validAuth}=`, `${validAuth} extra`]) {
      const req = request('x', { auth });
      const res = response();
      await passwordRoute(req, res);
      sinon.assert.calledWith(res.sendStatus, 400);
    }
    sinon.assert.notCalled(storage.setFields);
  });

  it('sends a 404 on failure', async function() {
    storage.setFields.rejects(new Error());
    const req = request('x', { auth: validAuth });
    const res = response();
    await passwordRoute(req, res);
    sinon.assert.calledWith(res.sendStatus, 404);
  });
});
