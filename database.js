const Database = require("better-sqlite3");

const db = new Database("bonplan229.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  zone TEXT NOT NULL,
  phone TEXT NOT NULL,
  description TEXT DEFAULT '',
  image TEXT,
  featured INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  buyer_phone TEXT NOT NULL,
  amount INTEGER NOT NULL,
  commission INTEGER NOT NULL,
  seller_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  fedapay_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;
