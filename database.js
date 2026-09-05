const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packs (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      slots_total INTEGER NOT NULL DEFAULT 5,
      slots_used INTEGER NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 100,
      payment_status TEXT DEFAULT 'pending',
      fedapay_id TEXT,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS listings (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      zone TEXT NOT NULL,
      phone TEXT NOT NULL,
      description TEXT DEFAULT '',
      images TEXT DEFAULT '[]',
      boost_tier TEXT DEFAULT 'none',
      boost_until TIMESTAMP,
      featured INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS boosts (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      fedapay_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      listing_id INTEGER NOT NULL,
      buyer_phone TEXT NOT NULL,
      amount INTEGER NOT NULL,
      commission INTEGER NOT NULL,
      seller_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      fedapay_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { pool, init };
