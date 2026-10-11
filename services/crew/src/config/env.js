const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nombreServicio: 'crew',
  puerto: Number(process.env.PORT) || 3002,
};
