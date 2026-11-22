const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { errorHandler } = require('@vuelos/shared');

const ABSENCE_ID = '11111111-1111-4111-8111-111111111111';
const CREW_USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const REPLACEMENT_ID = '7a2b3c4d-5e6f-4a70-8b9c-0d1e2f3a4b5c';
const PDF = Buffer.from('%PDF-1.4\ncontenido');

const ATTACHMENT_META = {
  file_name: 'comprobante.pdf',
  mime_type: 'application/pdf',
  size_bytes: PDF.length,
};

// Fila como la devuelve el repositorio: fechas en texto y solo los metadatos.
const ROW = {
  id: ABSENCE_ID,
  crew_user_id: CREW_USER_ID,
  flight_id: null,
  flight_number: null,
  flight_departure_at: null,
  start_date: '2026-11-20',
  end_date: '2026-11-22',
  reason: 'illness',
  notes: null,
  status: 'reported',
  replacement_user_id: null,
  covered_at: null,
  created_at: '2026-11-20T15:00:00.000Z',
  employee_code: 'EMP-001',
  position: 'cabin_crew',
  attachment: ATTACHMENT_META,
};

function createFakeRepository({ rows = [ROW], attachments = {} } = {}) {
  return {
    async findAbsences() {
      return rows.map((row) => ({ ...row }));
    },
    async findAbsenceById(id) {
      const row = rows.find((item) => item.id === id);
      return row ? { ...row } : null;
    },
    async findAttachment(id) {
      return attachments[id] || null;
    },
    async markAbsenceCovered(id, replacementUserId) {
      const row = rows.find((item) => item.id === id && item.status === 'reported');
      if (!row) return null;
      return {
        ...row,
        status: 'covered',
        replacement_user_id: replacementUserId,
        covered_at: '2026-11-20T16:00:00.000Z',
      };
    },
  };
}

const attachUserNames = (() => {
  const createAttachUserNames = require('../src/application/use-cases/attachUserNames');
  return createAttachUserNames(async (ids) =>
    ids.map((id) => ({ id, name: id === CREW_USER_ID ? 'Ana Pérez' : 'Luis Gómez' }))
  );
})();

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

async function run(handler, req) {
  const res = createFakeRes();
  let failure;
  await handler(req, res, (error) => {
    failure = error;
  });
  if (failure) errorHandler(failure, {}, res, () => {});
  return res;
}

function queryController(repository) {
  const createGetAbsences = require('../src/application/use-cases/getAbsences');
  const createGetAbsenceById = require('../src/application/use-cases/getAbsenceById');
  const createAbsenceController = require('../src/adapters/inbound/http/controllers/absence.controller');
  return createAbsenceController({
    getAbsences: createGetAbsences(repository, attachUserNames),
    getAbsenceById: createGetAbsenceById(repository, attachUserNames),
  });
}

// --- AU-B7 ---

test('AU-B7: GET /absences incluye las fechas, el nombre y los metadatos del adjunto, sin los bytes', async () => {
  const controller = queryController(createFakeRepository());

  const res = await run(controller.list, { query: {} });

  assert.equal(res.statusCode, 200);
  const [absence] = res.body;
  assert.equal(absence.start_date, '2026-11-20');
  assert.equal(absence.end_date, '2026-11-22');
  assert.equal(absence.crew_name, 'Ana Pérez');
  assert.equal(absence.employee_code, 'EMP-001');
  assert.equal(absence.position, 'cabin_crew');
  assert.deepEqual(absence.attachment, ATTACHMENT_META);
  assert.doesNotMatch(JSON.stringify(res.body), /"data"/);
});

test('AU-B7: GET /absences/:id incluye las fechas y attachment null si no hay comprobante', async () => {
  const controller = queryController(
    createFakeRepository({ rows: [{ ...ROW, reason: 'fatigue', attachment: null }] })
  );

  const res = await run(controller.getById, { params: { id: ABSENCE_ID } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.start_date, '2026-11-20');
  assert.equal(res.body.end_date, '2026-11-22');
  assert.equal(res.body.attachment, null);
  assert.equal(res.body.crew_name, 'Ana Pérez');
});

// --- coverAbsence con ausencias por fechas ---

test('coverAbsence sigue funcionando con una ausencia por fechas, sin vuelo', async () => {
  const createCoverAbsence = require('../src/application/use-cases/coverAbsence');
  const coverAbsence = createCoverAbsence(createFakeRepository());

  const covered = await coverAbsence(ABSENCE_ID, { replacement_user_id: REPLACEMENT_ID });

  assert.equal(covered.status, 'covered');
  assert.equal(covered.replacement_user_id, REPLACEMENT_ID);
  assert.equal(covered.start_date, '2026-11-20');
});

// --- AU-B8 ---

// App mínima con la ruta de descarga: así las cabeceras pasan por el
// servidor HTTP real de Node, que rechaza caracteres inválidos.
async function download(attachments, id = ABSENCE_ID) {
  const createGetAbsenceAttachment = require('../src/application/use-cases/getAbsenceAttachment');
  const createAbsenceController = require('../src/adapters/inbound/http/controllers/absence.controller');
  const controller = createAbsenceController({
    getAbsenceAttachment: createGetAbsenceAttachment(createFakeRepository({ attachments })),
  });
  const app = express();
  app.get('/absences/:id/attachment', controller.downloadAttachment);
  app.use(errorHandler);

  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/absences/${id}/attachment`
    );
    const body = Buffer.from(await response.arrayBuffer());
    return { response, body };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('AU-B8: GET /absences/:id/attachment devuelve los bytes con su Content-Type, Content-Disposition, nosniff y sin caché', async () => {
  const { response, body } = await download({
    [ABSENCE_ID]: { file_name: 'comprobante.pdf', mime_type: 'application/pdf', data: PDF },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="comprobante.pdf"'
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  // Documentos médicos: ni el navegador ni un proxy los guardan.
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(body.equals(PDF));
});

test('AU-B8: el nombre del archivo sale saneado: sin rutas, comillas, saltos de línea ni caracteres fuera de ASCII', async () => {
  const { response } = await download({
    [ABSENCE_ID]: {
      file_name: '../carpeta\\informe "médico"\r\n✈.png',
      mime_type: 'image/png',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="informe medico_.png"'
  );
});

test('AU-B8: un nombre que queda vacío al sanearlo se descarga como «comprobante»', async () => {
  const { response } = await download({
    [ABSENCE_ID]: { file_name: '""', mime_type: 'application/pdf', data: PDF },
  });

  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="comprobante"');
});

for (const [label, attachments, id] of [
  ['la ausencia no tiene comprobante', {}, ABSENCE_ID],
  ['el id no es válido', {}, 'no-es-un-id'],
]) {
  test(`AU-B8: responde 404 si ${label}`, async (t) => {
    t.mock.method(console, 'error', () => {});

    const { response, body } = await download(attachments, id);

    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(body.toString()), {
      error: 'La ausencia no existe o no tiene comprobante.',
    });
  });
}
