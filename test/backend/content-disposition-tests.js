const assert = require('assert');

describe('content-disposition', function () {
  let create;

  before(async function () {
    ({ create } = await import('content-disposition'));
  });

  it('creates a simple attachment header for ASCII filenames', function () {
    assert.equal(create('plain.txt'), 'attachment; filename=plain.txt');
  });

  it('provides an RFC 5987 fallback for Unicode filenames', function () {
    assert.equal(
      create('報告書.txt'),
      'attachment; filename="???.txt"; filename*=UTF-8\'\'%E5%A0%B1%E5%91%8A%E6%9B%B8.txt',
    );
  });

  it('encodes spaces and non-ASCII characters in the extended filename', function () {
    assert.equal(
      create('résumé 2026.txt'),
      'attachment; filename="r?sum? 2026.txt"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%202026.txt',
    );
  });
});
