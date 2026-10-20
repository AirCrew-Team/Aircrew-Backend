const bcrypt = require('bcryptjs');

async function hash(password) {
  return bcrypt.hash(password, 10);
}

module.exports = { hash };