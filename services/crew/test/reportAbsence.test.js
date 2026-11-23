const { test } = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('@vuelos/shared');

const OVERLAP_MESSAGE =
  'Ya tienes una ausencia reportada que se cruza con esas fechas.';

// 20 nov 2026 a media mañana (UTC): «hoy» para el caso de uso.
const NOW = new Date('2026-11-20T15:00:00Z');

const CREW = { id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', role: 'crew' };
const OTHER_CREW_ID = '7a2b3c4d-5e6f-4a70-8b9c-0d1e2f3a4b5c';
const AUTH = 'Bearer token-de-prueba';

// Firmas mínimas de cada tipo, con unos bytes de relleno.
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenido')]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('contenido'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('contenido')]);

function attachment(bytes, mimeType = 'application/pdf', fileName = 'comprobante.pdf') {
  return { file_name: fileName, mime_type: mimeType, data_base64: bytes.toString('base64') };
}

// Repositorio en memoria. La consulta de cruce y los INSERT solo existen
// dentro de withCrewMemberLock, como en la transacción real.
function createFakeRepository({ absences = [] } = {}) {
  const state = {
    absences: absences.map((absence) => ({ ...absence })),
    attachments: [],
  };
  const calls = [];
  let nextId = 1;
  // Imita el bloqueo por tripulante: las funciones corren en fila.
  let lockQueue = Promise.resolve();

  const tx = {
    async hasOverlappingAbsence({ crewUserId, startDate, endDate }) {
      calls.push('tx.hasOverlappingAbsence');
      const found = state.absences.some(
        (absence) =>
          absence.crew_user_id === crewUserId &&
          absence.start_date !== null &&
          absence.start_date <= endDate &&
          absence.end_date >= startDate
      );
      // Da paso a otras peticiones entre la consulta y el INSERT.
      await new Promise((resolve) => setImmediate(resolve));
      return found;
    },
    async insertAbsence({ crewUserId, startDate, endDate, reason, notes }) {
      calls.push('tx.insertAbsence');
      const row = {
        id: `00000000-0000-4000-8000-00000000000${nextId++}`,
        crew_user_id: crewUserId,
        flight_id: null,
        flight_number: null,
        flight_departure_at: null,
        start_date: startDate,
        end_date: endDate,
        reason,
        notes,
        status: 'reported',
        replacement_user_id: null,
        covered_at: null,
        created_at: NOW.toISOString(),
      };
      state.absences.push(row);
      return { ...row };
    },
    async insertAttachment({ absenceId, fileName, mimeType, sizeBytes, data }) {
      calls.push('tx.insertAttachment');
      state.attachments.push({ absenceId, fileName, mimeType, sizeBytes, data });
      return { file_name: fileName, mime_type: mimeType, size_bytes: sizeBytes };
    },
  };

  return {
    state,
    calls,
    async withCrewMemberLock(crewUserId, fn) {
      calls.push('withCrewMemberLock');
      const run = lockQueue.then(() => fn(tx));
      lockQueue = run.catch(() => {});
      return run;
    },
    async findAbsenceById(id) {
      const absence = state.absences.find((item) => item.id === id);
      return absence ? { ...absence, employee_code: 'EMP-001', position: 'cabin_crew' } : null;
    },
  };
}

function setup(options) {
  const createReportAbsence = require('../src/application/use-cases/reportAbsence');
  const createAbsenceController = require('../src/adapters/inbound/http/controllers/absence.controller');
  const absenceRepository = createFakeRepository(options);
  const alerts = [];
  const notificationClient = {
    async notifyAbsenceReported(absence, authorization) {
      alerts.push({ absence, authorization });
    },
  };
  const reportAbsence = createReportAbsence({
    absenceRepository,
    notificationClient,
    now: () => NOW,
  });
  const controller = createAbsenceController({ reportAbsence });

  return { absenceRepository, alerts, controller };
}

function createFakeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

// POST /absences: controlador y, si falla, el errorHandler real de shared.
async function post(context, body, user = CREW) {
  const res = createFakeRes();
  let failure;

  await context.controller.create(
    { user, headers: { authorization: AUTH }, body },
    res,
    (error) => {
      failure = error;
    }
  );
  if (failure) errorHandler(failure, {}, res, () => {});

  return res;
}

const VALID = { start_date: '2026-11-20', end_date: '2026-11-22', reason: 'fatigue' };

// --- AU-B1 ---

test('AU-B1: una ausencia válida por fechas, sin adjunto y que no es incapacidad, se crea con 201', async () => {
  const context = setup();

  const res = await post(context, { ...VALID, notes: '  Sin descanso suficiente.  ' });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.start_date, '2026-11-20');
  assert.equal(res.body.end_date, '2026-11-22');
  assert.equal(res.body.status, 'reported');
  assert.equal(res.body.reason, 'fatigue');
  assert.equal(res.body.notes, 'Sin descanso suficiente.');
  assert.equal(res.body.crew_user_id, CREW.id);
  assert.equal(res.body.attachment, null);
  assert.equal(context.absenceRepository.state.attachments.length, 0);
});

