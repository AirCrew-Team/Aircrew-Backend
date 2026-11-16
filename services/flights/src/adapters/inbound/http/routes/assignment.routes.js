const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const assignmentRepository = require('../../../outbound/persistence/repositories/assignmentRepository');
const createGetMyAssignments = require('../../../../application/use-cases/getMyAssignments');
const createGetMyNextAssignment = require('../../../../application/use-cases/getMyNextAssignment');
const createAssignmentController = require('../controllers/assignment.controller');

const router = express.Router();
const controller = createAssignmentController({
  getMyAssignments: createGetMyAssignments(assignmentRepository),
  getMyNextAssignment: createGetMyNextAssignment(assignmentRepository),
});

router.get('/me', verifyJwt, allowRoles('crew'), controller.listMine);
router.get('/me/next', verifyJwt, allowRoles('crew'), controller.getMyNext);

module.exports = router;
