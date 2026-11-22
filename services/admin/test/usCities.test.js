const { test } = require('node:test');
const assert = require('node:assert/strict');

// 50 estados y el Distrito de Columbia.
const STATE_CODES = new Set(
  (
    'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO ' +
    'MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'
  ).split(' ')
);

// Ciudades de los hubs de Delta (JFK y LGA son las dos New York).
const HUB_CITIES = [
  'Atlanta, GA',
  'Boston, MA',
  'Detroit, MI',
  'Los Angeles, CA',
  'Minneapolis, MN',
  'New York, NY',
  'Salt Lake City, UT',
  'Seattle, WA',
];

// El require va aquí para que, si el módulo falta, cada test falle por su cuenta.
function catalog() {
  return require('../src/domain/usCities');
}

test('CF-B8: el catálogo tiene unas 150 ciudades', () => {
  const { US_CITIES } = catalog();

  assert.ok(US_CITIES.length >= 140 && US_CITIES.length <= 160, `tiene ${US_CITIES.length}`);
});

test('CF-B8: cada ciudad tiene el formato «Ciudad, ST» en ASCII y con un estado real', () => {
  const { US_CITIES } = catalog();

  for (const city of US_CITIES) {
    assert.match(city, /^[A-Za-z][A-Za-z .'-]*, [A-Z]{2}$/, city);
    assert.ok(STATE_CODES.has(city.slice(-2)), `estado desconocido: ${city}`);
  }
});

test('CF-B8: el catálogo está ordenado alfabéticamente (localeCompare en inglés)', () => {
  const { US_CITIES } = catalog();

  assert.deepEqual(US_CITIES, [...US_CITIES].sort((a, b) => a.localeCompare(b, 'en')));
});

test('CF-B8: el catálogo no repite ciudades, sin distinguir mayúsculas', () => {
  const { US_CITIES } = catalog();

  const lower = US_CITIES.map((city) => city.toLowerCase());
  assert.equal(new Set(lower).size, US_CITIES.length);
});

test('CF-B8: el catálogo incluye las ciudades de todos los hubs de Delta', () => {
  const { US_CITIES } = catalog();

  for (const city of HUB_CITIES) {
    assert.ok(US_CITIES.includes(city), `falta ${city}`);
  }
});

test('CF-B8: el catálogo no se puede modificar desde fuera', () => {
  const { US_CITIES } = catalog();

  assert.ok(Object.isFrozen(US_CITIES));
});

test('CF-B8: findUsCity devuelve la forma del catálogo sin distinguir mayúsculas ni espacios en los extremos', () => {
  const { findUsCity } = catalog();

  assert.equal(findUsCity('  salt lake city, ut '), 'Salt Lake City, UT');
  assert.equal(findUsCity('ATLANTA, GA'), 'Atlanta, GA');
});

test('CF-B8: findUsCity devuelve null con una ciudad que no está en el catálogo', () => {
  const { findUsCity } = catalog();

  for (const value of ['Bogotá', 'Atlanta', 'Atlanta GA', 'constructor', '', 42, null]) {
    assert.equal(findUsCity(value), null, String(value));
  }
});
