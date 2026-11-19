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

module.exports = {
  createLoginController,
  createLogoutController,
  createBootstrapSuperAdminController,
  createActivateUserController,
};