const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '../../.env'),
});

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: 'aircrew-admin',
  crewServiceKey: process.env.CREW_SERVICE_KEY,
  // Admin la usa para crear, editar y desactivar perfiles de tripulante.
  adminServiceKey: process.env.ADMIN_SERVICE_KEY,
  nameService: 'crew',
  port: Number(process.env.PORT) || 3002,
  adminServiceUrl:
    process.env.ADMIN_SERVICE_URL || 'http://localhost:3005',
  flightsServiceUrl:
    process.env.FLIGHTS_SERVICE_URL || 'http://localhost:3001',
  notificationServiceUrl:
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  DataBase: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'crew_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  },
};