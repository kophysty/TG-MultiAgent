const { Pool } = require('pg');

function createPgPoolFromEnv() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || null;
  if (!connectionString) return null;

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 5),
  });

  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('Postgres pool error:', err);
  });

  return pool;
}

module.exports = { createPgPoolFromEnv };


