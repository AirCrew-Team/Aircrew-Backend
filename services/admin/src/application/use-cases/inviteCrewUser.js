const crypto = require('node:crypto');
const { activationTokenExpiresMinutes } = require('../../config/env');
const { createCrewInvitation } = require('../../domain/entities/user');

function createInviteCrewUser({ userRepository, passwordHasher, emailClient }) {
  return async function inviteCrewUser(input) {
    const invitation = createCrewInvitation(input || {});

    if (
      !Number.isInteger(activationTokenExpiresMinutes) ||
      activationTokenExpiresMinutes < 1
    ) {
      const error = new Error(
        'ACTIVATION_TOKEN_EXPIRES_MINUTES debe ser un entero positivo.'
      );
      error.status = 503;
      throw error;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(
      Date.now() + activationTokenExpiresMinutes * 60 * 1000
    );
    const temporaryPassword = crypto.randomBytes(32).toString('hex');
    const user = await userRepository.createPendingCrewUser({
      name: invitation.name,
      email: invitation.email,
      passwordHash: await passwordHasher.hash(temporaryPassword),
      activationTokenHash: tokenHash,
      activationExpiresAt: expiresAt,
    });

    await emailClient.sendCrewInvitation({
      email: user.email,
      name: user.name,
      token,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      created_at: user.created_at,
    };
  };
}

module.exports = createInviteCrewUser;
