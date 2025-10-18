// coinpayments_ipn.js
const crypto = require('crypto');

function verifyIPN(req, privateKey) {
  const hmacHeader = req.get('hmac');
  if (!hmacHeader) return false;
  const rawBody = req.rawBody || req.bodyRaw || ''; // we'll capture raw body in express
  const hmac = crypto.createHmac('sha512', privateKey).update(rawBody).digest('hex');
  return hmac === hmacHeader;
}

module.exports = { verifyIPN };
