const assert = require('assert');
const os = require('os');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function loadLogger(env) {
  return proxyquire('../../server/log', {
    './config': { env }
  });
}

describe('server logger', function() {
  let write;

  beforeEach(function() {
    write = sinon.stub(process.stdout, 'write');
  });

  afterEach(function() {
    write.restore();
  });

  it('writes Heka-compatible production records without mozlog', function() {
    const log = loadLogger('production')('send.download');
    log.info('StorageError:', {
      id: 'abc',
      buffer: Buffer.from('c0ffee', 'hex')
    });

    sinon.assert.calledOnce(write);
    const output = JSON.parse(write.firstCall.args[0]);
    assert.equal(output.Logger, 'FirefoxSend');
    assert.equal(output.Type, 'send.download.StorageError:');
    assert.equal(output.Hostname, os.hostname());
    assert.equal(output.Severity, 6);
    assert.equal(output.Pid, process.pid);
    assert.equal(output.EnvVersion, '2.0');
    assert.equal(output.Fields.id, 'abc');
    assert.equal(output.Fields.buffer, 'c0ffee');
    assert.ok(Number.isInteger(output.Timestamp));
  });

  it('keeps error details and suppresses production debug output', function() {
    const log = loadLogger('production')('send.storage');
    const error = new Error('unavailable');
    error.secret = 'not-a-log-field';
    log.debug('ignored', { id: 'abc' });
    log.error('Redis:', error);

    sinon.assert.calledOnce(write);
    const output = JSON.parse(write.firstCall.args[0]);
    assert.equal(output.Type, 'send.storage.Redis:');
    assert.equal(output.Severity, 2);
    assert.equal(output.Fields.error, 'Error: unavailable');
    assert.match(output.Fields.stack, /log-tests\.js/);
    assert.deepEqual(Object.keys(output.Fields).sort(), ['error', 'stack']);
  });

  it('writes readable development messages', function() {
    const log = loadLogger('development')('send.websocket');
    log.error('WebSocket:', new Error('closed'));

    sinon.assert.calledOnce(write);
    assert.match(
      write.firstCall.args[0],
      /^ERROR FirefoxSend\.send\.websocket\.WebSocket:: Error: closed/
    );
  });

  it('logs uncaught exceptions as legacy severity-0 events without exiting', function() {
    const critical = sinon.stub();
    const on = sinon.stub();
    const fakeProcess = { on };
    const error = new Error('unexpected');

    loadLogger('production').installUncaughtExceptionHandler(
      { critical },
      fakeProcess
    );

    sinon.assert.calledOnceWithExactly(
      on,
      'uncaughtException',
      sinon.match.func
    );
    const handler = on.firstCall.args[1];
    handler(error);
    sinon.assert.calledOnceWithExactly(critical, 'uncaughtException', error);
  });
});
