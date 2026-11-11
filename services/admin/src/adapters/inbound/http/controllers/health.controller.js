const healthService = require('../../../../application/use-cases/health.service');

function getHealth(req, res, next) {
  try {
    res.json(healthService.getHealth());
  } catch (error) {
    next(error);
  }
}

module.exports = { getHealth };
