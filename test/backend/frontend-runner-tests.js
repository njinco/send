const assert = require('assert');
const EventEmitter = require('events');
const path = require('path');
const { spawnSync } = require('child_process');
const sinon = require('sinon');
const { FORCED_FAILURE, runFrontendTests } = require('../frontend/runner');

function fakeDependencies(compile) {
  const app = {
    use: sinon.stub(),
    listen: sinon.stub()
  };
  const server = new EventEmitter();
  server.address = sinon.stub().returns({ port: 1234 });
  server.close = sinon.stub().callsFake(callback => callback());
  app.listen.callsFake(() => {
    setImmediate(() => server.emit('listening'));
    return server;
  });

  let done;
  let failed;
  const compiler = {
    hooks: {
      done: { tap: (_name, callback) => (done = callback) },
      failed: { tap: (_name, callback) => (failed = callback) }
    }
  };
  const webpackMiddleware = function() {};
  webpackMiddleware.close = sinon.stub().callsFake(callback => callback());
  const middleware = sinon.stub().callsFake(() => {
    if (compiler.watch) {
      compiler.watch({}, () => {});
    }
    compile({ done, failed });
    return webpackMiddleware;
  });
  const puppeteer = { launch: sinon.stub() };

  return {
    values: {
      express: sinon.stub().returns(app),
      webpack: sinon.stub().returns(compiler),
      webpackConfig: sinon.stub().returns({}),
      middleware,
      devRoutes: sinon.stub(),
      puppeteer
    },
    server,
    webpackMiddleware,
    compiler,
    puppeteer
  };
}

describe('frontend test runner', function() {
  it('returns a nonzero status for a setup failure', function() {
    const runner = path.resolve(__dirname, '../frontend/runner.js');
    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      env: { ...process.env, [FORCED_FAILURE]: '1' }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Intentional frontend test setup failure/);
  });

  it('rejects a fatal compiler failure and closes setup resources', async function() {
    const fatal = new Error('fatal compiler failure');
    const dependencies = fakeDependencies(({ done, failed }) => {
      setImmediate(() => {
        failed(fatal);
        done({ hasErrors: () => false });
      });
    });

    await assert.rejects(
      runFrontendTests({ dependencies: dependencies.values }),
      /fatal compiler failure/
    );
    sinon.assert.calledOnce(dependencies.server.close);
    sinon.assert.calledOnce(dependencies.webpackMiddleware.close);
    sinon.assert.notCalled(dependencies.puppeteer.launch);
  });

  it('rejects fatal watch errors from Webpack 4', async function() {
    const fatal = new Error('fatal Webpack 4 watch failure');
    const dependencies = fakeDependencies(() => {});
    delete dependencies.compiler.hooks.failed;
    dependencies.compiler.watch = sinon
      .stub()
      .callsFake((_options, callback) => {
        setImmediate(() => callback(fatal));
      });

    await assert.rejects(
      runFrontendTests({ dependencies: dependencies.values }),
      /fatal Webpack 4 watch failure/
    );
    sinon.assert.calledOnce(dependencies.server.close);
    sinon.assert.calledOnce(dependencies.webpackMiddleware.close);
    sinon.assert.notCalled(dependencies.puppeteer.launch);
  });

  it('times out a stalled compilation and closes setup resources', async function() {
    const dependencies = fakeDependencies(() => {});

    await assert.rejects(
      runFrontendTests({
        dependencies: dependencies.values,
        compilationTimeout: 10
      }),
      /Frontend compilation timed out after 10ms/
    );
    sinon.assert.calledOnce(dependencies.server.close);
    sinon.assert.calledOnce(dependencies.webpackMiddleware.close);
    sinon.assert.notCalled(dependencies.puppeteer.launch);
  });
});
