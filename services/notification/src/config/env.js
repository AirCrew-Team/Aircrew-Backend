const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nameService: 'notification',
  port: Number(process.env.PORT) || 3004,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'aircrew-admin',
  // Historial de la campana (database/notification_db.sql).
  DataBase: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'notification_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  },
};
