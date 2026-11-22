const express = require('express');
const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const baseRepository = require('../../../outbound/persistence/repositories/baseRepository');
const createMyBase = require('../../../../application/use-cases/myAccount');
const { verifyJwt } = require('../middlewares/auth.middleware');

// Base del usuario con sesión (cualquier rol): encabezado del inicio del supervisor.
// El perfil, la foto y las preferencias están en /users/me (users.routes.js).
const getMyBase = createMyBase({ userRepository, baseRepository });

const basesRouter = express.Router();
basesRouter.get('/me', verifyJwt, async (req, res, next) => {
  try {
    return res.status(200).json(await getMyBase(req.user));
  } catch (error) {
    return next(error);
  }
});

module.exports = { basesRouter };
