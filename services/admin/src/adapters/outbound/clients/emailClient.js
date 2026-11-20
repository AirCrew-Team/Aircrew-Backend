const { emailProvider } = require('../../../config/env');
const { createResendClient } = require('./resendClient');
const { createSmtpClient } = require('./smtpClient');
const { configError } = require('./invitationEmail');

// EMAIL_PROVIDER elige quién envía los correos: resend (por defecto) o smtp.
function selectEmailClient(provider) {
  if (!provider || provider === 'resend') return createResendClient();
  if (provider === 'smtp') return createSmtpClient();

  function invalidProvider() {
    return configError(
      `EMAIL_PROVIDER="${provider}" no es válido: usa resend o smtp.`
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
