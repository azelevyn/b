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
