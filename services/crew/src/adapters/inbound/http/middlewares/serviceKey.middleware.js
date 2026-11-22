const crypto = require('node:crypto');
const { adminServiceKey } = require('../../../../config/env');

// Rutas internas que solo llama Admin: exige el header x-service-key con
// ADMIN_SERVICE_KEY (la misma en admin/.env y crew/.env).
function verifyAdminServiceKey(req, res, next) {
  if (!adminServiceKey) {
    const error = new Error('ADMIN_SERVICE_KEY no está configurado.');
    error.status = 503;
    return next(error);
  }

  const providedKey = req.get('x-service-key');

  if (typeof providedKey !== 'string') {
    return res.status(401).json({ error: 'Se requiere autenticación del servicio.' });
  }

  const expected = Buffer.from(adminServiceKey);
  const provided = Buffer.from(providedKey);

  if (
    expected.length !== provided.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return res.status(401).json({ error: 'Las credenciales del servicio no son válidas.' });
  }

  return next();
}

module.exports = { verifyAdminServiceKey };
