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

// --- Recuperación de contraseña ---

const RESET_URL = 'http://localhost:5173/restablecer-contrasena';
const RESEND_CONFIG = {
  passwordResetUrl: RESET_URL,
  resendApiKey: 'clave-de-prueba',
  resendFromEmail: 'AirCrew <onboarding@resend.dev>',
};
const RESET_EMAIL = {
  email: 'tripulante@aircrew.test',
  name: '<b>Ana & "Co"</b>',
  token: 'token-de-prueba',
};

// Resend falso: guarda lo que se envía.
function createFakeResend() {
  const sent = [];
  return {
    sent,
    createResend: () => ({
      emails: {
        send: async (payload) => {
          sent.push(payload);
          return { data: { id: 'correo-1' }, error: null };
        },
      },
    }),
  };
}

function assertPasswordResetContent(message) {
  assert.equal(message.subject, 'Restablece tu contraseña de AirCrew');
  assert.match(
    message.text,
    /http:\/\/localhost:5173\/restablecer-contrasena\?token=token-de-prueba/
  );
  assert.ok(
    message.text.includes(
      'recibimos una solicitud para restablecer tu contraseña. Abre este enlace para crear una nueva (vence en 10 minutos):'
    )
  );
  assert.ok(
    message.text.includes('Si no la solicitaste, ignora este correo: tu contraseña no cambia.')
  );
  assert.ok(
    message.html.includes(
      '<a href="http://localhost:5173/restablecer-contrasena?token=token-de-prueba">Restablecer contraseña</a>'
    )
  );
  assert.ok(message.html.includes('Hola &lt;b&gt;Ana &amp; &quot;Co&quot;&lt;/b&gt;,'));
  assert.ok(!message.html.includes('<b>Ana'));
  assert.ok(
    message.html.includes('Si no la solicitaste, ignora este correo: tu contraseña no cambia.')
  );
}

test('PR-B9: el cliente SMTP envía el correo de recuperación con el enlace y el nombre escapado', async () => {
  const transport = createFakeTransport();
  const client = createSmtpClient({
    config: { ...SMTP_CONFIG, passwordResetUrl: RESET_URL },
    createTransport: transport.createTransport,
  });

  await client.sendPasswordReset(RESET_EMAIL);

  assert.equal(transport.sent.length, 1);
  const [message] = transport.sent;
  assert.equal(message.from, SMTP_CONFIG.smtp.from);
  assert.deepEqual(message.to, { name: '', address: RESET_EMAIL.email });
  assertPasswordResetContent(message);
});

test('PR-B9: el cliente de Resend envía el correo de recuperación con el enlace y el nombre escapado', async () => {
  const resend = createFakeResend();
  const client = createResendClient({
    config: RESEND_CONFIG,
    createResend: resend.createResend,
  });

  await client.sendPasswordReset(RESET_EMAIL);

  assert.equal(resend.sent.length, 1);
  const [payload] = resend.sent;
  assert.equal(payload.from, RESEND_CONFIG.resendFromEmail);
  assert.deepEqual(payload.to, [RESET_EMAIL.email]);
  assertPasswordResetContent(payload);
});

test('PR-B9: la invitación sigue usando CREW_ACTIVATION_URL y su propio asunto', async () => {
  const transport = createFakeTransport();
  const client = createSmtpClient({
    config: { ...SMTP_CONFIG, passwordResetUrl: RESET_URL },
    createTransport: transport.createTransport,
  });

  await client.sendCrewInvitation(INVITATION);

  assert.equal(transport.sent[0].subject, 'Activa tu cuenta de AirCrew');
  assert.match(transport.sent[0].text, /activar-cuenta\?token=token-de-prueba/);
});

function assertConfigError(client, transportOrResend) {
  assert.throws(
    () => client.checkPasswordResetConfig(),
    (error) => {
      assert.equal(error.status, 503);
      return true;
    }
  );
  assert.equal(transportOrResend.sent.length, 0);
}

test('PR-B5: con la configuración completa, la comprobación no lanza ni envía nada', () => {
  const transport = createFakeTransport();
  const smtp = createSmtpClient({
    config: { ...SMTP_CONFIG, passwordResetUrl: RESET_URL },
    createTransport: transport.createTransport,
  });
  const resend = createFakeResend();
  const resendClient = createResendClient({
    config: RESEND_CONFIG,
    createResend: resend.createResend,
  });

  smtp.checkPasswordResetConfig();
  resendClient.checkPasswordResetConfig();

  assert.equal(transport.options.length, 0);
  assert.equal(transport.sent.length, 0);
  assert.equal(resend.sent.length, 0);
});

