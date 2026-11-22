const { validatePasswordReset } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');
const { MESSAGES } = require('../../domain/passwordReset');
const verifyResetToken = require('./verifyResetToken');

// Cambia la contraseña con el token del enlace. No inicia sesión: el frontend hace
// el login después, igual que en la activación.
function createResetPassword({
  userRepository,
  passwordHasher,
  now = () => new Date(),
}) {
  return async function resetPassword(input) {
    const { token, password } = input || {};

    validatePasswordReset({ token, password });

    const { tokenHash } = await verifyResetToken({ userRepository, now, token });

    // El cambio vuelve a exigir el token vigente: si otra petición lo usó antes, da null.
    const updated = await userRepository.resetPasswordByToken({
      tokenHash,
      passwordHash: await passwordHasher.hash(password),
    });

    if (!updated) {
      throw new DomainError(MESSAGES.invalidLink);
    }

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
    };
  };
}

module.exports = createResetPassword;
