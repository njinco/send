const { hostname } = require('os');
const conf = require('./config');

const app = 'FirefoxSend';
const isProduction = conf.env === 'production';
const levels = {
  trace: 7,
  verbose: 7,
  debug: 7,
  info: 6,
  warn: 4,
  warning: 4,
  error: 2,
  critical: 0,
  fatal: 0
};

function json(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, function(key, current) {
      if (Buffer.isBuffer(this[key])) {
        return this[key].toString('hex');
      }
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) {
          return '[Circular]';
        }
        seen.add(current);
      }
      return current;
    });
  } catch (error) {
    return String(value);
  }
}

function serialize(value) {
  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Error) {
    return String(value);
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('hex');
  }
  return json(value);
}

function fields(payload) {
  if (payload instanceof Error) {
    const output = { error: String(payload) };
    if (payload.stack) {
      output.stack = payload.stack.slice(String(payload).length);
    }
    return output;
  }
  if (payload && typeof payload === 'object') {
    const output = {};
    for (const key of Object.keys(payload)) {
      output[key] = serialize(payload[key]);
    }
    return output;
  }
  return payload ? { msg: String(payload) } : undefined;
}

function pretty(payload) {
  if (payload instanceof Error) {
    return payload.stack || String(payload);
  }
  return String(serialize(payload));
}

function write(namespace, level, operation, payload) {
  if (isProduction) {
    const output = {
      Timestamp: Date.now() * 1000000,
      Logger: app,
      Type: [namespace, operation].filter(Boolean).join('.'),
      Hostname: hostname(),
      Severity: levels[level],
      Pid: process.pid,
      EnvVersion: '2.0'
    };
    const outputFields = fields(payload);
    if (outputFields) {
      output.Fields = outputFields;
    }
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  process.stdout.write(
    `${level.toUpperCase()} ${[app, namespace, operation]
      .filter(Boolean)
      .join('.')}: ${pretty(payload)}\n`
  );
}

function createLogger(name) {
  const namespace = name || '';
  const logger = {};

  for (const level of Object.keys(levels)) {
    logger[level] = function(operation, payload) {
      if (isProduction && levels[level] > levels.info) {
        return;
      }
      write(namespace, level, operation, payload);
    };
  }

  return logger;
}

function installUncaughtExceptionHandler(logger, processRef = process) {
  processRef.on('uncaughtException', error =>
    logger.critical('uncaughtException', error)
  );
}

// mozlog handled uncaught exceptions on its application logger without
// exiting. Preserve that behavior so unexpected errors are emitted as a
// severity-0 Heka record before the process supervisor decides what to do.
const handlerKey = Symbol.for('FirefoxSend.log.uncaughtExceptionHandler');
if (!process[handlerKey]) {
  const logger = createLogger();
  process[handlerKey] = true;
  installUncaughtExceptionHandler(logger);
}

module.exports = createLogger;
module.exports.installUncaughtExceptionHandler = installUncaughtExceptionHandler;
