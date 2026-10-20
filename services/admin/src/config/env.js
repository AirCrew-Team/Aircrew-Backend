const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  nombreServicio: 'admin',
  puerto: Number(process.env.PORT) || 3005,
  baseDatos: {
    host: process.env.DB_HOST || 'localhost',
    puerto: Number(process.env.DB_PORT) || 5432,
    nombre: process.env.DB_NAME || 'admin_db',
    usuario: process.env.DB_USER || 'postgres',
    contrasena: process.env.DB_PASSWORD,
  },
};