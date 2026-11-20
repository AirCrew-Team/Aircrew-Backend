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

function createCreateUser({ userRepository, passwordHasher }) {
  return async function createUser(input) {
    const newUser = buildUser(input || {});

    // No se devuelve token: cada usuario obtiene el suyo al iniciar sesión.
    return userRepository.create({
      name: newUser.name,
      email: newUser.email,
      passwordHash: await passwordHasher.hash(newUser.password),
      role: newUser.role,
      employment: newUser.employment,
    });
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