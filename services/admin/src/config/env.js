const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  jwtIssuer: 'aircrew-admin',
  superAdminBootstrapKey: process.env.SUPER_ADMIN_BOOTSTRAP_KEY,
  crewServiceKey: process.env.CREW_SERVICE_KEY,
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL,
  crewActivationUrl: process.env.CREW_ACTIVATION_URL,
  activationTokenExpiresMinutes:
    Number(process.env.ACTIVATION_TOKEN_EXPIRES_MINUTES) || 1440,
  nameService: 'admin',
  port: Number(process.env.PORT) || 3005,
  DataBase: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'admin_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    adminServiceUrl: process.env.ADMIN_SERVICE_URL || 'http://localhost:3005',
  },
};