const crypto = require('node:crypto');
const { canResetPassword } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const {
  LIMIT_WINDOW_MS,
  MAX_CHANGES,
  MESSAGES,
  limitError,
} = require('../../domain/passwordReset');

// Comprobación compartida por check y reset-password: el token existe, no venció,
// la cuenta puede recuperarse y no tiene 3 cambios en 24 h. Solo lee.
async function verifyResetToken({ userRepository, now, token }) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await userRepository.findByPasswordResetToken(tokenHash);

  if (
    !canResetPassword(user) ||
    !(new Date(user.password_reset_expires_at) > now())
  ) {
    throw new DomainError(MESSAGES.invalidLink);
  }

  const changes = await userRepository.countPasswordResetEvents({
    userId: user.id,
    event: 'changed',
    since: new Date(now().getTime() - LIMIT_WINDOW_MS),
  });

  if (changes >= MAX_CHANGES) {
    throw limitError(MESSAGES.changes);
  }

  return { user, tokenHash };
}

module.exports = verifyResetToken;
