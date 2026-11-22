const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const {
  jwtSecret,
  jwtExpiresIn,
  jwtIssuer,
} = require('../../config/env');
const {
  createUser: buildUser,
  createSuperAdmin,
} = require('../../domain/entities/user');
const { toUserItem } = require('./manageUsers');
const { newActivationLink } = require('./activationLink');

// Alta de cualquier usuario por un super_admin. La cuenta nace pendiente: la
// persona recibe un correo y crea su contraseña al activarla.
// Orden: cuenta pendiente → perfil en Crew (solo tripulantes) → correo.
// Si un paso falla, se deshacen los anteriores y nadie recibe un enlace.
function createCreateUser({ userRepository, passwordHasher, emailClient, crewClient }) {
  async function undo(user, { crewProfileCreated }) {
    if (crewProfileCreated) {
      try {
        await crewClient.deleteProfile(user.id);
      } catch (error) {
        console.error(`No se pudo borrar el perfil de Crew de ${user.id}:`, error);
      }
    }

    // Sin el borrado, repetir el alta con el mismo email daría 409.
    try {
      await userRepository.deletePendingUser(user.id);
    } catch (error) {
      console.error(`No se pudo borrar la cuenta pendiente ${user.id}:`, error);
    }
  }

  return async function createUser(input) {
    const newUser = buildUser(input || {});

    const { token, tokenHash, expiresAt } = newActivationLink();
    // Nadie conoce esta contraseña: la reemplaza la que la persona crea al activar.
    const temporaryPassword = crypto.randomBytes(32).toString('hex');

    const user = await userRepository.createPendingUser({
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      role: newUser.role,
      employment: newUser.employment,
      passwordHash: await passwordHasher.hash(temporaryPassword),
      activationTokenHash: tokenHash,
      activationExpiresAt: expiresAt,
    });

    let crewProfile = null;

    if (newUser.crewProfile) {
      try {
        crewProfile = await crewClient.createProfile({
          user_id: user.id,
          ...newUser.crewProfile,
        });
      } catch (error) {
        await undo(user, { crewProfileCreated: false });
        throw error;
      }
    }

    try {
      await emailClient.sendCrewInvitation({ email: user.email, name: user.name, token });
    } catch (error) {
      await undo(user, { crewProfileCreated: Boolean(crewProfile) });
      throw error;
    }

    return toUserItem(user, crewProfile);
  };
}

function createBootstrapSuperAdmin({ userRepository, passwordHasher }) {
  return async function bootstrapSuperAdmin(input) {
    const superAdmin = createSuperAdmin(input || {});

    if (!jwtSecret) {
      const error = new Error('JWT_SECRET no está configurado.');
      error.status = 500;
      throw error;
    }

    const user = await userRepository.createFirstSuperAdmin({
      name: superAdmin.name,
      email: superAdmin.email,
      passwordHash: await passwordHasher.hash(superAdmin.password),
    });

    const token = jwt.sign(
      { role: user.role },
      jwtSecret,
      {
        subject: user.id,
        expiresIn: jwtExpiresIn,
        issuer: jwtIssuer,
      }
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    };
  };
}

module.exports = { createCreateUser, createBootstrapSuperAdmin };