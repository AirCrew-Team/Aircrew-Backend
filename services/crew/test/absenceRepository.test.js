const { test } = require('node:test');
const assert = require('node:assert/strict');

// Repositorio real con el pool de pg sustituido: no abre conexiones.
const pool = require('../src/adapters/outbound/persistence/pool');
const absenceRepository = require('../src/adapters/outbound/persistence/repositories/absenceRepository');

const CREW_USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const ABSENCE_ID = '11111111-1111-4111-8111-111111111111';

// Cliente falso: guarda cada consulta y responde según el SQL.
function createFakeClient() {
  const client = {
    queries: [],
    released: 0,
    async query(sql, params) {
      client.queries.push({ sql: sql.trim(), params });
      if (/SELECT EXISTS/i.test(sql)) return { rows: [{ exists: false }] };
      if (/INSERT INTO public\.absences\b/i.test(sql)) return { rows: [{ id: ABSENCE_ID }] };
      if (/INSERT INTO public\.absence_attachments/i.test(sql)) {
        return { rows: [{ file_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 3 }] };
      }
      return { rows: [] };
    },
    release() {
      client.released += 1;
    },
  };
  return client;
}

test('AU-B2: withCrewMemberLock abre una transacción, bloquea al tripulante y confirma al terminar', async (t) => {
  const client = createFakeClient();
  t.mock.method(pool, 'connect', async () => client);

  const result = await absenceRepository.withCrewMemberLock(CREW_USER_ID, async (tx) => {
    const overlapping = await tx.hasOverlappingAbsence({
      crewUserId: CREW_USER_ID,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
    });
    const absence = await tx.insertAbsence({
      crewUserId: CREW_USER_ID,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      reason: 'illness',
      notes: null,
    });
    const attachment = await tx.insertAttachment({
      absenceId: absence.id,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      data: Buffer.from('abc'),
    });
    return { overlapping, absence, attachment };
  });

  assert.equal(result.overlapping, false);
  assert.equal(result.absence.id, ABSENCE_ID);
  const sql = client.queries.map((query) => query.sql);
  assert.equal(sql[0], 'BEGIN');
  assert.match(sql[1], /pg_advisory_xact_lock/);
  assert.deepEqual(client.queries[1].params, [CREW_USER_ID]);
  assert.match(sql[2], /start_date <= \$3/);
  assert.match(sql[2], /end_date >= \$2/);
  assert.deepEqual(client.queries[2].params, [CREW_USER_ID, '2026-11-20', '2026-11-22']);
  assert.match(sql[3], /INSERT INTO public\.absences/);
  assert.match(sql[4], /INSERT INTO public\.absence_attachments/);
  assert.equal(sql[5], 'COMMIT');
  assert.equal(client.released, 1);
});

test('AU-B2: si algo falla dentro de la transacción, hace ROLLBACK, libera la conexión y relanza el error', async (t) => {
  const client = createFakeClient();
  t.mock.method(pool, 'connect', async () => client);

  await assert.rejects(
    absenceRepository.withCrewMemberLock(CREW_USER_ID, async () => {
      throw new Error('fallo de prueba');
    }),
    /fallo de prueba/
  );

  const sql = client.queries.map((query) => query.sql);
  assert.deepEqual(sql.slice(-1), ['ROLLBACK']);
  assert.ok(!sql.includes('COMMIT'));
  assert.equal(client.released, 1);
});

test('AU-B2: si el ROLLBACK también falla, relanza el error original y descarta la conexión', async (t) => {
  const client = createFakeClient();
  const rollbackError = new Error('fallo del ROLLBACK');
  const originalError = new Error('fallo de prueba');
  const releasedWith = [];
  const answer = client.query;
  client.query = async (sql, params) => {
    if (sql === 'ROLLBACK') throw rollbackError;
    return answer(sql, params);
  };
  client.release = (error) => {
    releasedWith.push(error);
  };
  t.mock.method(pool, 'connect', async () => client);

  await assert.rejects(
    absenceRepository.withCrewMemberLock(CREW_USER_ID, async () => {
      throw originalError;
    }),
    (error) => error === originalError
  );

  assert.deepEqual(releasedWith, [rollbackError]);
});

test('AU-B2: insertAbsence devuelve las fechas como texto AAAA-MM-DD', async (t) => {
  const client = createFakeClient();
  t.mock.method(pool, 'connect', async () => client);

  await absenceRepository.withCrewMemberLock(CREW_USER_ID, (tx) =>
    tx.insertAbsence({
      crewUserId: CREW_USER_ID,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      reason: 'fatigue',
      notes: null,
    })
  );

  const insert = client.queries.find((query) => /INSERT INTO public\.absences/.test(query.sql));
  assert.match(insert.sql, /to_char\(start_date, 'YYYY-MM-DD'\) AS start_date/);
  assert.match(insert.sql, /to_char\(end_date, 'YYYY-MM-DD'\) AS end_date/);
});

for (const [name, call] of [
  ['findAbsences', () => absenceRepository.findAbsences()],
  ['findAbsenceById', () => absenceRepository.findAbsenceById(ABSENCE_ID)],
]) {
  test(`AU-B7: ${name} trae las fechas en texto y los metadatos del adjunto con LEFT JOIN, nunca la columna data`, async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (sql) => {
      queries.push(sql);
      return { rows: [] };
    });

    await call();

    const [sql] = queries;
    assert.match(sql, /LEFT JOIN public\.absence_attachments/);
    assert.match(sql, /to_char\(a\.start_date, 'YYYY-MM-DD'\) AS start_date/);
    assert.match(sql, /to_char\(a\.end_date, 'YYYY-MM-DD'\) AS end_date/);
    assert.match(sql, /'size_bytes'/);
    assert.doesNotMatch(sql, /\bdata\b/);
  });
}

test('markAbsenceCovered devuelve las fechas como texto, para la alerta de «cubierta»', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql) => {
    queries.push(sql);
    return { rows: [] };
  });

  await absenceRepository.markAbsenceCovered(ABSENCE_ID, CREW_USER_ID);

  assert.match(queries[0], /to_char\(start_date, 'YYYY-MM-DD'\) AS start_date/);
});

test('AU-B8: findAttachment pide los bytes solo de esa ausencia', async (t) => {
  const queries = [];
  const data = Buffer.from('%PDF-');
  t.mock.method(pool, 'query', async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ file_name: 'a.pdf', mime_type: 'application/pdf', data }] };
  });

  const attachment = await absenceRepository.findAttachment(ABSENCE_ID);

  assert.match(queries[0].sql, /FROM public\.absence_attachments/);
  assert.deepEqual(queries[0].params, [ABSENCE_ID]);
  assert.equal(attachment.data, data);
});
