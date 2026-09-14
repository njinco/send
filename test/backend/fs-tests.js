const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const FSStorage = require('../../server/storage/fs');

describe('FSStorage', function() {
  let dir;
  let storage;

  beforeEach(function() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-fs-test-'));
    storage = new FSStorage({ file_dir: dir }, { error() {} });
  });

  afterEach(function() {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes a partial file and propagates a source failure', async function() {
    const err = new Error('source failed');
    const source = new PassThrough();
    const result = storage.set('x', source);
    source.write('partial');
    source.destroy(err);

    await assert.rejects(result, value => value === err);
    assert.equal(fs.existsSync(path.join(dir, 'x')), false);
  });

  it('propagates deletion failures', async function() {
    await assert.rejects(storage.del('missing'), err => err.code === 'ENOENT');
  });
});
