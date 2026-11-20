const { emailProvider } = require('../../../config/env');
const { createResendClient } = require('./resendClient');
const { createSmtpClient } = require('./smtpClient');
const { configError } = require('./invitationEmail');

// EMAIL_PROVIDER elige quién envía las invitaciones: resend (por defecto) o smtp.
function selectEmailClient(provider) {
  if (!provider || provider === 'resend') return createResendClient();
  if (provider === 'smtp') return createSmtpClient();

  return {
    provider,
    async sendCrewInvitation() {
      throw configError(
        `EMAIL_PROVIDER="${provider}" no es válido: usa resend o smtp.`
      );
    },
  };
}

module.exports = { selectEmailClient, emailClient: selectEmailClient(emailProvider) };
