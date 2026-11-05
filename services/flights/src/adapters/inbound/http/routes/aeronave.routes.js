const express = require('express');
const { verificarJwt } = require('../middlewares/auth.middleware');
const { permitirRoles } = require('../middlewares/roles.middleware');
const aircraftRepository = require('../../../outbound/persistence/repositories/aircraftRepository');
const createCreateAircraft = require('../../../../application/use-cases/createAircraft');
const createGetOperatingAircraft = require('../../../../application/use-cases/getOperatingAircraft');
const createGetAircraftStatusSummary = require('../../../../application/use-cases/getAircraftStatusSummary');
const crearControladorAeronaves = require('../controllers/aeronave.controller');

const router = express.Router();
const controlador = crearControladorAeronaves({
  crearAeronave: createCreateAircraft(aircraftRepository),
  obtenerAeronavesOperativas: createGetOperatingAircraft(aircraftRepository),
  obtenerResumenAeronaves:
    createGetAircraftStatusSummary(aircraftRepository),
});

router.post(
  '/',
  verificarJwt,
  permitirRoles('supervisor', 'super_admin'),
  controlador.crear
);
router.get(
  '/activas',
  verificarJwt,
  permitirRoles('supervisor', 'super_admin'),
  controlador.listarActivas
);
router.get(
  '/resumen',
  verificarJwt,
  permitirRoles('supervisor', 'super_admin'),
  controlador.obtenerResumen
);

module.exports = router;
