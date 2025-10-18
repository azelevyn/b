// db.js
const Database = require('better-sqlite3');
const db = new Database('bot.db');

// initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  balance_usdt REAL DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  referral_earned REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount_usdt REAL,
  network TEXT,
  coinpayments_txn_id TEXT,
  status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount_usdt REAL,
  fiat_currency TEXT,
  payment_method TEXT,
  payment_details TEXT,
  status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usd REAL,
  eur REAL,
  gbp REAL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// convenience helpers (exports)
module.exports = {
  db,
  getUserByTelegramId: (tgId) => db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId),
  createUser: (tgId, username, first_name, last_name, referral_code, referred_by) => {
    const stmt = db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, referral_code, referred_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(tgId, username, first_name, last_name, referral_code, referred_by);
  },
  upsertRate: (usd, eur, gbp) => {
    const r = db.prepare('INSERT INTO rates (usd, eur, gbp) VALUES (?, ?, ?)');
    r.run(usd, eur, gbp);
    db.prepare('DELETE FROM rates WHERE id NOT IN (SELECT id FROM rates ORDER BY updated_at DESC LIMIT 1)').run();
  },
  getLatestRate: () => db.prepare('SELECT * FROM rates ORDER BY updated_at DESC LIMIT 1').get(),
  addDeposit: (user_id, amount, network, txnId, status='pending') => db.prepare('INSERT INTO deposits (user_id, amount_usdt, network, coinpayments_txn_id, status) VALUES (?, ?, ?, ?, ?)').run(user_id, amount, network, txnId, status),
  setDepositStatus: (txnId, status) => db.prepare('UPDATE deposits SET status = ? WHERE coinpayments_txn_id = ?').run(status, txnId),
  creditUser: (user_id, amount) => db.prepare('UPDATE users SET balance_usdt = balance_usdt + ? WHERE id = ?').run(amount, user_id),
  recordWithdrawal: (user_id, amount, fiat_currency, method, details) => db.prepare('INSERT INTO withdrawals (user_id, amount_usdt, fiat_currency, payment_method, payment_details, status) VALUES (?, ?, ?, ?, ?, ?)').run(user_id, amount, fiat_currency, method, details, 'pending'),
  getUserByReferralCode: (code) => db.prepare('SELECT * FROM users WHERE referral_code = ?').get(code),
  addReferralReward: (referred_user_id, code, reward) => {
    db.prepare('UPDATE users SET referral_earned = referral_earned + ? WHERE referral_code = ?').run(reward, code);
    // optionally credit to the referrer's balance immediately
    db.prepare('UPDATE users SET balance_usdt = balance_usdt + ? WHERE referral_code = ?').run(reward, code);
  },
  getUserById: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
};