for (const [label, passwordResetUrl] of [
  ['sin PASSWORD_RESET_URL', undefined],
  ['con una PASSWORD_RESET_URL que no es una URL', 'restablecer-contrasena'],
  ['con una PASSWORD_RESET_URL que no es http ni https', 'ftp://localhost/restablecer'],
]) {
  test(`PR-B5: ${label}, la comprobación da 503 con los dos proveedores`, () => {
    const transport = createFakeTransport();
    const resend = createFakeResend();

    assertConfigError(
      createSmtpClient({
        config: { ...SMTP_CONFIG, passwordResetUrl },
        createTransport: transport.createTransport,
      }),
      transport
    );
    assertConfigError(
      createResendClient({
        config: { ...RESEND_CONFIG, passwordResetUrl },
        createResend: resend.createResend,
      }),
      resend
    );
  });
}

for (const missing of ['user', 'pass', 'from']) {
  test(`PR-B5: sin SMTP_${missing.toUpperCase()}, la comprobación da 503 sin enviar`, () => {
    const transport = createFakeTransport();
    const client = createSmtpClient({
      config: {
        ...SMTP_CONFIG,
        passwordResetUrl: RESET_URL,
        smtp: { ...SMTP_CONFIG.smtp, [missing]: undefined },
      },
      createTransport: transport.createTransport,
    });

    assertConfigError(client, transport);
  });
}

for (const missing of ['resendApiKey', 'resendFromEmail']) {
  test(`PR-B5: sin ${missing} en Resend, la comprobación da 503 sin enviar`, () => {
    const resend = createFakeResend();
    const client = createResendClient({
      config: { ...RESEND_CONFIG, [missing]: undefined },
      createResend: resend.createResend,
    });

    assertConfigError(client, resend);
  });
}

test('PR-B5: un EMAIL_PROVIDER desconocido da 503 en la comprobación y al enviar', async () => {
  const client = selectEmailClient('otro');

  assert.throws(
    () => client.checkPasswordResetConfig(),
    (error) => {
      assert.equal(error.status, 503);
      return true;
    }
  );
  await assert.rejects(client.sendPasswordReset(RESET_EMAIL), (error) => {
    assert.equal(error.status, 503);
    return true;
  });
});

// --- Brevo (API HTTPS: Railway bloquea el SMTP en los planes Free, Trial y Hobby) ---

const { createBrevoClient } = require('../src/adapters/outbound/clients/brevoClient');

const BREVO_CONFIG = {
  crewActivationUrl: 'http://localhost:5173/activar-cuenta',
  passwordResetUrl: RESET_URL,
  brevo: {
    apiKey: 'clave-de-prueba',
    senderEmail: 'remitente@aircrew.test',
    senderName: 'AirCrew Pruebas',
  },
};

// fetch falso: guarda las peticiones y responde con el estado indicado, o falla.
function createFakeFetch({ status = 201, body = { messageId: 'mensaje-1' }, error } = {}) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (error) throw error;
      return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
          return body;
        },
        async text() {
          return JSON.stringify(body);
        },
      };
    },
  };
}

test('BR-01: EMAIL_PROVIDER=brevo elige el cliente de Brevo', () => {
  assert.equal(selectEmailClient('brevo').provider, 'brevo');
});

test('BR-02: la invitación hace un POST a Brevo con api-key, remitente, destinatario, asunto y enlace', async () => {
  const fake = createFakeFetch();
  const client = createBrevoClient({ config: BREVO_CONFIG, fetchImpl: fake.fetch });

  await client.sendCrewInvitation(INVITATION);

  assert.equal(fake.calls.length, 1);
  const [{ url, options, body }] = fake.calls;
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['api-key'], 'clave-de-prueba');
  assert.equal(options.headers['content-type'], 'application/json');
  assert.equal(options.headers.accept, 'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(body.sender, { name: 'AirCrew Pruebas', email: 'remitente@aircrew.test' });
  assert.deepEqual(body.to, [{ email: INVITATION.email }]);
  assert.equal(body.subject, 'Activa tu cuenta de AirCrew');
  assert.match(body.textContent, /http:\/\/localhost:5173\/activar-cuenta\?token=token-de-prueba/);
  assert.match(body.htmlContent, /activar-cuenta\?token=token-de-prueba/);
});

