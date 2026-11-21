const env = require('../../../config/env');
const {
  buildCrewInvitation,
  buildPasswordReset,
  configError,
  getPasswordResetUrl,
  sendFailedError,
} = require('./invitationEmail');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

// Envío con la API HTTPS de Brevo. Sirve donde el SMTP está bloqueado (p. ej. Railway
// en los planes Free, Trial y Hobby). Llega a cualquier destinatario con un remitente
// verificado en Brevo. fetchImpl se inyecta en los tests.
function createBrevoClient({ config = env, fetchImpl = fetch } = {}) {
  // Falla con 503 si falta la configuración de Brevo. No envía nada.
  function checkConfig() {
    const { apiKey, senderEmail } = config.brevo;

    if (!apiKey || !senderEmail) {
      throw configError(
        'Con EMAIL_PROVIDER=brevo deben configurarse BREVO_API_KEY y BREVO_SENDER_EMAIL.'
      );
    }

    // Con un salto de línea, fetch rechaza la cabecera con la clave entera en el mensaje
    // de error, y ese error acabaría en el log.
    if (/[\r\n]/.test(apiKey)) {
      throw configError('BREVO_API_KEY no puede contener saltos de línea.');
    }
  }

  async function deliver(email, { subject, text, html }) {
    const { apiKey, senderEmail, senderName } = config.brevo;
    const response = await fetchImpl(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: senderName || 'AirCrew', email: senderEmail },
        to: [{ email }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
      // Tope total de 10 s, igual que Resend y SMTP.
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Brevo respondió ${response.status}: ${await response.text()}`);
    }

    // El correo ya salió: si la respuesta no se puede leer, no se da por fallido.
    return response.json().catch(() => null);
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
      throw sendFailedError('Brevo', cause);
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
    provider: 'brevo',
    sendCrewInvitation,
    checkPasswordResetConfig,
    sendPasswordReset,
  };
}

module.exports = { createBrevoClient };
