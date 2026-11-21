const { emailProvider } = require('../../../config/env');
const { createResendClient } = require('./resendClient');
const { createSmtpClient } = require('./smtpClient');
const { createBrevoClient } = require('./brevoClient');
const { configError } = require('./invitationEmail');

// EMAIL_PROVIDER elige quién envía los correos: resend (por defecto), smtp o brevo.
function selectEmailClient(provider) {
  if (!provider || provider === 'resend') return createResendClient();
  if (provider === 'smtp') return createSmtpClient();
  if (provider === 'brevo') return createBrevoClient();

  function invalidProvider() {
    return configError(
      `EMAIL_PROVIDER="${provider}" no es válido: usa resend, smtp o brevo.`
    );
  }

  return {
    provider,
    async sendCrewInvitation() {
      throw invalidProvider();
    },
    checkPasswordResetConfig() {
      throw invalidProvider();
    },
    async sendPasswordReset() {
      throw invalidProvider();
    },
  };
}

module.exports = { selectEmailClient, emailClient: selectEmailClient(emailProvider) };
