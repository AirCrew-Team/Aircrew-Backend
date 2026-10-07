const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nombreServicio: 'admin',
  puerto: Number(process.env.PORT) || 3005,
  databaseUrl: process.env.DATABASE_URL,
  rabbitmqUrl: process.env.RABBITMQ_URL,
  jwtSecret: process.env.JWT_SECRET,
};
