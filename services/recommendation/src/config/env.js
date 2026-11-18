const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nameService: 'recommendation',
  port: Number(process.env.PORT) || 3003,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'aircrew-admin',
  crewServiceUrl: process.env.CREW_SERVICE_URL || 'http://localhost:3002',
  flightsServiceUrl:
    process.env.FLIGHTS_SERVICE_URL || 'http://localhost:3001',
  notificationServiceUrl:
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
};
