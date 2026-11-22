const express = require('express');

const { US_CITIES } = require('../../../../domain/usCities');
const { verifyJwt } = require('../middlewares/auth.middleware');

const router = express.Router();

// Con sesión y para cualquier rol: ciudades para la residencia de Configuración.
router.get('/us-cities', verifyJwt, (req, res) => res.status(200).json(US_CITIES));

module.exports = router;
