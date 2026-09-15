/* eslint-disable no-undef */
const fs = require('fs');
const path = require('path');

const FORCED_FAILURE = 'SEND_FRONTEND_TEST_FORCE_SETUP_FAILURE';

function loadDependencies() {
  return {
    puppeteer: require('puppeteer'),
    webpack: require('webpack'),
    webpackConfig: require('../../webpack.config'),
    middleware: require('webpack-dev-middleware'),
    express: require('express'),
    devRoutes: require('../../server/bin/test')
  };
}

function monitorCompilation(compiler, timeoutMs) {
  let finish;
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let restoreFatalHandler = () => {};
    const timer = setTimeout(() => {
      finish(new Error(`Frontend compilation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    finish = error => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      restoreFatalHandler();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    compiler.hooks.done.tap('frontend-test-runner', stats => {
      finish(
        stats.hasErrors()
          ? new Error(stats.toString({ all: false, errors: true }))
          : null
      );
    });
    if (compiler.hooks.failed) {
      compiler.hooks.failed.tap('frontend-test-runner', finish);
    } else {
      const originalWatch = compiler.watch;
      const monitoredWatch = function(watchOptions, callback) {
        return originalWatch.call(this, watchOptions, (error, stats) => {
          if (error) {
            finish(error);
          }
          callback(error, stats);
        });
      };
      compiler.watch = monitoredWatch;
      restoreFatalHandler = () => {
        if (compiler.watch === monitoredWatch) {
          compiler.watch = originalWatch;
        }
      };
    }
  });

  return {
    promise,
    cancel: () => finish()
  };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function close(resource) {
  if (!resource) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const result = resource.close(error => (error ? reject(error) : resolve()));
    if (result && typeof result.then === 'function') {
      result.then(resolve, reject);
    }
  });
}

async function runFrontendTests(options = {}) {
  let browser;
  let server;
  let webpackMiddleware;
  let compilation;
  let primaryError;

  try {
    if (process.env[FORCED_FAILURE] === '1') {
      throw new Error('Intentional frontend test setup failure');
    }

    const dependencies = options.dependencies || loadDependencies();
    const app = dependencies.express();
    const compiler = dependencies.webpack(
      dependencies.webpackConfig(null, { mode: 'development' })
    );
    const compilationTimeout =
      Number.isFinite(options.compilationTimeout) &&
      options.compilationTimeout > 0
        ? options.compilationTimeout
        : 60000;
    compilation = monitorCompilation(compiler, compilationTimeout);
    const compilationResult = compilation.promise.then(
      () => null,
      error => error
    );
    webpackMiddleware = dependencies.middleware(compiler, {
      logLevel: 'silent'
    });
    app.use(webpackMiddleware);
    dependencies.devRoutes(app, { middleware: webpackMiddleware });
    server = await listen(app);
    const compilationError = await compilationResult;
    if (compilationError) {
      throw compilationError;
    }

    browser = await dependencies.puppeteer.launch({
      args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('console', options.onConsole || (() => {}));
    page.on('pageerror', error => pageErrors.push(error));
    await page.setDefaultNavigationTimeout(60000);
    const response = await page.goto(
      `http://127.0.0.1:${server.address().port}/test`
    );
    if (!response || !response.ok()) {
      throw new Error(
        `Frontend test page returned ${
          response ? response.status() : 'no response'
        }`
      );
    }
    await page.waitFor(() => typeof runner.testResults !== 'undefined', {
      polling: 1000,
      timeout: 60000
    });
    if (pageErrors.length) {
      throw pageErrors[0];
    }

    const results = await page.evaluate(() => runner.testResults);
    const coverage = await page.evaluate(() => __coverage__);
    if (coverage) {
      const dir = path.resolve(__dirname, '../../.nyc_output');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.resolve(dir, 'frontend.json'),
        JSON.stringify(coverage)
      );
    }

    const stats = results.stats;
    console.log(`${stats.passes} passing (${stats.duration}ms)\n`);
    if (stats.failures) {
      console.log('Failures:\n');
      for (const failure of results.failures) {
        console.log(`${failure.fullTitle}`);
        console.log(` ${failure.err.stack}\n`);
      }
      throw new Error(`${stats.failures} frontend test(s) failed`);
    }
  } catch (error) {
    primaryError = error;
  }

  if (compilation) {
    compilation.cancel();
  }
  for (const resource of [browser, server, webpackMiddleware]) {
    try {
      await close(resource);
    } catch (error) {
      primaryError = primaryError || error;
    }
  }

  if (primaryError) {
    throw primaryError;
  }
}

if (require.main === module) {
  runFrontendTests().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { FORCED_FAILURE, runFrontendTests };
