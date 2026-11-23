const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Revisión final del seed de demo (database/seed-demo.js). Vive aquí porque el glob de
// npm test solo recorre services/*/test, como el de migrate. Lo que toca la base se
// probó con el Postgres desechable: dos corridas seguidas y una con host remoto.
const seed = require('../../../database/seed-demo');

const OLD_DEMO_DL = [
  'DL0410', 'DL2104', 'DL1102', 'DL2231', 'DL0044', 'DL2232', 'DL1105',
  'DL1103', 'DL2235', 'DL0045', 'DL0598', 'DL2237', 'DL0001', 'DL2239',
];
const OLD_DEMO_AV = [
  'AV-4021', 'AV-4022', 'AV-8118', 'AV-8120', 'AV-8122', 'AV-8124', 'AV-8126',
  'AV-8128', 'AV-9120', 'AV-9122', 'AV-9340', 'AV-9344', 'AV-9345', 'AV-9346',
];

describe('seed-demo: solo contra una base local', () => {
  it('cargar el módulo no ejecuta el seed', () => {
    assert.equal(typeof seed.assertSafeTarget, 'function');
  });

  it('localhost, 127.0.0.1 y ::1 son locales; cualquier otro host no', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '::1', '[::1]']) {
      assert.equal(seed.isLocalHost(host), true, host);
    }
    for (const host of ['db.example.com', 'postgres.railway.internal', '10.0.0.5', '127.0.0.2', 'localhost.evil.com', '', undefined]) {
      assert.equal(seed.isLocalHost(host), false, String(host));
    }
  });

  it('el host sale de DATABASE_URL, luego de PGHOST y luego de services/admin/.env', () => {
    const noFile = () => assert.fail('no debería leer services/admin/.env');
    assert.equal(seed.targetHost({ DATABASE_URL: 'postgres://u:p@[::1]:5432/x', PGHOST: 'otro' }, noFile), '::1');
    assert.equal(seed.targetHost({ DATABASE_URL: 'postgresql://u:p@db.example.com/x' }, noFile), 'db.example.com');
    assert.equal(seed.targetHost({ PGHOST: 'remote.invalid' }, noFile), 'remote.invalid');
    assert.equal(seed.targetHost({}, () => ({ DB_HOST: '10.0.0.5' })), '10.0.0.5');
    assert.equal(seed.targetHost({}, () => ({})), 'localhost');
  });

  it('con un host remoto se niega, salvo con SEED_DEMO_ALLOW_REMOTE=1', () => {
    const readEnvFile = () => ({});
    assert.throws(
      () => seed.assertSafeTarget({ PGHOST: 'remote.invalid' }, readEnvFile),
      /remote\.invalid.*SEED_DEMO_ALLOW_REMOTE=1/s
    );
    assert.throws(() => seed.assertSafeTarget({ DATABASE_URL: 'postgres://u:p@db.example.com/x' }, readEnvFile));
    assert.throws(() => seed.assertSafeTarget({}, () => ({ DB_HOST: 'db.example.com' })));
    assert.throws(() => seed.assertSafeTarget({ PGHOST: 'remote.invalid', SEED_DEMO_ALLOW_REMOTE: 'true' }, readEnvFile));
    assert.doesNotThrow(() => seed.assertSafeTarget({ PGHOST: 'remote.invalid', SEED_DEMO_ALLOW_REMOTE: '1' }, readEnvFile));
    assert.doesNotThrow(() => seed.assertSafeTarget({ PGHOST: '127.0.0.1' }, readEnvFile));
    assert.doesNotThrow(() => seed.assertSafeTarget({ DATABASE_URL: 'postgres://u:p@localhost:55432/x' }, readEnvFile));
  });

  it('con NODE_ENV=production se niega siempre, aunque el host sea local', () => {
    assert.throws(
      () => seed.assertSafeTarget({ NODE_ENV: 'production', PGHOST: 'localhost', SEED_DEMO_ALLOW_REMOTE: '1' }, () => ({})),
      /NODE_ENV=production/
    );
  });
});

describe('seed-demo: datos que no chocan con datos reales', () => {
  it('los 14 vuelos usan los números DL9901 a DL9914, que ningún vuelo real usa', () => {
    const numbers = seed.flights.map(([number]) => number);
    assert.deepEqual(
      numbers.toSorted(),
      Array.from({ length: 14 }, (_, index) => `DL99${String(index + 1).padStart(2, '0')}`)
    );
  });

  it('la tripulación armada y los confirmados solo usan esos números', () => {
    const numbers = new Set(seed.flights.map(([number]) => number));
    assert.ok(seed.assignments.every(([number]) => numbers.has(number)));
    assert.ok(seed.confirmedFlights.every((number) => numbers.has(number)));
  });

  it('de las demos anteriores se borran solo sus números exactos (con su id estable)', () => {
    assert.deepEqual(seed.LEGACY_FLIGHT_NUMBERS.toSorted(), [...OLD_DEMO_DL, ...OLD_DEMO_AV].toSorted());
    // El id estable es el mismo que les dio la demo de su momento.
    assert.equal(seed.stableId('flight:DL0410'), seed.stableId('flight:DL0410'));
    assert.match(seed.stableId('flight:DL0410'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('las matrículas de demo son nuevas (N99xAC): no reutiliza las de la demo anterior', () => {
    const registrations = seed.aircraft.map(([registration]) => registration);
    assert.equal(new Set(registrations).size, registrations.length);
    assert.ok(registrations.every((registration) => /^N99\dAC$/.test(registration)), registrations.join(', '));
    for (const old of ['N321AC', 'N322AC', 'N739AC', 'N740AC', 'N330AC', 'N350AC']) {
      assert.ok(!registrations.includes(old), old);
    }
    const used = new Set(seed.flights.map(([, registration]) => registration));
    assert.ok([...used].every((registration) => registrations.includes(registration)));
  });
});
