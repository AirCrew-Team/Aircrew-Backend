const { Pool } = require('pg');
const { DataBase } = require('../../../config/env');

const pool = new Pool({
  host: DataBase.host,
  port: DataBase.port,
  database: DataBase.name,
  user: DataBase.user,
  password: DataBase.password,
});

module.exports = pool;