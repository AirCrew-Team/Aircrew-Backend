const express = require('express');
const userRepository = require('../../../outbound/persistence/repositories/userRepository');
const baseRepository = require('../../../outbound/persistence/repositories/baseRepository');
const createMyAccount = require('../../../../application/use-cases/myAccount');
const { verifyJwt } = require('../middlewares/auth.middleware');

// Cuenta del usuario con sesión (cualquier rol).
const myAccount = createMyAccount({ userRepository, baseRepository });

const respond = (run) => async (req, res, next) => {
  try {
    return res.status(200).json(await run(req));
  } catch (error) {
    return next(error);
  }
};

const usersMeRouter = express.Router();
usersMeRouter.get('/profile', verifyJwt, respond((req) => myAccount.getProfile(req.user)));
usersMeRouter.patch('/profile', verifyJwt, respond((req) => myAccount.updateProfile(req.user, req.body)));
usersMeRouter.get('/notification-preferences', verifyJwt, respond((req) => myAccount.getPreferences(req.user)));
usersMeRouter.patch(
  '/notification-preferences',
  verifyJwt,
  respond((req) => myAccount.updatePreferences(req.user, req.body))
);

const basesRouter = express.Router();
basesRouter.get('/me', verifyJwt, respond((req) => myAccount.getMyBase(req.user)));

module.exports = { usersMeRouter, basesRouter };
