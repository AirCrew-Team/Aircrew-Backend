const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

function parseList(value, fallback) {
  return (value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  nameService: 'gateway',
  port: Number(process.env.PORT) || 3000,
  // Orígenes del frontend que pueden llamar al backend desde el navegador.
  corsOrigins: parseList(process.env.CORS_ORIGINS, 'http://localhost:5173'),
  services: {
    admin: process.env.ADMIN_SERVICE_URL || 'http://localhost:3005',
    crew: process.env.CREW_SERVICE_URL || 'http://localhost:3002',
    flights: process.env.FLIGHTS_SERVICE_URL || 'http://localhost:3001',
    recommendation:
      process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:3003',
    notification:
      process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  },
};
