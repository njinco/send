#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const expectedMajor = '24';
const expectedEngine = '>=24 <25';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(relativePath, expected) {
  if (!read(relativePath).includes(expected)) {
    throw new Error(`${relativePath} must contain ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(relativePath, unexpected) {
  if (read(relativePath).includes(unexpected)) {
    throw new Error(
      `${relativePath} must not contain ${JSON.stringify(unexpected)}`
    );
  }
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));

if (packageJson.engines.node !== expectedEngine) {
  throw new Error(`package.json must declare Node ${expectedEngine}`);
}
if (packageLock.packages[''].engines.node !== expectedEngine) {
  throw new Error(`package-lock.json must declare Node ${expectedEngine}`);
}
if (read('.nvmrc').trim() !== expectedMajor) {
  throw new Error('.nvmrc must select Node 24');
}

assertIncludes('Dockerfile', 'FROM node:24-alpine AS builder');
assertIncludes('Dockerfile', 'FROM node:24-alpine\n');
assertIncludes('.circleci/config.yml', 'cimg/node:24.0-browsers');
assertIncludes('.circleci/config.yml', 'cimg/node:24.0');
assertNotIncludes('.circleci/config.yml', 'circleci/node:');
assertIncludes('.gitlab-ci.yml', 'node:24-slim');
assertIncludes('.circleci/config.yml', 'npm run check:runtime');
assertIncludes('.gitlab-ci.yml', 'npm run check:runtime');
assertIncludes('README.md', 'Node.js 24 LTS');
assertIncludes('docs/deployment.md', 'Node.js 24 LTS');
assertIncludes('docs/AWS.md', 'Node.js `24.x` LTS');

if (process.versions.node.split('.')[0] !== expectedMajor) {
  throw new Error(
    `Expected Node ${expectedMajor}.x, found ${process.versions.node}`
  );
}

console.log(
  `Node ${process.versions.node} matches the supported runtime configuration.`
);
