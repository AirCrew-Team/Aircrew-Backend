const express = require('express');

const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const passwordHasher = require('../../../outbound/security/passwordHasher');

const createGetUserById = require('../../../../application/use-cases/getUserById');
const { createCreateUser } = require('../../../../application/use-cases/createUser');
const createManageUsers = require('../../../../application/use-cases/manageUsers');
const createResendInvitation = require('../../../../application/use-cases/resendInvitation');
const createManageProfile = require('../../../../application/use-cases/manageProfile');
const { emailClient } = require('../../../outbound/clients/emailClient');
const crewClient = require('../../../outbound/clients/crewClient');

const {
  verifyJwt,
  verifyCrewServiceKey,
} = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');

const {
  createGetUserByIdController,
  createCreateUserController,
  createResendInvitationController,
  createManageUsersController,
  createProfileController,
} = require('../controllers/user.controller');

const router = express.Router();

const getUserById = createGetUserById(userRepository, { crewClient });
const createUser = createCreateUser({
  userRepository,
  passwordHasher,
  emailClient,
  crewClient,
});

const getByIdController = createGetUserByIdController(getUserById);
const createUserController = createCreateUserController(createUser);
const resendInvitation = createResendInvitation({ userRepository, emailClient });
const resendInvitationController = createResendInvitationController(resendInvitation);

const manageUsers = createManageUsersController(
  createManageUsers(userRepository, { crewClient, resendInvitation })
);
const superAdmin = allowRoles('super_admin');
const profile = createProfileController(createManageProfile(userRepository));
// La foto viaja en base64 dentro del JSON. El body se lee después de comprobar
// la sesión (app.js no lo lee en esta ruta).
const photoBody = express.json({ limit: '3mb' });

// Las rutas /me van antes de /:id: si no, /:id las atraparía (y PATCH exige super_admin).
router.get('/me', verifyJwt, profile.me);
router.patch('/me', verifyJwt, profile.update);
router.get('/me/photo', verifyJwt, profile.photo);
router.put('/me/photo', verifyJwt, photoBody, profile.savePhoto);
router.delete('/me/photo', verifyJwt, profile.deletePhoto);

router.get('/', verifyJwt, superAdmin, manageUsers.list);
// Antes de /:id, que la atraparía.
router.get('/stats', verifyJwt, superAdmin, manageUsers.stats);
router.get('/:id', verifyJwt, getByIdController);
router.post('/', verifyJwt, superAdmin, createUserController);
router.patch('/:id', verifyJwt, superAdmin, manageUsers.update);
router.delete('/:id', verifyJwt, superAdmin, manageUsers.deactivate);
// Cuenta pendiente cuyo correo no llegó o venció: enlace nuevo y otro correo.
router.post('/:id/resend-invitation', verifyJwt, superAdmin, resendInvitationController);
router.post('/lookup', verifyCrewServiceKey, manageUsers.lookup);

module.exports = router;