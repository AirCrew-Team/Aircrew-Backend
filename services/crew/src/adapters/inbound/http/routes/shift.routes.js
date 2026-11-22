const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const flightsClient = require('../../../outbound/clients/flightsClient');
const { findUsersByIds } = require('../../../outbound/clients/adminClient');
const { findCrewMembers } = require('../../../outbound/persistence/repositories/crewRepository');
const absenceRepository = require('../../../outbound/persistence/repositories/absenceRepository');
const createAttachUserNames = require('../../../../application/use-cases/attachUserNames');
const createShiftOverview = require('../../../../application/use-cases/shiftOverview');

const shiftOverview = createShiftOverview({
  findCrewMembers,
  absenceRepository,
  attachUserNames: createAttachUserNames(findUsersByIds),
  flightsClient,
});

const respond = (run) => async (req, res, next) => {
  try {
    return res.status(200).json(await run(req));
  } catch (error) {
    return next(error);
  }
};

const supervisors = [verifyJwt, allowRoles('supervisor', 'super_admin')];

// ?base=BOG filtra por base (la del supervisor sale de GET /api/admin/bases/me).
const shiftsRouter = express.Router();
shiftsRouter.get('/current', ...supervisors, respond((req) =>
  shiftOverview.getCurrentShift({ base: req.query.base }, req.headers.authorization)));

const shiftCrewRouter = express.Router();
shiftCrewRouter.get('/', ...supervisors, respond((req) =>
  shiftOverview.getShiftCrew({ base: req.query.base }, req.headers.authorization)));

const myMetrics = respond((req) =>
  shiftOverview.getMyMetrics(req.user, req.headers.authorization, { month: req.query.month }));

module.exports = { shiftsRouter, shiftCrewRouter, myMetrics };
