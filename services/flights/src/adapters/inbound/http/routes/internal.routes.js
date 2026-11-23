const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const assignmentRepository = require('../../../outbound/persistence/repositories/assignmentRepository');
const createReleaseCrewUser = require('../../../../application/use-cases/releaseCrewUser');

// Rutas que solo usan otros servicios, con token de servicio. El gateway responde
// 404 a /api/flights/internal/* (BE-1).
const router = express.Router();
const releaseCrewUser = createReleaseCrewUser({ assignmentRepository });

router.use(verifyJwt, allowRoles('service'));

// Admin, al eliminar una cuenta: libera las asignaciones del tripulante.
router.delete('/users/:userId/assignments', async (req, res, next) => {
  try {
    return res.status(200).json(await releaseCrewUser(req.params.userId));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
