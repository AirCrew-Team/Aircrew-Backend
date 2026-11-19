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

    try {
      await emailClient.sendCrewInvitation({
        email: user.email,
        name: user.name,
        token,
      });
    } catch (sendError) {
      // Sin correo nadie recibe el enlace: se borra la cuenta pendiente para que la
      // invitación se pueda repetir con el mismo email (si no, daría 409).
      try {
        await userRepository.deletePendingCrewUser(user.id);
      } catch (deleteError) {
        console.error(
          `No se pudo borrar la cuenta pendiente ${user.id}:`,
          deleteError
        );
      }
      throw sendError;
    }

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
