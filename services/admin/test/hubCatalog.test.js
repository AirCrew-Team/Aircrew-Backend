const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// BE-4 (D7): las bases de Usuarios y la tabla public.bases salen de los hubs de
// Delta de @vuelos/shared. BOG, MDE y CLO (datos de demo de Colombia) ya no existen.
const { HUBS } = require('@vuelos/shared');
const { USER_BASES } = require('../src/domain/userCatalog');

const sql = fs.readFileSync(path.join(__dirname, '../../../database/admin_db.sql'), 'utf8');

test('BE-4: USER_BASES son los 9 hubs, en su orden y con las etiquetas de siempre', () => {
  assert.deepEqual(USER_BASES.map((base) => base.code), HUBS.map((hub) => hub.code));
  const label = (code) => USER_BASES.find((base) => base.code === code).label;
  assert.equal(label('ATL'), 'Base ATL / Atlanta');
  assert.equal(label('LAX'), 'Base LAX / Los Ángeles');
  assert.equal(label('MSP'), 'Base MSP / Minneapolis–St. Paul');
  assert.equal(label('JFK'), 'Base JFK / Nueva York');
  assert.equal(label('LGA'), 'Base LGA / Nueva York LaGuardia');
  assert.ok(Object.isFrozen(USER_BASES));
});

test('BE-4: admin_db.sql siembra public.bases con los mismos datos que los hubs', () => {
  const insert = sql.match(/INSERT INTO public\.bases \(code, icao, name, city, unit, hq_code\) VALUES([\s\S]*?)ON CONFLICT \(code\) DO UPDATE SET([\s\S]*?);/);
  assert.ok(insert, 'falta el INSERT … ON CONFLICT (code) DO UPDATE de public.bases');

  const rows = [...insert[1].matchAll(/\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)'\)/g)]
    .map((match) => match.slice(1));
  assert.deepEqual(
    rows,
    HUBS.map((hub) => [hub.code, hub.icao, hub.airport, hub.city, hub.unit, hub.hqCode])
  );

  // La condición operativa la cambia la operación: volver a ejecutar el script no la pisa.
  assert.doesNotMatch(insert[2], /operational_condition/);
  for (const column of ['icao', 'name', 'city', 'unit', 'hq_code']) {
    assert.match(insert[2], new RegExp(`${column} = EXCLUDED\\.${column}`));
  }
});

test('BE-4: las bases BOG, MDE y CLO pasan a NULL antes de volver a crear el CHECK', () => {
  const addColumn = sql.indexOf('ADD COLUMN IF NOT EXISTS base VARCHAR(3)');
  const update = sql.search(/UPDATE public\.users\s+SET base = NULL\s+WHERE base IN \('BOG', 'MDE', 'CLO'\);/);
  const recreate = sql.indexOf('ADD CONSTRAINT users_base_check');
  assert.ok(update > addColumn, 'el UPDATE va después de crear la columna base');
  assert.ok(update < recreate, 'el UPDATE va antes de volver a crear users_base_check');

  // Y se borran del catálogo de bases (ninguna llave foránea apunta a public.bases).
  assert.match(sql, /DELETE FROM public\.bases WHERE code IN \('BOG', 'MDE', 'CLO'\);/);
  assert.doesNotMatch(sql, /REFERENCES public\.bases/);
});
