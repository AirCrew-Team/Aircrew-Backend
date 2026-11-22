const { DomainError } = require('../../domain/errors');
const { MESSAGES } = require('../../domain/passwordReset');
const verifyResetToken = require('./verifyResetToken');

// Comprueba el enlace al abrirlo, sin gastar el token ni registrar eventos.
// reset-password vuelve a comprobarlo al enviar, porque puede vencer entre medias.
function createCheckResetToken({ userRepository, now = () => new Date() }) {
  return async function checkResetToken(input) {
    const { token } = input || {};

    if (typeof token !== 'string' || !token.trim()) {
      throw new DomainError(MESSAGES.invalidLink);
    }

    await verifyResetToken({ userRepository, now, token });

    return { valid: true };
  };
}

module.exports = createCheckResetToken;
