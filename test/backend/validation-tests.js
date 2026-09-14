const assert = require('assert');
const {
  decodeBase64,
  decodeBase64Url,
  isBoundedInteger,
  parseAuthorization
} = require('../../server/validation');

describe('request validation', function() {
  it('accepts integers at both configured boundaries', function() {
    assert.equal(isBoundedInteger(1, 1, 100), true);
    assert.equal(isBoundedInteger(100, 1, 100), true);
  });

  it('rejects coerced, fractional, and unsafe integers', function() {
    for (const value of [
      '1',
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1
    ]) {
      assert.equal(isBoundedInteger(value, 1, 100), false);
    }
  });

  it('accepts canonical base64url and padded base64 encodings', function() {
    assert.equal(decodeBase64Url('A'.repeat(43), [32]).length, 32);
    assert.equal(decodeBase64('A'.repeat(22) + '==', [16]).length, 16);
  });

  it('rejects noncanonical encodings and ambiguous auth headers', function() {
    assert.equal(decodeBase64Url(`${'A'.repeat(43)}=`, [32]), null);
    assert.equal(decodeBase64('A'.repeat(22), [16]), null);
    assert.equal(
      parseAuthorization(`SEND-V1 ${'A'.repeat(43)}`, 'send-v1'),
      null
    );
    assert.equal(
      parseAuthorization(`send-v1  ${'A'.repeat(43)}`, 'send-v1'),
      null
    );
  });
});
