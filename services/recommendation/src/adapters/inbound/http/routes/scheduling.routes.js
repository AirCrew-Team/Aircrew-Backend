const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const crewClient = require('../../../outbound/clients/crewClient');
const flightsClient = require('../../../outbound/clients/flightsClient');
const ai = require('../../../outbound/ai');
const { serviceAuthorization } = require('../../../outbound/clients/serviceToken');
const aiCallRepository = require('../../../outbound/persistence/repositories/aiCallRepository');
const createCrewScheduling = require('../../../../application/use-cases/crewScheduling');

// Programación de tripulaciones (pantalla 3.2). Todo devuelve el vuelo armado.
const scheduling = createCrewScheduling({
  flightsClient,
  crewClient,
  ai,
  aiCallRepository,
  serviceAuthorization,
});

const respond = (status, run) => async (req, res, next) => {
  try {
    return res.status(status).json(await run(req, req.headers.authorization));
  } catch (error) {
    return next(error);
  }
};

const supervisors = [verifyJwt, allowRoles('supervisor', 'super_admin')];

const scheduleRouter = express.Router();
scheduleRouter.get('/days', ...supervisors, respond(200, (req, auth) =>
  scheduling.getScheduleDays({ from: req.query.from, days: req.query.days, base: req.query.base }, auth)));
scheduleRouter.get('/', ...supervisors, respond(200, (req, auth) =>
  scheduling.getSchedule({ date: req.query.date, base: req.query.base }, auth)));

const flightRouter = express.Router();
flightRouter.get('/:id/plan', ...supervisors, respond(200, (req, auth) =>
  scheduling.getPlannedFlight(req.params.id, auth)));
flightRouter.get('/:id/slots/:slotId/candidates', ...supervisors, respond(200, (req, auth) =>
  scheduling.getSlotCandidates(req.params.id, req.params.slotId, auth)));
flightRouter.put('/:id/slots/:slotId', ...supervisors, respond(200, (req, auth) =>
  scheduling.assignSlot(req.params.id, req.params.slotId, req.body, auth)));
flightRouter.delete('/:id/slots/:slotId', ...supervisors, respond(200, (req, auth) =>
  scheduling.removeSlot(req.params.id, req.params.slotId, auth)));
flightRouter.post('/:id/confirm', ...supervisors, respond(200, (req, auth) =>
  scheduling.confirmCrew(req.params.id, auth)));
flightRouter.post('/:id/suggest', ...supervisors, respond(200, (req, auth) =>
  scheduling.suggestCrew(req.params.id, auth)));

module.exports = { scheduleRouter, flightRouter };
