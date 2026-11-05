const jwt = require('jsonwebtoken');
const {
  jwtSecret,
  jwtExpiresIn,
  jwtIssuer,
} = require('../../config/env');

const allowedRoles = new Set(['crew', 'supervisor', 'super_admin']);

function createLogin({ userRepository, passwordHasher }) {
  return async function login(input) {
    const { email, password } = input || {};

    if (
      typeof email !== 'string' ||
      !email.trim() ||
      typeof password !== 'string' ||
      !password
    ) {
      const error = new Error('Email and password are required.');
      error.status = 400;
      throw error;
    }

    if (!jwtSecret) {
      const error = new Error('JWT_SECRET is not configured.');
      error.status = 500;
      throw error;
    }

    const user = await userRepository.findByEmail(email.trim());

    if (
      !user ||
      !user.is_active ||
      !allowedRoles.has(user.role) ||
      !(await passwordHasher.compare(password, user.password_hash))
    ) {
      const error = new Error('Invalid email or password.');
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