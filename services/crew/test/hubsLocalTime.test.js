const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// BE-4 (D7, D8): fuente única de los hubs de Delta y fecha/hora local por zona.
// shared no tiene runner propio: se prueba desde crew.
const {
  HUBS,
  DEFAULT_TIMEZONE,
  findHub,
  hubTimezone,
  localDate,
  localHour,
  localDayRange,
} = require('@vuelos/shared');

describe('Hubs de Delta (shared)', () => {
  it('son los 9 hubs, en el orden del catálogo, todos en EE. UU.', () => {
    assert.deepEqual(
      HUBS.map((hub) => hub.code),
      ['ATL', 'BOS', 'DTW', 'LAX', 'MSP', 'JFK', 'LGA', 'SLC', 'SEA']
    );
    assert.ok(HUBS.every((hub) => hub.country === 'US'));
    assert.ok(Object.isFrozen(HUBS));
  });

  it('cada hub trae ICAO, ciudad, aeropuerto, zona, unidad y código de jefatura', () => {
    assert.deepEqual(findHub('LGA'), {
      code: 'LGA',
      icao: 'KLGA',
      city: 'Nueva York',
      airport: 'LaGuardia',
      country: 'US',
      timezone: 'America/New_York',
      unit: 'Operaciones de Vuelo Nueva York LaGuardia',
      hqCode: 'LGA-HQ',
    });
    assert.equal(findHub('MSP').timezone, 'America/Chicago');
    assert.equal(findHub('DTW').timezone, 'America/Detroit');
    assert.equal(findHub('SLC').timezone, 'America/Denver');
    assert.equal(findHub('LAX').city, 'Los Ángeles');
  });

  it('la zona de una base sale del hub; sin base o desconocida, Nueva York', () => {
    assert.equal(DEFAULT_TIMEZONE, 'America/New_York');
    assert.equal(hubTimezone('LAX'), 'America/Los_Angeles');
    assert.equal(hubTimezone('sea'), 'America/Los_Angeles');
    assert.equal(hubTimezone('BOG'), 'America/New_York');
    assert.equal(hubTimezone(null), 'America/New_York');
    assert.equal(hubTimezone(undefined), 'America/New_York');
  });
});

describe('Fecha y hora local por zona (shared)', () => {
  // 2026-07-15 06:30Z: 02:30 en Nueva York (EDT, −4) y 23:30 del 14 en Los Ángeles (PDT, −7).
  const SUMMER = '2026-07-15T06:30:00Z';

  it('el mismo instante cae en días distintos en JFK y LAX', () => {
    assert.equal(localDate(SUMMER, 'America/New_York'), '2026-07-15');
    assert.equal(localDate(SUMMER, 'America/Los_Angeles'), '2026-07-14');
  });

  it('la hora local es de 0 a 23 y respeta el horario de verano', () => {
    assert.equal(localHour(SUMMER, 'America/New_York'), 2);
    assert.equal(localHour(SUMMER, 'America/Los_Angeles'), 23);
    assert.equal(localHour('2026-07-15T04:00:00Z', 'America/New_York'), 0); // medianoche, no 24
    // En invierno Nueva York es −5: 05:00Z es medianoche.
    assert.equal(localHour('2026-01-15T05:00:00Z', 'America/New_York'), 0);
  });

  it('acepta Date, número o texto ISO', () => {
    const instant = Date.parse(SUMMER);
    assert.equal(localDate(instant, 'America/Los_Angeles'), '2026-07-14');
    assert.equal(localDate(new Date(instant), 'America/Los_Angeles'), '2026-07-14');
  });

  it('el rango UTC de un día local va de medianoche a medianoche de esa zona', () => {
    assert.deepEqual(localDayRange('2026-07-15', 'America/Los_Angeles'), {
      from: '2026-07-15T07:00:00.000Z',
      to: '2026-07-16T07:00:00.000Z',
    });
    assert.deepEqual(localDayRange('2026-01-15', 'America/New_York'), {
      from: '2026-01-15T05:00:00.000Z',
      to: '2026-01-16T05:00:00.000Z',
    });
  });

  it('el día del cambio de horario dura 23 h en marzo y 25 h en noviembre', () => {
    assert.deepEqual(localDayRange('2026-03-08', 'America/New_York'), {
      from: '2026-03-08T05:00:00.000Z',
      to: '2026-03-09T04:00:00.000Z',
    });
    assert.deepEqual(localDayRange('2026-11-01', 'America/Los_Angeles'), {
      from: '2026-11-01T07:00:00.000Z',
      to: '2026-11-02T08:00:00.000Z',
    });
  });

  it('un vuelo a las 23:59 del día local sigue en ese día; a las 00:00 ya es el siguiente', () => {
    assert.equal(localDate('2026-03-09T03:59:00Z', 'America/New_York'), '2026-03-08');
    assert.equal(localDate('2026-03-09T04:00:00Z', 'America/New_York'), '2026-03-09');
  });
});

describe('crew_db.sql: bases de la demo antigua (BE-4)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../../../database/crew_db.sql'), 'utf8');

  it('BOG, MDE y CLO quedan en NULL en base y base_code, después de la copia de base_code', () => {
    const copy = sql.indexOf('UPDATE public.crew_members SET base = base_code');
    const clear = sql.search(
      /UPDATE public\.crew_members\s+SET base = NULL, base_code = NULL\s+WHERE base IN \('BOG', 'MDE', 'CLO'\) OR base_code IN \('BOG', 'MDE', 'CLO'\);/
    );
    assert.ok(copy > -1, 'sigue la copia de base_code a base');
    // Si fuera antes, la copia volvería a poner BOG en base en cada ejecución.
    assert.ok(clear > copy, 'el UPDATE a NULL va después de la copia');
  });
});
