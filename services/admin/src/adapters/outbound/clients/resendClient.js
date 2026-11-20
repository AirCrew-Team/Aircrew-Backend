const { Resend } = require('resend');
const env = require('../../../config/env');
const {
  buildCrewInvitation,
  configError,
  sendFailedError,
} = require('./invitationEmail');

// Envío con Resend. En modo de prueba solo entrega al correo del dueño de la cuenta.
// createResend se inyecta en los tests.
function createResendClient({
  config = env,
  createResend = (apiKey) => new Resend(apiKey),
} = {}) {
  async function sendCrewInvitation({ email, name, token }) {
    if (!config.resendApiKey || !config.resendFromEmail) {
      throw configError('Deben configurarse RESEND_API_KEY y RESEND_FROM_EMAIL.');
    }

    const content = buildCrewInvitation({
      name,
      token,
      crewActivationUrl: config.crewActivationUrl,
    });
    const resend = createResend(config.resendApiKey);

    let result;

    try {
      result = await resend.emails.send(
        { from: config.resendFromEmail, to: [email], ...content },
        { signal: AbortSignal.timeout(10000) }
      );
    } catch (cause) {
      throw sendFailedError('Resend', cause);
    }

    if (result.error) {
      throw sendFailedError('Resend', result.error);
    }

    return result.data;
  }

  return { provider: 'resend', sendCrewInvitation };
}

module.exports = { createResendClient };
