const express = require('express');
const { verifyAdminServiceKey } = require('../middlewares/serviceKey.middleware');
const crewRepository = require('../../../outbound/persistence/repositories/crewRepository');
const createManageCrewProfiles = require('../../../../application/use-cases/manageCrewProfiles');

// Rutas que solo usa Admin para administrar los perfiles de tripulante.
// No son para el navegador: piden x-service-key, no una sesión.
const router = express.Router();
const profiles = createManageCrewProfiles(crewRepository);

function respond(status, run) {
  return async function handle(req, res, next) {
    try {
      const result = await run(req);
      return status === 204 ? res.status(204).end() : res.status(status).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

router.use(verifyAdminServiceKey);
router.get('/', respond(200, () => profiles.listProfiles()));
router.post('/', respond(201, (req) => profiles.createProfile(req.body)));
router.get('/:userId', respond(200, (req) => profiles.getProfile(req.params.userId)));
router.patch('/:userId', respond(200, (req) => profiles.updateProfile(req.params.userId, req.body)));
router.delete('/:userId', respond(204, (req) => profiles.deleteProfile(req.params.userId)));

// /internal/users: Admin eliminó la cuenta y se borra todo lo del tripulante.
const usersRouter = express.Router();
usersRouter.use(verifyAdminServiceKey);
usersRouter.delete('/:userId', respond(200, (req) => profiles.eraseUser(req.params.userId)));

module.exports = { crewMembersRouter: router, usersRouter };
