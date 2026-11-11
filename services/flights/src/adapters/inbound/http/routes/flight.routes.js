const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const flightRepository = require('../../../outbound/persistence/repositories/flightRepository');
const aircraftRepository = require('../../../outbound/persistence/repositories/aircraftRepository');
const createCreateFlight = require('../../../../application/use-cases/createFlight');
const createGetFlights = require('../../../../application/use-cases/getFlights');
const createGetFlightById = require('../../../../application/use-cases/getFlightById');
const createFlightController = require('../controllers/flight.controller');

const router = express.Router();
const controller = createFlightController({
  createFlight: createCreateFlight({ flightRepository, aircraftRepository }),
  getFlights: createGetFlights(flightRepository),
  getFlightById: createGetFlightById(flightRepository),
});

router.post(
  '/',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.create
);
router.get(
  '/',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.list
);
router.get(
  '/:id',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.getById
);

module.exports = router;
