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
}

module.exports = { pool, initDb };
