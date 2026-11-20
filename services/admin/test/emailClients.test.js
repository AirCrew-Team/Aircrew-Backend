const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSmtpClient } = require('../src/adapters/outbound/clients/smtpClient');
const { createResendClient } = require('../src/adapters/outbound/clients/resendClient');
const { selectEmailClient } = require('../src/adapters/outbound/clients/emailClient');

const GENERIC_MESSAGE =
  'No se pudo enviar el correo de invitación. Revisa la configuración del correo.';

const SMTP_CONFIG = {
  crewActivationUrl: 'http://localhost:5173/activar-cuenta',
  smtp: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: 'usuario-de-prueba',
    pass: 'clave-de-prueba',
    from: 'AirCrew <correo-de-prueba@aircrew.test>',
  },
};

const INVITATION = {
  email: 'tripulante@aircrew.test',
  name: 'Tripulante de Prueba',
  token: 'token-de-prueba',
};

// Transporte falso de nodemailer: guarda los correos o falla.
function createFakeTransport(sendError) {
  const sent = [];
  const options = [];
  return {
    sent,
    options,
    createTransport(transportOptions) {
      options.push(transportOptions);
      return {
        async sendMail(message) {
          if (sendError) throw sendError;
          sent.push(message);
          return { messageId: 'mensaje-1' };
        },
      };
    },
  };
}

test('SM-01: EMAIL_PROVIDER=smtp elige el cliente SMTP; sin valor, Resend', () => {
  assert.equal(selectEmailClient('smtp').provider, 'smtp');
  assert.equal(selectEmailClient(undefined).provider, 'resend');
  assert.equal(selectEmailClient('').provider, 'resend');
  assert.equal(selectEmailClient('resend').provider, 'resend');
});

test('SM-01: un EMAIL_PROVIDER desconocido da 503 al invitar', async () => {
  const client = selectEmailClient('otro');

  await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
    assert.equal(error.status, 503);
    return true;
  });
});

test('SM-02b: sin SMTP_SECURE, secure se deduce del puerto y el 587 exige STARTTLS', async () => {
  const transport = createFakeTransport();
  const client = createSmtpClient({
    config: {
      ...SMTP_CONFIG,
      smtp: { ...SMTP_CONFIG.smtp, port: 587, secure: undefined },
    },
    createTransport: transport.createTransport,
  });

  await client.sendCrewInvitation(INVITATION);

  assert.equal(transport.options[0].secure, false);
  assert.equal(transport.options[0].requireTLS, true);
});

test('SM-02: el cliente SMTP envía from, to, asunto y el enlace con el token', async () => {
  const transport = createFakeTransport();
  const client = createSmtpClient({
    config: SMTP_CONFIG,
    createTransport: transport.createTransport,
  });

  await client.sendCrewInvitation(INVITATION);

  assert.equal(transport.sent.length, 1);
  const [message] = transport.sent;
  assert.equal(message.from, SMTP_CONFIG.smtp.from);
  // Objeto y no texto: nodemailer no lo parte en varias direcciones.
  assert.deepEqual(message.to, { name: '', address: INVITATION.email });
  // Tope total de 10 s, igual que Resend.
  assert.ok(message.signal instanceof AbortSignal);
  assert.equal(message.subject, 'Activa tu cuenta de AirCrew');
  assert.match(
    message.text,
    /http:\/\/localhost:5173\/activar-cuenta\?token=token-de-prueba/
  );
  assert.match(message.html, /activar-cuenta\?token=token-de-prueba/);
  assert.equal(transport.options[0].host, 'smtp.gmail.com');
  assert.equal(transport.options[0].port, 465);
  assert.equal(transport.options[0].secure, true);
  assert.deepEqual(transport.options[0].auth, {
    user: SMTP_CONFIG.smtp.user,
    pass: SMTP_CONFIG.smtp.pass,
  });
});

for (const missing of ['user', 'pass', 'from']) {
  test(`SM-03: sin SMTP_${missing.toUpperCase()} da 503 y no envía`, async () => {
    const transport = createFakeTransport();
    const client = createSmtpClient({
      config: {
        ...SMTP_CONFIG,
        smtp: { ...SMTP_CONFIG.smtp, [missing]: undefined },
      },
      createTransport: transport.createTransport,
    });

    await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
      assert.equal(error.status, 503);
      return true;
    });
    assert.equal(transport.sent.length, 0);
  });
}

test('SM-04: si el transporte falla da 502 con el mensaje genérico y registra el detalle', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const transport = createFakeTransport(new Error('Invalid login: 535 detalle interno'));
  const client = createSmtpClient({
    config: SMTP_CONFIG,
    createTransport: transport.createTransport,
  });

  await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.message, GENERIC_MESSAGE);
    return true;
  });
  assert.equal(log.mock.callCount(), 1);
  assert.match(String(log.mock.calls[0].arguments.join(' ')), /detalle interno/);
});

test('SM-05: el 502 de Resend usa el mensaje genérico y registra el detalle', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const client = createResendClient({
    config: {
      crewActivationUrl: SMTP_CONFIG.crewActivationUrl,
      resendApiKey: 'clave-de-prueba',
      resendFromEmail: 'AirCrew <onboarding@resend.dev>',
    },
    createResend: () => ({
      emails: {
        send: async () => ({
          data: null,
          error: { message: 'You can only send testing emails to your own email address (persona@aircrew.test).' },
        }),
      },
    }),
  });

  await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.message, GENERIC_MESSAGE);
    assert.doesNotMatch(error.message, /persona@aircrew\.test/);
    return true;
  });
  assert.equal(log.mock.callCount(), 1);
});
