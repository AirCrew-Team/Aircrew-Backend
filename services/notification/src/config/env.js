const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

function parseList(value, fallback) {
  return (value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  nameService: 'notification',
  port: Number(process.env.PORT) || 3004,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'aircrew-admin',
  // Orígenes del navegador que pueden abrir el WebSocket (a través del gateway).
  corsOrigins: parseList(
    process.env.CORS_ORIGINS,
    'http://localhost:5173,http://localhost:3000'
  ),
};
