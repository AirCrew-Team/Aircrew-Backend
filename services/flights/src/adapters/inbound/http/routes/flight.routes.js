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
const createReplaceCrewMember = require('../../../../application/use-cases/replaceCrewMember');
const createRevertReplacement = require('../../../../application/use-cases/revertReplacement');
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
  replaceCrewMember: createReplaceCrewMember({
    flightRepository,
    assignmentRepository,
  }),
  revertReplacement: createRevertReplacement(assignmentRepository),
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
  allowRoles('supervisor', 'super_admin', 'service'),
  controller.getById
);
router.post(
  '/:id/assignments',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  assignmentController.create
);
router.post(
  '/:id/assignments/replace',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  assignmentController.replace
);
// Interno: Recommendation deshace un reemplazo cuyo plazo venció.
router.post(
  '/:id/assignments/revert',
  verifyJwt,
  allowRoles('service'),
  assignmentController.revert
);

module.exports = router;
