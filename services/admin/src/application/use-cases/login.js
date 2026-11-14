const jwt = require('jsonwebtoken');
const {
  jwtSecret,
  jwtExpiresIn,
  jwtIssuer,
} = require('../../config/env');
const { canLogIn } = require('../../domain/entities/user');

function createLogin({ userRepository, passwordHasher }) {
  return async function login(input) {
    const { email, password } = input || {};

    if (
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      !password
    ) {
      const error = new Error('Se requieren email y password.');
      error.status = 400;
      throw error;
    }

    if (!jwtSecret) {
      const error = new Error('JWT_SECRET no está configurado.');
      error.status = 500;
      throw error;
    }

    const user = await userRepository.findByEmail(email.trim());

    if (
      !canLogIn(user) ||
      !(await passwordHasher.compare(password, user.password_hash))
    ) {
      const error = new Error('Email o contraseña incorrectos.');
      error.status = 401;
      throw error;
    }

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

module.exports = createLogin;