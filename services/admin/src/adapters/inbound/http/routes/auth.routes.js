const express = require('express');

const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const passwordHasher = require('../../../outbound/security/passwordHasher');
const { emailClient } = require('../../../outbound/clients/emailClient');

const createLogin = require('../../../../application/use-cases/login');
const createActivateUser = require('../../../../application/use-cases/activateUser');
const createRequestPasswordReset = require('../../../../application/use-cases/requestPasswordReset');
const createResetPassword = require('../../../../application/use-cases/resetPassword');
const createCheckResetToken = require('../../../../application/use-cases/checkResetToken');
const createCheckActivationToken = require('../../../../application/use-cases/checkActivationToken');
const {
  createBootstrapSuperAdmin,
} = require('../../../../application/use-cases/createUser');
const { verifyBootstrapKey } = require('../middlewares/auth.middleware');
const {
  createLoginController,
  createLogoutController,
  createBootstrapSuperAdminController,
  createActivateUserController,
  createForgotPasswordController,
  createResetPasswordController,
  createCheckResetTokenController,
  createCheckActivationTokenController,
} = require('../controllers/auth.controller');

const router = express.Router();

const login = createLogin({ userRepository, passwordHasher });
const loginController = createLoginController(login);
const logoutController = createLogoutController();
const activateUser = createActivateUser({ userRepository, passwordHasher });
const activateUserController = createActivateUserController(activateUser);
const forgotPasswordController = createForgotPasswordController(
  createRequestPasswordReset({ userRepository, emailClient })
);
const resetPasswordController = createResetPasswordController(
  createResetPassword({ userRepository, passwordHasher })
);
const checkResetTokenController = createCheckResetTokenController(
  createCheckResetToken({ userRepository })
);
const checkActivationTokenController = createCheckActivationTokenController(
  createCheckActivationToken({ userRepository })
);
const bootstrapSuperAdmin = createBootstrapSuperAdmin({
  userRepository,
  passwordHasher,
});
const bootstrapSuperAdminController = createBootstrapSuperAdminController(
  bootstrapSuperAdmin
);

const createManageUsers = require('../../../../application/use-cases/manageUsers');
const { createManageUsersController } = require('../controllers/user.controller');
const { verifyJwt } = require('../middlewares/auth.middleware');

const manageUsers = createManageUsersController(createManageUsers(userRepository));

router.get('/me', verifyJwt, manageUsers.me);
router.post('/login', loginController);
// Sin verifyJwt: cerrar sesión con un token vencido también debe borrar la cookie.
router.post('/logout', logoutController);
router.post('/activate', activateUserController);
// Pública, como activate: quien abre la invitación aún no tiene sesión.
router.post('/activate/check', checkActivationTokenController);
// Públicas: quien olvidó la contraseña no tiene sesión.
router.post('/forgot-password', forgotPasswordController);
router.post('/reset-password', resetPasswordController);
// POST y no GET: el token no queda en la URL de los logs.
router.post('/reset-password/check', checkResetTokenController);
router.post(
  '/bootstrap/super-admin',
  verifyBootstrapKey,
  bootstrapSuperAdminController
);

module.exports = router;
