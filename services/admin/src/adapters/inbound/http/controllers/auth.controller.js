function createLoginController(login) {
  return async function handleLogin(req, res, next) {
    try {
      const result = await login(req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
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
        message: 'Account activated. You can now log in.',
        user,
      });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  createLoginController,
  createBootstrapSuperAdminController,
  createActivateUserController,
};