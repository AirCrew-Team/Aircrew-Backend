const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const flightRepository = require('../../../outbound/persistence/repositories/flightRepository');
const aircraftRepository = require('../../../outbound/persistence/repositories/aircraftRepository');
const createCreateFlight = require('../../../../application/use-cases/createFlight');
const createGetFlights = require('../../../../application/use-cases/getFlights');
const createGetFlightById = require('../../../../application/use-cases/getFlightById');
const createFlightController = require('../controllers/flight.controller');
const assignmentRepository = require('../../../outbound/persistence/repositories/assignmentRepository');
const createAssignCrewMember = require('../../../../application/use-cases/assignCrewMember');
const createAssignmentController = require('../controllers/assignment.controller');

const router = express.Router();
const controller = createFlightController({
  createFlight: createCreateFlight({ flightRepository, aircraftRepository }),
  getFlights: createGetFlights(flightRepository),
  getFlightById: createGetFlightById(flightRepository),
});
const assignmentController = createAssignmentController({
  assignCrewMember: createAssignCrewMember({
    flightRepository,
    assignmentRepository,
  }),
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
router.post(
  '/:id/assignments',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  assignmentController.create
);

module.exports = router;
