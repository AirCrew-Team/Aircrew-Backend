const nodemailer = require('nodemailer');
const env = require('../../../config/env');
const {
  buildCrewInvitation,
  buildPasswordReset,
  configError,
  getPasswordResetUrl,
  sendFailedError,
} = require('./invitationEmail');

// Envío por SMTP (p. ej. Gmail con una contraseña de aplicación): llega a cualquier
// destinatario sin verificar un dominio. createTransport se inyecta en los tests.
function createSmtpClient({
  config = env,
  createTransport = nodemailer.createTransport,
} = {}) {
  // Falla con 503 si falta la configuración de SMTP. No envía nada.
  function checkConfig() {
    const { user, pass, from } = config.smtp;

    if (!user || !pass || !from) {
      throw configError(
        'Con EMAIL_PROVIDER=smtp deben configurarse SMTP_USER, SMTP_PASS y SMTP_FROM.'
      );
    }
  }

  async function deliver(email, content) {
    const { host, port, secure, user, pass, from } = config.smtp;
    // Sin SMTP_SECURE se deduce del puerto: 465 usa TLS directo; 587 usa STARTTLS, y
    // requireTLS impide enviar las credenciales sin cifrar.
    const isSecure = secure ?? port === 465;
    const transporter = createTransport({
      host,
      port,
      secure: isSecure,
      requireTLS: !isSecure,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    return transporter.sendMail({
      from,
      // Objeto: nodemailer no lo interpreta como una lista de direcciones.
      to: { name: '', address: email },
      ...content,
      // Tope total de 10 s, igual que Resend.
      signal: AbortSignal.timeout(10000),
    });
  }

  async function sendCrewInvitation({ email, name, token }) {
    checkConfig();

    const content = buildCrewInvitation({
      name,
      token,
      crewActivationUrl: config.crewActivationUrl,
    });

    try {
      return await deliver(email, content);
    } catch (cause) {
      throw sendFailedError('SMTP', cause);
    }
  }

  // Comprobación previa de la recuperación: proveedor y PASSWORD_RESET_URL.
  function checkPasswordResetConfig() {
    checkConfig();
    getPasswordResetUrl(null, config.passwordResetUrl);
  }

  // Se envía en segundo plano: el fallo lo registra quien lanza el envío.
  async function sendPasswordReset({ email, name, token }) {
    checkConfig();

    const content = buildPasswordReset({
      name,
      token,
      passwordResetUrl: config.passwordResetUrl,
    });

    return deliver(email, content);
  }

  return {
    provider: 'smtp',
    sendCrewInvitation,
    checkPasswordResetConfig,
    sendPasswordReset,
  };
}

module.exports = { createSmtpClient };
