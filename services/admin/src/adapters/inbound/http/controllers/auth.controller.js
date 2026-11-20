const {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  clearedAuthCookieOptions,
} = require('../authCookie');

function createLoginController(login) {
  return async function handleLogin(req, res, next) {
    try {
      const result = await login(req.body);
      // La cookie va antes del body: después ya no se pueden poner cabeceras.
      res.cookie(AUTH_COOKIE_NAME, result.token, authCookieOptions(result.token));
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

// Borra la cookie de sesión. Responde 204 aunque no hubiera cookie.
function createLogoutController() {
  return function handleLogout(req, res) {
    res.clearCookie(AUTH_COOKIE_NAME, clearedAuthCookieOptions());
    return res.status(204).end();
  };
}

function createBootstrapSuperAdminController(bootstrapSuperAdmin) {
  return async function handleBootstrapSuperAdmin(req, res, next) {
    try {
      const result = await bootstrapSuperAdmin(req.body);
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

function createActivateUserController(activateUser) {
  return async function handleActivateUser(req, res, next) {
    try {
      const user = await activateUser(req.body);
      return res.status(200).json({
        message: 'Cuenta activada. Ya puedes iniciar sesión.',
        user,
      });
    } catch (error) {
      return next(error);
    }
  };
}

// Responde el mensaje genérico; el correo sale después, en segundo plano.
function createForgotPasswordController(requestPasswordReset) {
  return async function handleForgotPassword(req, res, next) {
    try {
      const result = await requestPasswordReset(req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

// No crea la cookie de sesión: el frontend inicia sesión después.
function createResetPasswordController(resetPassword) {
  return async function handleResetPassword(req, res, next) {
    try {
      const user = await resetPassword(req.body);
      return res.status(200).json({
        message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
        user,
      });
    } catch (error) {
      return next(error);
    }
  };
}

// Solo dice si el enlace sirve; los fallos llegan al errorHandler con su estado.
function createCheckResetTokenController(checkResetToken) {
  return async function handleCheckResetToken(req, res, next) {
    try {
      const result = await checkResetToken(req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

// Solo dice si el enlace de invitación sirve; no activa la cuenta.
function createCheckActivationTokenController(checkActivationToken) {
  return async function handleCheckActivationToken(req, res, next) {
    try {
      const result = await checkActivationToken(req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

// Cambio de contraseña con sesión. Los tokens anteriores dejan de valer, así que pone
// una cookie de sesión nueva, igual que el login: esta sesión sigue abierta.
// El body solo lleva la fecha, no el token.
function createChangePasswordController(changePassword) {
  return async function handleChangePassword(req, res, next) {
    try {
      const { password_changed_at: passwordChangedAt, token } = await changePassword(
        req.user,
        req.body
      );
      res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions(token));
      return res.status(200).json({ password_changed_at: passwordChangedAt });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  createChangePasswordController,
  createLoginController,
  createLogoutController,
  createBootstrapSuperAdminController,
  createActivateUserController,
  createForgotPasswordController,
  createResetPasswordController,
  createCheckResetTokenController,
  createCheckActivationTokenController,
};