test('AU-B1: la alerta a los supervisores sale en segundo plano con el detalle de la ausencia', async () => {
  const context = setup();

  const res = await post(context, VALID);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(context.alerts.length, 1);
  assert.equal(context.alerts[0].absence.id, res.body.id);
  assert.equal(context.alerts[0].absence.employee_code, 'EMP-001');
  assert.equal(context.alerts[0].authorization, AUTH);
});

// --- AU-B2 ---

test('AU-B2: con incapacidad y un PDF válido, guarda la ausencia y el adjunto dentro de la misma transacción', async () => {
  const context = setup();

  const res = await post(context, {
    ...VALID,
    reason: 'illness',
    attachment: attachment(PDF),
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(context.absenceRepository.calls, [
    'withCrewMemberLock',
    'tx.hasOverlappingAbsence',
    'tx.insertAbsence',
    'tx.insertAttachment',
  ]);
  const [saved] = context.absenceRepository.state.attachments;
  assert.equal(saved.absenceId, res.body.id);
  assert.equal(saved.fileName, 'comprobante.pdf');
  assert.equal(saved.mimeType, 'application/pdf');
  assert.equal(saved.sizeBytes, PDF.length);
  assert.ok(Buffer.isBuffer(saved.data));
  assert.ok(saved.data.equals(PDF));
});

test('AU-B2: la respuesta trae los metadatos del adjunto, sin los bytes', async () => {
  const context = setup();

  const res = await post(context, {
    ...VALID,
    reason: 'illness',
    attachment: attachment(PDF),
  });

  assert.deepEqual(res.body.attachment, {
    file_name: 'comprobante.pdf',
    mime_type: 'application/pdf',
    size_bytes: PDF.length,
  });
  const json = JSON.stringify(res.body);
  assert.doesNotMatch(json, /data_base64|"data"/);
  assert.ok(!json.includes(PDF.toString('base64')));
});

// --- AU-B3 ---

test('AU-B3: con incapacidad y sin adjunto responde 400 y no guarda nada', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup();

  const res = await post(context, { ...VALID, reason: 'illness' });

  assert.equal(res.statusCode, 400);
  assert.equal(
    res.body.error,
    'El comprobante es obligatorio cuando el motivo es incapacidad.'
  );
  assert.deepEqual(context.absenceRepository.calls, []);
});

// --- AU-B4 ---

const DATE_FORMAT_MESSAGE =
  'Las fechas de inicio y fin deben ser fechas válidas con el formato AAAA-MM-DD.';

for (const [label, dates, message] of [
  ['sin fecha de fin', { start_date: '2026-11-20' }, DATE_FORMAT_MESSAGE],
  ['con un texto que no es fecha', { start_date: 'mañana', end_date: '2026-11-22' }, DATE_FORMAT_MESSAGE],
  ['con una fecha que no existe', { start_date: '2026-11-20', end_date: '2026-02-30' }, DATE_FORMAT_MESSAGE],
  ['con fecha y hora', { start_date: '2026-11-20T00:00:00Z', end_date: '2026-11-22' }, DATE_FORMAT_MESSAGE],
  [
    'con un fin anterior al inicio',
    { start_date: '2026-11-22', end_date: '2026-11-21' },
    'La fecha de fin no puede ser anterior a la de inicio.',
  ],
  [
    'con más de 30 días entre ambas',
    { start_date: '2026-11-20', end_date: '2026-12-21' },
    'No puede haber más de 30 días entre la fecha de inicio y la de fin.',
  ],
  [
    'con un inicio de más de 1 día atrás',
    { start_date: '2026-11-18', end_date: '2026-11-22' },
    'La fecha de inicio no puede ser anterior a hoy.',
  ],
  [
    'con un inicio a más de 365 días de hoy',
    { start_date: '2027-11-21', end_date: '2027-11-21' },
    'La fecha de inicio no puede ser posterior a 365 días desde hoy.',
  ],
]) {
  test(`AU-B4: responde 400 ${label}`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const context = setup();

    const res = await post(context, { reason: 'fatigue', ...dates });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, message);
    assert.deepEqual(context.absenceRepository.calls, []);
  });
}

