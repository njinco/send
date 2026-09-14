const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isBoundedInteger(value, minimum, maximum) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function decodeBase64Url(value, allowedLengths) {
  if (typeof value !== 'string' || !BASE64URL.test(value)) {
    return null;
  }
  if (value.length % 4 === 1) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  const canonical = decoded
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (canonical !== value) {
    return null;
  }
  if (allowedLengths && !allowedLengths.includes(decoded.length)) {
    return null;
  }
  return decoded;
}

function decodeBase64(value, allowedLengths) {
  if (
    typeof value !== 'string' ||
    !BASE64.test(value) ||
    value.length % 4 !== 0
  ) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    return null;
  }
  if (allowedLengths && !allowedLengths.includes(decoded.length)) {
    return null;
  }
  return decoded;
}

function parseAuthorization(value, scheme, allowedLengths) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^([^ ]+) ([^ ]+)$/);
  if (!match || match[1] !== scheme) {
    return null;
  }
  return decodeBase64Url(match[2], allowedLengths) ? match[2] : null;
}

module.exports = {
  decodeBase64,
  decodeBase64Url,
  isBoundedInteger,
  parseAuthorization
};
