const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const crewClient = require('../../../outbound/clients/crewClient');
const flightsClient = require('../../../outbound/clients/flightsClient');
const createGetCandidates = require('../../../../application/use-cases/getCandidates');
const createRecommendationController = require('../controllers/recommendation.controller');

const router = express.Router();
const controller = createRecommendationController({
  getCandidates: createGetCandidates({ crewClient, flightsClient }),
});

router.get(
  '/:id/candidates',
  verifyJwt,
  allowRoles('supervisor', 'super_admin'),
  controller.listCandidates
);

module.exports = router;
