const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const expectedMajor = '24';
const expectedEngine = '>=24 <25';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Node.js runtime configuration', function() {
  it('uses Node 24 consistently across supported paths', function() {
    const packageJson = JSON.parse(read('package.json'));
    const packageLock = JSON.parse(read('package-lock.json'));

    assert.strictEqual(packageJson.engines.node, expectedEngine);
    assert.strictEqual(packageLock.packages[''].engines.node, expectedEngine);
    assert.strictEqual(read('.nvmrc').trim(), expectedMajor);

    assert.match(read('Dockerfile'), /FROM node:24-alpine AS builder/);
    assert.match(read('Dockerfile'), /FROM node:24-alpine\n/);
    assert.match(read('.circleci/config.yml'), /cimg\/node:24\.0-browsers/);
    assert.match(read('.circleci/config.yml'), /cimg\/node:24\.0/);
    assert.doesNotMatch(read('.circleci/config.yml'), /circleci\/node:/);
    assert.match(read('.gitlab-ci.yml'), /node:24-slim/);
    assert.match(read('.circleci/config.yml'), /npm run check:runtime/);
    assert.match(read('.gitlab-ci.yml'), /npm run check:runtime/);
    assert.match(read('README.md'), /Node\.js 24 LTS/);
    assert.match(read('docs/deployment.md'), /Node\.js 24 LTS/);
    assert.match(read('docs/AWS.md'), /Node\.js `24\.x` LTS/);
  });

  it('does not retain the obsolete configstore override', function() {
    const manifest = JSON.parse(read('package.json'));

    assert.equal(manifest.dependencies.configstore, undefined);
    assert.doesNotMatch(read('Dockerfile'), /configstore/);
  });
});
