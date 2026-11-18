const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const crewClient = require('../../../outbound/clients/crewClient');
const flightsClient = require('../../../outbound/clients/flightsClient');
const createLoadReplacementContext = require('../../../../application/use-cases/loadReplacementContext');
const createGetCandidates = require('../../../../application/use-cases/getCandidates');
const createConfirmReplacement = require('../../../../application/use-cases/confirmReplacement');
const createRecommendationController = require('../controllers/recommendation.controller');

const router = express.Router();
const loadReplacementContext = createLoadReplacementContext({
  crewClient,
  flightsClient,
});
const controller = createRecommendationController({
  getCandidates: createGetCandidates({ loadReplacementContext }),
  confirmReplacement: createConfirmReplacement({
    loadReplacementContext,
    crewClient,
    flightsClient,
  }),
});

const supervisors = allowRoles('supervisor', 'super_admin');

router.get('/:id/candidates', verifyJwt, supervisors, controller.listCandidates);
router.post('/:id/confirm', verifyJwt, supervisors, controller.confirm);

module.exports = router;
