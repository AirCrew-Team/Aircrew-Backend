const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nombreServicio: 'recommendation',
  puerto: Number(process.env.PORT) || 3003,
};
