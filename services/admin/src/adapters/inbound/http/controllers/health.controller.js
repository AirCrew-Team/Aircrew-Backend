const healthService = require('../../../../application/use-cases/health.service');

function obtenerSalud(req, res, next) {
  try {
    res.json(healthService.consultarSalud());
  } catch (error) {
    next(error);
  }
}

module.exports = { obtenerSalud };
