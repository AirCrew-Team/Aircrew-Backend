const crypto = require('node:crypto');
const { activationTokenExpiresMinutes } = require('../../config/env');

// Enlace de activación de una cuenta invitada. El token viaja en el correo; en la
// base solo se guarda su hash. Lo usan el alta (POST /users) y el reenvío.
function newActivationLink(now = Date.now()) {
  if (!Number.isInteger(activationTokenExpiresMinutes) || activationTokenExpiresMinutes < 1) {
    const error = new Error('ACTIVATION_TOKEN_EXPIRES_MINUTES debe ser un entero positivo.');
    error.status = 503;
    throw error;
  }

  const token = crypto.randomBytes(32).toString('hex');

  return {
    token,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(now + activationTokenExpiresMinutes * 60 * 1000),
  };
}

module.exports = { newActivationLink };
