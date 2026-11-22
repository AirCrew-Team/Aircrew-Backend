const crypto = require('node:crypto');
const { DomainError } = require('../../domain/errors');
const { MESSAGES } = require('../../domain/activation');

// Comprueba el enlace de invitación al abrirlo, sin gastar el token.
// activate vuelve a comprobarlo al enviar, porque puede vencer entre medias.
function createCheckActivationToken({ userRepository }) {
  return async function checkActivationToken(input) {
    const { token } = input || {};

    if (typeof token !== 'string' || !token.trim()) {
      throw new DomainError(MESSAGES.invalidToken);
    }

    const activationTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    const user =
      await userRepository.findPendingActivationByToken(activationTokenHash);

    if (!user) {
      throw new DomainError(MESSAGES.invalidToken);
    }

    return { valid: true };
  };
}

module.exports = createCheckActivationToken;
