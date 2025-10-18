// services/rates.js
const axios = require('axios');
const DB = require('../db');

const RATE_UPDATE_INTERVAL_MS = 60 * 1000; // every 60s (change as needed)

async function fetchRatesSeed(envRates) {
  // Try to fetch USDT -> USD/EUR/GBP from a public API or use env rates if API fails.
  try {
    // Example: CoinGecko API (no key) -> price of tether in USD/EUR/GBP
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd,eur,gbp');
    const data = res.data.tether;
    const usd = data.usd || envRates.usd;
    const eur = data.eur || envRates.eur;
    const gbp = data.gbp || envRates.gbp;
    DB.upsertRate(usd, eur, gbp);
    return { usd, eur, gbp };
  } catch (err) {
    // fallback to env rates
    DB.upsertRate(envRates.usd, envRates.eur, envRates.gbp);
    return envRates;
  }
}

function startAutoUpdater(envRates) {
  // initial seed
  fetchRatesSeed(envRates);
  setInterval(() => fetchRatesSeed(envRates), RATE_UPDATE_INTERVAL_MS);
}

module.exports = { startAutoUpdater };
