const crypto = require('node:crypto');
const { DomainError } = require('../../domain/errors');

const INVALID_TOKEN_MESSAGE = 'El token de activación no es válido o ya venció.';

// Comprueba el enlace de invitación al abrirlo, sin gastar el token.
// activate vuelve a comprobarlo al enviar, porque puede vencer entre medias.
function createCheckActivationToken({ userRepository }) {
  return async function checkActivationToken(input) {
    const { token } = input || {};

    if (typeof token !== 'string' || !token.trim()) {
      throw new DomainError(INVALID_TOKEN_MESSAGE);
    }

    const activationTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    const user =
      await userRepository.findPendingActivationByToken(activationTokenHash);

    if (!user) {
      throw new DomainError(INVALID_TOKEN_MESSAGE);
    }

    return { valid: true };
  };
}

module.exports = createCheckActivationToken;
