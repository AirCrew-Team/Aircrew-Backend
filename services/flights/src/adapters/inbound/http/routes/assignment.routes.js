const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const assignmentRepository = require('../../../outbound/persistence/repositories/assignmentRepository');
const createGetAssignments = require('../../../../application/use-cases/getAssignments');
const createGetMyAssignments = require('../../../../application/use-cases/getMyAssignments');
const createGetMyNextAssignment = require('../../../../application/use-cases/getMyNextAssignment');
const createAcknowledgeReplacement = require('../../../../application/use-cases/acknowledgeReplacement');
const crewClient = require('../../../outbound/clients/crewClient');
const createAssignmentController = require('../controllers/assignment.controller');

const router = express.Router();
const controller = createAssignmentController({
  getAssignments: createGetAssignments(assignmentRepository),
  getMyAssignments: createGetMyAssignments(assignmentRepository),
  getMyNextAssignment: createGetMyNextAssignment(assignmentRepository),
  acknowledgeReplacement: createAcknowledgeReplacement({ assignmentRepository, crewClient }),
});

router.get(
  '/',
  verifyJwt,
  allowRoles('supervisor', 'super_admin', 'service'),
  controller.list
);
router.get('/me', verifyJwt, allowRoles('crew'), controller.listMine);
router.get('/me/next', verifyJwt, allowRoles('crew'), controller.getMyNext);
// El reemplazo confirma que cubrirá el vuelo (botón «Enterado»).
router.post('/:id/acknowledge', verifyJwt, allowRoles('crew'), controller.acknowledge);

module.exports = router;
