const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { aiConfig } = require('./aiConfig');

module.exports = {
  nameService: 'recommendation',
  port: Number(process.env.PORT) || 3003,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'aircrew-admin',
  adminServiceUrl: process.env.ADMIN_SERVICE_URL || 'http://localhost:3005',
  crewServiceUrl: process.env.CREW_SERVICE_URL || 'http://localhost:3002',
  // Cada cuánto se revisan los plazos de «Enterado» vencidos (ms).
  deadlineCheckMs: Number(process.env.DEADLINE_CHECK_MS) || 60000,
  flightsServiceUrl:
    process.env.FLIGHTS_SERVICE_URL || 'http://localhost:3001',
  notificationServiceUrl:
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  DataBase: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'recommendation_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  },
  // IA (Claude): proveedor, si está activa y por qué no (ver aiConfig.js).
  ai: aiConfig(process.env),
};
