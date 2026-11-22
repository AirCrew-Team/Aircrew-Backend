const { Resend } = require('resend');
const env = require('../../../config/env');
const {
  buildCrewInvitation,
  buildPasswordReset,
  configError,
  getPasswordResetUrl,
  sendFailedError,
} = require('./invitationEmail');

// Envío con Resend. En modo de prueba solo entrega al correo del dueño de la cuenta.
// createResend se inyecta en los tests.
function createResendClient({
  config = env,
  createResend = (apiKey) => new Resend(apiKey),
} = {}) {
  // Falla con 503 si falta la configuración de Resend. No envía nada.
  function checkConfig() {
    if (!config.resendApiKey || !config.resendFromEmail) {
      throw configError('Deben configurarse RESEND_API_KEY y RESEND_FROM_EMAIL.');
    }
  }

  // Resend no lanza cuando rechaza el correo: lo devuelve en result.error.
  async function deliver(email, content) {
    const resend = createResend(config.resendApiKey);
    const result = await resend.emails.send(
      { from: config.resendFromEmail, to: [email], ...content },
      { signal: AbortSignal.timeout(10000) }
    );

    if (result.error) {
      throw result.error;
    }

    return result.data;
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
      throw sendFailedError('Resend', cause);
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
    provider: 'resend',
    sendCrewInvitation,
    checkPasswordResetConfig,
    sendPasswordReset,
  };
}

module.exports = { createResendClient };
