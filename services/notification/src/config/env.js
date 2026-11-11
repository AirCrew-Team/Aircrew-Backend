const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nameService: 'notification',
  port: Number(process.env.PORT) || 3004,
};
