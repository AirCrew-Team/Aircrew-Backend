const express = require('express');

const { US_CITIES } = require('../../../../domain/usCities');
const { userFormOptions } = require('../../../../domain/userCatalog');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');

const router = express.Router();

// Con sesión y para cualquier rol: ciudades para la residencia de Configuración.
router.get('/us-cities', verifyJwt, (req, res) => res.status(200).json(US_CITIES));

// Solo super_admin: opciones del formulario de la pantalla Usuarios (bases, cargos de
// tripulante, turnos y estados).
router.get('/user-options', verifyJwt, allowRoles('super_admin'), (req, res) =>
  res.status(200).json(userFormOptions())
);

module.exports = router;
