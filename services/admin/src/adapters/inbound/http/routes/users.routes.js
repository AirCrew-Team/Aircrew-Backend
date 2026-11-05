const express = require('express');

const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const passwordHasher = require('../../../outbound/security/passwordHasher');

const createGetUserById = require('../../../../application/use-cases/getUserById');
const { createCreateUser } = require('../../../../application/use-cases/createUser');
const createInviteCrewUser = require('../../../../application/use-cases/inviteCrewUser');
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

router.get('/:id', verifyJwt, getByIdController);
router.post('/', verifyJwt, allowRoles('super_admin'), createUserController);
router.post('/crew-registration', verifyCrewServiceKey, createCrewUser);

module.exports = router;