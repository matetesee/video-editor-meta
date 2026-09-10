const { Pool } = require('pg');

// En Railway la conexion a Postgres va por su red privada; el certificado
// no es de una CA publica, asi que hay que aceptar el self-signed.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.RAILWAY_ENVIRONMENT ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // ALTER ... IF NOT EXISTS en vez de meterla en el CREATE TABLE de arriba:
  // asi las cuentas que ya existian antes de esta columna no rompen nada.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data_url TEXT;`);

  // Limite diario de videos: "unlimited" lo desbloquea el cupon; daily_count
  // y daily_reset_date llevan la cuenta de cuantos usó hoy (dia calendario
  // de Argentina, ver ARG_TZ en server.js) para poder resetear a medianoche.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS unlimited BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_count INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_reset_date TEXT NOT NULL DEFAULT '';`);
}

module.exports = { pool, initDb };