for (const missing of ['apiKey', 'senderEmail']) {
  test(`BR-03: sin ${missing} en Brevo da 503 y no llama a fetch`, async () => {
    const fake = createFakeFetch();
    const client = createBrevoClient({
      config: { ...BREVO_CONFIG, brevo: { ...BREVO_CONFIG.brevo, [missing]: undefined } },
      fetchImpl: fake.fetch,
    });

    await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
      assert.equal(error.status, 503);
      return true;
    });
    assert.throws(
      () => client.checkPasswordResetConfig(),
      (error) => {
        assert.equal(error.status, 503);
        return true;
      }
    );
    assert.equal(fake.calls.length, 0);
  });
}

test('BR-03: con la configuración completa, la comprobación de la recuperación no lanza ni envía', () => {
  const fake = createFakeFetch();
  const client = createBrevoClient({ config: BREVO_CONFIG, fetchImpl: fake.fetch });

  client.checkPasswordResetConfig();

  assert.equal(fake.calls.length, 0);
});

for (const [label, fakeOptions] of [
  ['Brevo responde 401', { status: 401, body: { code: 'unauthorized', message: 'Key not found detalle interno' } }],
  ['Brevo responde 500', { status: 500, body: { message: 'detalle interno' } }],
  ['fetch falla', { error: new Error('getaddrinfo ENOTFOUND detalle interno') }],
]) {
  test(`BR-04: si ${label}, la invitación da 502 con el mensaje genérico y registra el detalle`, async (t) => {
    const log = t.mock.method(console, 'error', () => {});
    const fake = createFakeFetch(fakeOptions);
    const client = createBrevoClient({ config: BREVO_CONFIG, fetchImpl: fake.fetch });

    await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.message, GENERIC_MESSAGE);
      return true;
    });
    assert.equal(log.mock.callCount(), 1);
    assert.match(String(log.mock.calls[0].arguments.join(' ')), /detalle interno/);
  });
}

test('BR-04: si Brevo rechaza el correo de recuperación, el error sube', async () => {
  const fake = createFakeFetch({ status: 400, body: { message: 'detalle interno' } });
  const client = createBrevoClient({ config: BREVO_CONFIG, fetchImpl: fake.fetch });

  await assert.rejects(client.sendPasswordReset(RESET_EMAIL));
});

test('BR-05: el cliente de Brevo envía el correo de recuperación con el enlace y el nombre escapado', async () => {
  const fake = createFakeFetch();
  const client = createBrevoClient({ config: BREVO_CONFIG, fetchImpl: fake.fetch });

  await client.sendPasswordReset(RESET_EMAIL);

  assert.equal(fake.calls.length, 1);
  const [{ body }] = fake.calls;
  assert.deepEqual(body.to, [{ email: RESET_EMAIL.email }]);
  assertPasswordResetContent({
    subject: body.subject,
    text: body.textContent,
    html: body.htmlContent,
  });
});

test('BR-06: sin BREVO_SENDER_NAME, el remitente se llama AirCrew', async () => {
  const fake = createFakeFetch();
  const client = createBrevoClient({
    config: { ...BREVO_CONFIG, brevo: { ...BREVO_CONFIG.brevo, senderName: undefined } },
    fetchImpl: fake.fetch,
  });

  await client.sendCrewInvitation(INVITATION);

  assert.deepEqual(fake.calls[0].body.sender, {
    name: 'AirCrew',
    email: 'remitente@aircrew.test',
  });
});

test('BR-07: el mensaje de proveedor inválido menciona brevo', async () => {
  const client = selectEmailClient('otro');

  await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
    assert.match(error.message, /resend, smtp o brevo/);
    return true;
  });
});

test('BR-08: una BREVO_API_KEY con saltos de línea da 503 sin llamar a fetch (no acaba en el log)', async () => {
  const fake = createFakeFetch();
  const client = createBrevoClient({
    config: { ...BREVO_CONFIG, brevo: { ...BREVO_CONFIG.brevo, apiKey: 'clave\nde-prueba' } },
    fetchImpl: fake.fetch,
  });

  await assert.rejects(client.sendCrewInvitation(INVITATION), (error) => {
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /clave/);
    return true;
  });
  assert.equal(fake.calls.length, 0);
});

test('BR-09: si Brevo acepta el correo pero su respuesta no se puede leer, la invitación no falla', async () => {
  const client = createBrevoClient({
    config: BREVO_CONFIG,
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      async json() {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    }),
  });

  await client.sendCrewInvitation(INVITATION);
});
