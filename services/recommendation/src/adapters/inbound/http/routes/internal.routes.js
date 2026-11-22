const express = require('express');
const { verifyJwt } = require('../middlewares/auth.middleware');
const { allowRoles } = require('../middlewares/roles.middleware');
const suggestionRepository = require('../../../outbound/persistence/repositories/suggestionRepository');
const { isValidUserId } = require('../../../../domain/entities/replacementRequest');
const { DomainError } = require('../../../../domain/errors');

// Rutas que solo usan otros servicios, con token de servicio. El gateway responde
// 404 a /api/recommendation/internal/* (BE-1).
const router = express.Router();

router.use(verifyJwt, allowRoles('service'));

// Admin, al eliminar una cuenta: borra las sugerencias de la IA que la nombran.
// Repetirlo no falla: devuelve 0.
router.delete('/users/:userId/suggestions', async (req, res, next) => {
  try {
    if (!isValidUserId(req.params.userId)) {
      throw new DomainError('Se requiere un id de usuario válido.');
    }
    const deleted = await suggestionRepository.deleteByCrewUser(req.params.userId);
    return res.status(200).json({ deleted });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
