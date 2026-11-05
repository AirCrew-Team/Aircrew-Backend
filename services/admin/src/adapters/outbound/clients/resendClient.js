const { Resend } = require('resend');
const {
  resendApiKey,
  resendFromEmail,
  crewActivationUrl,
} = require('../../../config/env');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

function getActivationUrl(token) {
  if (!resendApiKey || !resendFromEmail || !crewActivationUrl) {
    const error = new Error(
      'RESEND_API_KEY, RESEND_FROM_EMAIL, and CREW_ACTIVATION_URL must be configured.'
    );
    error.status = 503;
    throw error;
  }

  let activationUrl;

  try {
    activationUrl = new URL(crewActivationUrl);
  } catch {
    const error = new Error('CREW_ACTIVATION_URL must be a valid URL.');
    error.status = 503;
    throw error;
  }

  if (!['http:', 'https:'].includes(activationUrl.protocol)) {
    const error = new Error(
      'CREW_ACTIVATION_URL must use HTTP or HTTPS.'
    );
    error.status = 503;
    throw error;
  }

  if (token) {
    activationUrl.searchParams.set('token', token);
  }

  return activationUrl;
}

async function sendCrewInvitation({ email, name, token }) {
  const activationUrl = getActivationUrl(token);
  const safeName = escapeHtml(name);
  const url = escapeHtml(activationUrl.toString());
  const resend = new Resend(resendApiKey);

  let result;

  try {
    result = await resend.emails.send(
      {
        from: resendFromEmail,
        to: [email],
        subject: 'Activa tu cuenta de AirCrew',
        html: `<p>Hola ${safeName},</p><p>Para activar tu cuenta y crear tu contraseña, abre este enlace:</p><p><a href="${url}">Activar cuenta</a></p><p>Si no solicitaste esta cuenta, puedes ignorar este correo.</p>`,
        text: `Hola ${name},\n\nPara activar tu cuenta y crear tu contraseña, abre este enlace:\n${activationUrl.toString()}\n\nSi no solicitaste esta cuenta, puedes ignorar este correo.`,
      },
      { signal: AbortSignal.timeout(10000) }
    );
  } catch (cause) {
    const error = new Error('Could not connect to Resend.', { cause });
    error.status = 502;
    throw error;
  }

  if (result.error) {
    const error = new Error(
      `Resend could not send the crew invitation: ${result.error.message}`
    );
    error.status = 502;
    throw error;
  }

  return result.data;
}

module.exports = { getActivationUrl, sendCrewInvitation };
