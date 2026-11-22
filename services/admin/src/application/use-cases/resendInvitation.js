const { isValidUserId } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const { newActivationLink } = require('./activationLink');

// Reenvía el correo de activación de una cuenta pendiente (si el primero no llegó o
// venció). Genera un enlace nuevo: el anterior deja de servir. Si el envío falla, la
// cuenta sigue pendiente y se puede volver a intentar.
function createResendInvitation({ userRepository, emailClient }) {
  return async function resendInvitation(id) {
    const user = isValidUserId(id) ? await userRepository.findById(id) : null;

    if (!user) {
      throw new DomainError('Usuario no encontrado.', 404);
    }

    if (!user.pending_activation) {
      throw new DomainError(
        'La cuenta ya está activa: no tiene una invitación pendiente.',
        409
      );
    }

    const { token, tokenHash, expiresAt } = newActivationLink();
    const renewed = await userRepository.renewActivation(user.id, {
      activationTokenHash: tokenHash,
      activationExpiresAt: expiresAt,
    });

    // Otra petición la activó entre la lectura y el cambio.
    if (!renewed) {
      throw new DomainError(
        'La cuenta ya está activa: no tiene una invitación pendiente.',
        409
      );
    }

    await emailClient.sendCrewInvitation({ email: renewed.email, name: renewed.name, token });

    return { email: renewed.email, expires_at: expiresAt.toISOString() };
  };
}

module.exports = createResendInvitation;
