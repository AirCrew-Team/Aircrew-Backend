const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const assignmentRepository = require('../../../outbound/persistence/repositories/assignmentRepository');
const createGetAssignments = require('../../../../application/use-cases/getAssignments');
const createGetMyAssignments = require('../../../../application/use-cases/getMyAssignments');
const createGetMyNextAssignment = require('../../../../application/use-cases/getMyNextAssignment');
const createAssignmentController = require('../controllers/assignment.controller');

const router = express.Router();
const controller = createAssignmentController({
  getAssignments: createGetAssignments(assignmentRepository),
  getMyAssignments: createGetMyAssignments(assignmentRepository),
  getMyNextAssignment: createGetMyNextAssignment(assignmentRepository),
});

router.get(
  '/',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.list
);
router.get('/me', verifyJwt, allowRoles('crew'), controller.listMine);
router.get('/me/next', verifyJwt, allowRoles('crew'), controller.getMyNext);

module.exports = router;
