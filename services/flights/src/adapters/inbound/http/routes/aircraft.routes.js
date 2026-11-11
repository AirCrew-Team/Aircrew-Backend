const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const aircraftRepository = require('../../../outbound/persistence/repositories/aircraftRepository');
const createCreateAircraft = require('../../../../application/use-cases/createAircraft');
const createGetOperatingAircraft = require('../../../../application/use-cases/getOperatingAircraft');
const createGetAircraftStatusSummary = require('../../../../application/use-cases/getAircraftStatusSummary');
const createAircraftController = require('../controllers/aircraft.controller');

const router = express.Router();
const controller = createAircraftController({
  createAircraft: createCreateAircraft(aircraftRepository),
  getOperatingAircraft: createGetOperatingAircraft(aircraftRepository),
  getAircraftStatusSummary:
    createGetAircraftStatusSummary(aircraftRepository),
});

router.post(
  '/',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.create
);
router.get(
  '/operating',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.listOperating
);
router.get(
  '/summary',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.getSummary
);

module.exports = router;