for (const [label, dates] of [
  ['un inicio de ayer (margen de zona horaria)', { start_date: '2026-11-19', end_date: '2026-11-19' }],
  ['exactamente 30 días entre ambas', { start_date: '2026-11-20', end_date: '2026-12-20' }],
  ['un inicio a exactamente 365 días de hoy', { start_date: '2027-11-20', end_date: '2027-11-20' }],
]) {
  test(`AU-B4: acepta ${label}`, async () => {
    const context = setup();

    const res = await post(context, { reason: 'fatigue', ...dates });

    assert.equal(res.statusCode, 201);
  });
}

// --- AU-B5 ---

for (const [label, file, message] of [
  [
    'de un tipo no permitido',
    attachment(Buffer.from('GIF89a'), 'image/gif', 'foto.gif'),
    'El comprobante debe ser un PDF, PNG o JPG.',
  ],
  [
    'de más de 10 MB ya decodificado',
    attachment(Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)])),
    'El comprobante no puede pesar más de 10 MB.',
  ],
  [
    'PDF cuyos primeros bytes son de un PNG',
    attachment(PNG, 'application/pdf'),
    'El archivo no coincide con el tipo de comprobante indicado.',
  ],
  [
    'PNG cuyos primeros bytes son de un JPEG',
    attachment(JPEG, 'image/png', 'foto.png'),
    'El archivo no coincide con el tipo de comprobante indicado.',
  ],
  [
    'JPEG cuyos primeros bytes son de un PDF',
    attachment(PDF, 'image/jpeg', 'foto.jpg'),
    'El archivo no coincide con el tipo de comprobante indicado.',
  ],
  [
    'sin contenido',
    { file_name: 'comprobante.pdf', mime_type: 'application/pdf', data_base64: '' },
    'El comprobante debe incluir el nombre del archivo, el tipo y el contenido.',
  ],
  [
    'sin nombre de archivo',
    { mime_type: 'application/pdf', data_base64: PDF.toString('base64') },
    'El comprobante debe incluir el nombre del archivo, el tipo y el contenido.',
  ],
  // Propiedades heredadas de Object.prototype: no son tipos permitidos.
  ...['constructor', '__proto__', 'toString', 'hasOwnProperty'].map((mimeType) => [
    `con el tipo «${mimeType}»`,
    attachment(PDF, mimeType),
    'El comprobante debe ser un PDF, PNG o JPG.',
  ]),
]) {
  test(`AU-B5: responde 400 con un adjunto ${label}`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const context = setup();

    const res = await post(context, { ...VALID, reason: 'illness', attachment: file });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, message);
    assert.deepEqual(context.absenceRepository.calls, []);
  });
}

for (const [label, file] of [
  ['un PNG', attachment(PNG, 'image/png', 'foto.png')],
  ['un JPEG', attachment(JPEG, 'image/jpeg', 'foto.jpg')],
]) {
  test(`AU-B5: acepta ${label} con su firma`, async () => {
    const context = setup();

    const res = await post(context, { ...VALID, reason: 'illness', attachment: file });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.attachment.mime_type, file.mime_type);
  });
}

