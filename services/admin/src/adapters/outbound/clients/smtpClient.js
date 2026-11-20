const nodemailer = require('nodemailer');
const env = require('../../../config/env');
const {
  buildCrewInvitation,
  configError,
  sendFailedError,
} = require('./invitationEmail');

// Envío por SMTP (p. ej. Gmail con una contraseña de aplicación): llega a cualquier
// destinatario sin verificar un dominio. createTransport se inyecta en los tests.
function createSmtpClient({
  config = env,
  createTransport = nodemailer.createTransport,
} = {}) {
  async function sendCrewInvitation({ email, name, token }) {
    const { host, port, secure, user, pass, from } = config.smtp;

    if (!user || !pass || !from) {
      throw configError(
        'Con EMAIL_PROVIDER=smtp deben configurarse SMTP_USER, SMTP_PASS y SMTP_FROM.'
      );
    }

    const content = buildCrewInvitation({
      name,
      token,
      crewActivationUrl: config.crewActivationUrl,
    });
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

    try {
      return await transporter.sendMail({
        from,
        // Objeto: nodemailer no lo interpreta como una lista de direcciones.
        to: { name: '', address: email },
        ...content,
        // Tope total de 10 s, igual que Resend.
        signal: AbortSignal.timeout(10000),
      });
    } catch (cause) {
      throw sendFailedError('SMTP', cause);
    }
  }

  return { provider: 'smtp', sendCrewInvitation };
}

module.exports = { createSmtpClient };
