const express = require('express');

const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const passwordHasher = require('../../../outbound/security/passwordHasher');

const createGetUserById = require('../../../../application/use-cases/getUserById');
const { createCreateUser } = require('../../../../application/use-cases/createUser');
const createInviteCrewUser = require('../../../../application/use-cases/inviteCrewUser');
const createManageUsers = require('../../../../application/use-cases/manageUsers');
const emailClient = require('../../../outbound/clients/resendClient');

const {
  verifyJwt,
  verifyCrewServiceKey,
} = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');

const {
  createGetUserByIdController,
  createCreateUserController,
  createCrewUserController,
  createManageUsersController,
} = require('../controllers/user.controller');

const router = express.Router();

const getUserById = createGetUserById(userRepository);
const createUser = createCreateUser({ userRepository, passwordHasher });
const inviteCrewUser = createInviteCrewUser({
  userRepository,
  passwordHasher,
  emailClient,
});

const getByIdController = createGetUserByIdController(getUserById);
const createUserController = createCreateUserController(createUser);
const createCrewUser = createCrewUserController(inviteCrewUser);

const manageUsers = createManageUsersController(createManageUsers(userRepository));
const superAdmin = allowRoles('super_admin');

router.get('/', verifyJwt, superAdmin, manageUsers.list);
router.get('/:id', verifyJwt, getByIdController);
router.post('/', verifyJwt, superAdmin, createUserController);
router.patch('/:id', verifyJwt, superAdmin, manageUsers.update);
router.delete('/:id', verifyJwt, superAdmin, manageUsers.deactivate);
router.post('/crew-registration', verifyCrewServiceKey, createCrewUser);
router.post('/lookup', verifyCrewServiceKey, manageUsers.lookup);

module.exports = router;