const express = require('express');
const ssePublisher = require('../../../outbound/publishers/ssePublisher');
const { loadDisabledTypes } = require('../../../outbound/clients/adminClient');
const createStreamController = require('../controllers/stream.controller');

// GET /stream: avisos en vivo por SSE. La sesión se lee del header Authorization
// (el gateway lo arma con la cookie) o de la cookie aircrew_token.
const router = express.Router();

router.get('/', createStreamController({ publisher: ssePublisher, loadDisabledTypes }));

module.exports = router;
