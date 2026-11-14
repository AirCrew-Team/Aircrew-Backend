const crypto = require('node:crypto');
const { validateActivation } = require('../../domain/entities/user');
const { DomainError } = require('../../domain/errors');

function createActivateUser({ userRepository, passwordHasher }) {
  return async function activateUser(input) {
    const { token, password } = input || {};

    validateActivation({ token, password });

    const activationTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    const user = await userRepository.activateUser({
      activationTokenHash,
      passwordHash: await passwordHasher.hash(password),
    });

    if (!user) {
      throw new DomainError('El token de activación no es válido o ya venció.');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  };
}

module.exports = createActivateUser;
