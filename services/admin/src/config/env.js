const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nombreServicio: 'admin',
  puerto: Number(process.env.PORT) || 3005,
};
