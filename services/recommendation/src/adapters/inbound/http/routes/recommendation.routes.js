const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const crewClient = require('../../../outbound/clients/crewClient');
const flightsClient = require('../../../outbound/clients/flightsClient');
const notificationClient = require('../../../outbound/clients/notificationClient');
const adminClient = require('../../../outbound/clients/adminClient');
const ai = require('../../../outbound/ai');
const { serviceAuthorization } = require('../../../outbound/clients/serviceToken');
const suggestionRepository = require('../../../outbound/persistence/repositories/suggestionRepository');
const aiCallRepository = require('../../../outbound/persistence/repositories/aiCallRepository');
const createLoadReplacementContext = require('../../../../application/use-cases/loadReplacementContext');
const createGetCandidates = require('../../../../application/use-cases/getCandidates');
const createSuggestReplacements = require('../../../../application/use-cases/suggestReplacements');
const createConfirmReplacement = require('../../../../application/use-cases/confirmReplacement');
const createRecommendationController = require('../controllers/recommendation.controller');

const router = express.Router();
const loadReplacementContext = createLoadReplacementContext({ crewClient, flightsClient });
const controller = createRecommendationController({
  getCandidates: createGetCandidates({ crewClient, flightsClient, suggestionRepository }),
  suggestReplacements: createSuggestReplacements({
    loadReplacementContext,
    ai,
    suggestionRepository,
    aiCallRepository,
    crewClient,
    notificationClient,
    serviceAuthorization,
  }),
  confirmReplacement: createConfirmReplacement({
    loadReplacementContext,
    crewClient,
    flightsClient,
    adminClient,
    suggestionRepository,
    notificationClient,
  }),
});

const supervisors = allowRoles('supervisor', 'super_admin');

router.get('/:id/candidates', verifyJwt, supervisors, controller.listCandidates);
router.post('/:id/regenerate', verifyJwt, supervisors, controller.regenerate);
router.post('/:id/confirm', verifyJwt, supervisors, controller.confirm);
// Interno: Crew lo llama con un token de servicio al reportarse una ausencia.
router.post('/:id/suggest', verifyJwt, allowRoles('service'), controller.suggest);

module.exports = router;
