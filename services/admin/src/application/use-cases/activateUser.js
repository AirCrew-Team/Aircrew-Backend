const crypto = require('node:crypto');

function createActivateUser({ userRepository, passwordHasher }) {
  return async function activateUser(input) {
    const { token, password } = input || {};

    if (
      typeof token !== 'string' ||
      !token ||
      typeof password !== 'string' ||
      password.length < 12 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      const error = new Error(
        'An activation token and a password of 12-72 bytes are required.'
      );
      error.status = 400;
      throw error;
    }

    const activationTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    const user = await userRepository.activateUser({
      activationTokenHash,
      passwordHash: await passwordHasher.hash(password),
    });

    if (!user) {
      const error = new Error('Invalid or expired activation token.');
      error.status = 400;
      throw error;
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
