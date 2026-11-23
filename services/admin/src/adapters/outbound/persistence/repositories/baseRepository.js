const pool = require('../pool');

async function findBaseByCode(code) {
  const { rows } = await pool.query(
    `SELECT code, icao, name, city, unit, hq_code, operational_condition
     FROM public.bases WHERE code = $1`,
    [code]
  );

  return rows[0] || null;
}

module.exports = { findBaseByCode };
