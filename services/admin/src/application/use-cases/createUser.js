const jwt = require('jsonwebtoken');
const {
  jwtSecret,
  jwtExpiresIn,
  jwtIssuer,
} = require('../../config/env');

function createCreateUser({ userRepository, passwordHasher }) {
  return async function createUser(input) {
    const { name, email, password, role } = input || {};

    if (!name?.trim() || !email?.trim() || !password || !role?.trim()) {
      const error = new Error(
        'Name, email, password, and role are required.'
      );
      error.status = 400;
      throw error;
    }

    if (!jwtSecret) {
      const error = new Error('JWT_SECRET is not configured.');
      error.status = 500;
      throw error;
    }

    const passwordHash = await passwordHasher.hash(password);

    const user = await userRepository.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      role: role.trim(),
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

    return { ...user, token };
  };
}

function createBootstrapSuperAdmin({ userRepository, passwordHasher }) {
  return async function bootstrapSuperAdmin(input) {
    const { name, email, password } = input || {};

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      password.length < 12 ||
      Buffer.byteLength(password, 'utf8') > 72
    ) {
      const error = new Error(
        'Name, email, and a password of 12-72 bytes are required.'
      );
      error.status = 400;
      throw error;
    }

    if (!jwtSecret) {
      const error = new Error('JWT_SECRET is not configured.');
      error.status = 500;
      throw error;
    }

    const user = await userRepository.createFirstSuperAdmin({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: await passwordHasher.hash(password),
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