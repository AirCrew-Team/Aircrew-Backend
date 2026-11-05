const express = require('express');

const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const passwordHasher = require('../../../outbound/security/passwordHasher');

const createLogin = require('../../../../application/use-cases/login');
const createActivateUser = require('../../../../application/use-cases/activateUser');
const {
  createBootstrapSuperAdmin,
} = require('../../../../application/use-cases/createUser');
const { verifyBootstrapKey } = require('../middlewares/auth.middleware');
const {
  createLoginController,
  createBootstrapSuperAdminController,
  createActivateUserController,
} = require('../controllers/auth.controller');

const router = express.Router();

const login = createLogin({ userRepository, passwordHasher });
const loginController = createLoginController(login);
const activateUser = createActivateUser({ userRepository, passwordHasher });
const activateUserController = createActivateUserController(activateUser);
const bootstrapSuperAdmin = createBootstrapSuperAdmin({
  userRepository,
  passwordHasher,
});
const bootstrapSuperAdminController = createBootstrapSuperAdminController(
  bootstrapSuperAdmin
);

router.post('/login', loginController);
router.post('/activate', activateUserController);
router.post(
  '/bootstrap/super-admin',
  verifyBootstrapKey,
  bootstrapSuperAdminController
);

module.exports = router;
