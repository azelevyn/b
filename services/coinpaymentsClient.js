// services/coinpaymentsClient.js
const CoinPayments = require('coinpayments');
const client = new CoinPayments({
  key: process.env.COINPAYMENTS_PUBLIC_KEY,
  secret: process.env.COINPAYMENTS_PRIVATE_KEY
});

module.exports = client;
