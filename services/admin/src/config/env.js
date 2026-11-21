const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  jwtIssuer: 'aircrew-admin',
  superAdminBootstrapKey: process.env.SUPER_ADMIN_BOOTSTRAP_KEY,
  crewServiceKey: process.env.CREW_SERVICE_KEY,
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL,
  crewActivationUrl: process.env.CREW_ACTIVATION_URL,
  // Pantalla del frontend para restablecer la contraseña; el correo agrega ?token=.
  passwordResetUrl: process.env.PASSWORD_RESET_URL,
  // Quién envía los correos: resend (por defecto), smtp o brevo.
  emailProvider: process.env.EMAIL_PROVIDER?.trim().toLowerCase(),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    // Sin valor queda undefined y el cliente lo deduce del puerto (465 → true).
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE.trim().toLowerCase() === 'true'
      : undefined,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  },
  // Brevo (API HTTPS): para donde el SMTP está bloqueado, como Railway en Hobby.
  brevo: {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL,
    senderName: process.env.BREVO_SENDER_NAME,
  },
  activationTokenExpiresMinutes:
    Number(process.env.ACTIVATION_TOKEN_EXPIRES_MINUTES) || 1440,
  nameService: 'admin',
  port: Number(process.env.PORT) || 3005,
  DataBase: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'admin_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    adminServiceUrl: process.env.ADMIN_SERVICE_URL || 'http://localhost:3005',
  },
};