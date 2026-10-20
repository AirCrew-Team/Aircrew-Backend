const { Pool } = require('pg');
const { baseDatos } = require('../../../config/env');

const pool = new Pool({
  host: baseDatos.host,
  port: baseDatos.puerto,
  database: baseDatos.nombre,
  user: baseDatos.usuario,
  password: baseDatos.contrasena,
});

module.exports = pool;