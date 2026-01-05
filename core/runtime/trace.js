const crypto = require('crypto');

function makeTraceId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { makeTraceId };



