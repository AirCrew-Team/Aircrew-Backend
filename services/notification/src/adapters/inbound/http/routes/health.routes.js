const express = require('express');
const { obtenerSalud } = require('../controllers/health.controller');

const router = express.Router();
router.get('/health', obtenerSalud);

module.exports = router;