// El nombre guardado lleva la extensión de su tipo. Solo se quita la que
// traiga si es una conocida (.pdf, .png, .jpg, .jpeg): el resto es del nombre.
for (const [label, file, expected] of [
  ['un PDF llamado informe.html', attachment(PDF, 'application/pdf', 'informe.html'), 'informe.html.pdf'],
  ['un PNG sin extensión', attachment(PNG, 'image/png', 'foto'), 'foto.png'],
  ['un JPEG llamado Foto.JPEG', attachment(JPEG, 'image/jpeg', 'Foto.JPEG'), 'Foto.jpg'],
  ['un JPEG llamado foto.JPG', attachment(JPEG, 'image/jpeg', 'foto.JPG'), 'foto.jpg'],
  ['un JPEG llamado foto.png', attachment(JPEG, 'image/jpeg', 'foto.png'), 'foto.jpg'],
  ['un PDF llamado Dr. Pérez.pdf', attachment(PDF, 'application/pdf', 'Dr. Pérez.pdf'), 'Dr. Pérez.pdf'],
  ['un PDF llamado Dr. Pérez', attachment(PDF, 'application/pdf', 'Dr. Pérez'), 'Dr. Pérez.pdf'],
  ['un PDF cuyo nombre es solo la extensión', attachment(PDF, 'application/pdf', ' .PDF '), 'comprobante.pdf'],
]) {
  test(`AU-B5: guarda ${label} como ${expected}`, async () => {
    const context = setup();

    const res = await post(context, { ...VALID, reason: 'illness', attachment: file });

    assert.equal(res.statusCode, 201);
    assert.equal(context.absenceRepository.state.attachments[0].fileName, expected);
    assert.equal(res.body.attachment.file_name, expected);
  });
}

// Un nombre largo no da 400: la base se recorta para que, con la extensión
// del tipo, el total sea de 255 caracteres.
for (const [label, fileName] of [
  ['de 300 caracteres sin extensión', 'a'.repeat(300)],
  ['de 300 caracteres más .pdf', `${'a'.repeat(300)}.pdf`],
]) {
  test(`AU-B5: un nombre ${label} se guarda con 255 caracteres y la extensión del tipo`, async () => {
    const context = setup();

    const res = await post(context, {
      ...VALID,
      reason: 'illness',
      attachment: attachment(PDF, 'application/pdf', fileName),
    });

    assert.equal(res.statusCode, 201);
    const saved = context.absenceRepository.state.attachments[0].fileName;
    assert.equal(saved, `${'a'.repeat(251)}.pdf`);
    assert.equal(saved.length, 255);
  });
}

test('AU-B5: el recorte no parte un carácter de dos unidades (emoji)', async () => {
  const context = setup();
  const fileName = `${'a'.repeat(250)}😀${'b'.repeat(10)}`;

  const res = await post(context, {
    ...VALID,
    reason: 'illness',
    attachment: attachment(PDF, 'application/pdf', fileName),
  });

  assert.equal(res.statusCode, 201);
  const saved = context.absenceRepository.state.attachments[0].fileName;
  assert.equal(saved, `${'a'.repeat(250)}.pdf`);
  assert.ok(saved.isWellFormed());
});

// --- AU-B6 ---

const EXISTING = {
  id: '11111111-1111-4111-8111-111111111111',
  crew_user_id: CREW.id,
  start_date: '2026-11-21',
  end_date: '2026-11-25',
  reason: 'fatigue',
  status: 'reported',
};

test('AU-B6: responde 409 cuando las fechas se cruzan con otra ausencia del mismo tripulante', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup({ absences: [EXISTING] });

  const res = await post(context, VALID);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, OVERLAP_MESSAGE);
  assert.ok(!context.absenceRepository.calls.includes('tx.insertAbsence'));
});

test('AU-B6: no responde 409 cuando la ausencia que se cruza es de otro tripulante', async () => {
  const context = setup({ absences: [{ ...EXISTING, crew_user_id: OTHER_CREW_ID }] });

  const res = await post(context, VALID);

  assert.equal(res.statusCode, 201);
});

test('AU-B6: una ausencia que termina el día antes no se cruza', async () => {
  const context = setup({
    absences: [{ ...EXISTING, start_date: '2026-11-19', end_date: '2026-11-19' }],
  });

  const res = await post(context, VALID);

  assert.equal(res.statusCode, 201);
});

test('AU-B6: dos envíos simultáneos con fechas que se cruzan crean solo una ausencia', async (t) => {
  t.mock.method(console, 'error', () => {});
  const context = setup();

  const [first, second] = await Promise.all([
    post(context, VALID),
    post(context, { ...VALID, start_date: '2026-11-21', end_date: '2026-11-23' }),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]);
  assert.equal(context.absenceRepository.state.absences.length, 1);
});
