// database/migrate.js vive en la raíz, pero el glob de `npm test` solo recorre
// services/*/test: por eso su test está aquí. Ninguno conecta a Postgres.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DATABASES,
  scriptPath,
  resolveTargets,
  resolveConnection,
  ensureDatabase,
  applyScript,
} = require('../../../database/migrate');

const ALL = ['admin_db', 'crew_db', 'flights_db', 'recommendation_db', 'notification_db'];

describe('migrate: lista de bases', () => {
  it('son las cinco bases, cada una con su script en database/', () => {
    assert.deepEqual(DATABASES, ALL);
    for (const name of DATABASES) {
      assert.equal(scriptPath(name), path.join(__dirname, '../../../database', `${name}.sql`));
      assert.ok(fs.existsSync(scriptPath(name)), `falta ${name}.sql`);
    }
  });
});

describe('migrate: argumentos', () => {
  it('sin argumentos aplica todas', () => {
    assert.deepEqual(resolveTargets([]), ALL);
  });

  it('acepta el nombre corto o el de la base, sin duplicados y en el orden de la lista', () => {
    assert.deepEqual(resolveTargets(['crew']), ['crew_db']);
    assert.deepEqual(resolveTargets(['notification', 'admin_db', 'crew', 'admin']), [
      'admin_db',
      'crew_db',
      'notification_db',
    ]);
  });

  it('un nombre desconocido es un error que lo nombra y lista los válidos', () => {
    assert.throws(() => resolveTargets(['foo']), (err) => {
      assert.match(err.message, /«foo»/);
      assert.match(err.message, /admin, crew, flights, recommendation, notification/);
      return true;
    });
  });

  it('si uno es inválido no se aplica ninguno', () => {
    assert.throws(() => resolveTargets(['crew', 'crew;DROP']), /crew;DROP/);
  });
});

describe('migrate: conexión', () => {
  const PG = { PGHOST: 'pg.local', PGPORT: '6000', PGUSER: 'pguser', PGPASSWORD: 'pg-secret' };
  const DB = { DB_HOST: 'db.local', DB_PORT: '7000', DB_USER: 'dbuser', DB_PASSWORD: 'db-secret' };

  it('DATABASE_URL manda: su base es la de mantenimiento y se cambia por cada destino', () => {
    const conn = resolveConnection({
      DATABASE_URL: 'postgres://u:url-secret@url.local:5433/railway?sslmode=require',
      ...PG,
      ...DB,
    });
    assert.equal(conn.source, 'DATABASE_URL');
    assert.equal(conn.server, 'url.local:5433');
    assert.equal(conn.maintenance, 'railway');
    const url = new URL(conn.configFor('crew_db').connectionString);
    assert.equal(url.pathname, '/crew_db');
    assert.equal(url.searchParams.get('sslmode'), 'require');
    assert.equal(url.password, 'url-secret');
    assert.equal(new URL(conn.configFor(conn.maintenance).connectionString).pathname, '/railway');
  });

  it('DATABASE_URL sin base usa postgres para mantenimiento', () => {
    const conn = resolveConnection({ DATABASE_URL: 'postgresql://u:p@h' });
    assert.equal(conn.maintenance, 'postgres');
    assert.equal(conn.server, 'h:5432');
  });

  it('PG* va antes que DB_*, con PGDATABASE como base de mantenimiento', () => {
    const conn = resolveConnection({ ...PG, PGDATABASE: 'railway', ...DB });
    assert.equal(conn.source, 'PG*');
    assert.equal(conn.server, 'pg.local:6000');
    assert.equal(conn.maintenance, 'railway');
    assert.deepEqual(conn.configFor('admin_db'), {
      host: 'pg.local',
      port: 6000,
      user: 'pguser',
      password: 'pg-secret',
      database: 'admin_db',
    });
  });

  it('DB_* (las variables de los servicios) con postgres por defecto e ignorando DB_NAME', () => {
    const conn = resolveConnection({ ...DB, DB_NAME: 'otra_db' });
    assert.equal(conn.source, 'DB_*');
    assert.equal(conn.server, 'db.local:7000');
    assert.equal(conn.maintenance, 'postgres');
    assert.deepEqual(conn.configFor('crew_db'), {
      host: 'db.local',
      port: 7000,
      user: 'dbuser',
      password: 'db-secret',
      database: 'crew_db',
    });
  });

  it('DB_* respeta PGDATABASE como base de mantenimiento', () => {
    assert.equal(resolveConnection({ ...DB, PGDATABASE: 'railway' }).maintenance, 'railway');
  });

  it('puerto 5432 y usuario postgres por defecto', () => {
    const conn = resolveConnection({ DB_HOST: 'db.local' });
    assert.equal(conn.server, 'db.local:5432');
    assert.equal(conn.configFor('crew_db').port, 5432);
    assert.equal(conn.configFor('crew_db').user, 'postgres');
  });

  it('sin ninguna variable de conexión es un error claro (no supone localhost)', () => {
    assert.throws(() => resolveConnection({}), /DATABASE_URL.*PGHOST.*DB_HOST/);
  });

  it('lo que se muestra del servidor nunca lleva la contraseña', () => {
    const conns = [
      resolveConnection({ DATABASE_URL: 'postgres://u:url-secret@url.local/railway' }),
      resolveConnection(PG),
      resolveConnection(DB),
    ];
    for (const conn of conns) {
      const shown = `${conn.source} ${conn.server} ${conn.maintenance}`;
      assert.doesNotMatch(shown, /secret/);
    }
  });
});

function fakeClient(responses = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push(params ? [text, params] : text);
      const response = responses[text];
      if (response instanceof Error) throw response;
      return response || { rows: [] };
    },
  };
}

describe('migrate: crear la base si falta', () => {
  const EXISTS = 'SELECT 1 FROM pg_database WHERE datname = $1';

  it('si existe no la crea', async () => {
    const client = fakeClient({ [EXISTS]: { rows: [{ '?column?': 1 }] } });
    assert.equal(await ensureDatabase(client, 'crew_db'), 'existente');
    assert.deepEqual(client.calls, [[EXISTS, ['crew_db']]]);
  });

  it('si no existe la crea con el nombre entre comillas', async () => {
    const client = fakeClient();
    assert.equal(await ensureDatabase(client, 'crew_db'), 'creada');
    assert.deepEqual(client.calls, [[EXISTS, ['crew_db']], 'CREATE DATABASE "crew_db"']);
  });

  it('si otro proceso la creó a la vez (42P04) cuenta como existente', async () => {
    const duplicate = Object.assign(new Error('database "crew_db" already exists'), {
      code: '42P04',
    });
    const client = fakeClient({ 'CREATE DATABASE "crew_db"': duplicate });
    assert.equal(await ensureDatabase(client, 'crew_db'), 'existente');
  });

  it('nunca crea una base fuera de la lista', async () => {
    const client = fakeClient();
    await assert.rejects(ensureDatabase(client, 'x"; DROP DATABASE admin_db; --'), /lista/);
    assert.deepEqual(client.calls, []);
  });
});

describe('migrate: aplicar el script', () => {
  it('ejecuta el script completo dentro de BEGIN/COMMIT', async () => {
    const client = fakeClient();
    await applyScript(client, 'CREATE TABLE a (); CREATE TABLE b ();');
    assert.deepEqual(client.calls, ['BEGIN', 'CREATE TABLE a (); CREATE TABLE b ();', 'COMMIT']);
  });

  it('si falla hace ROLLBACK y relanza el error de Postgres', async () => {
    const pgError = Object.assign(new Error('syntax error at or near "TABL"'), { code: '42601' });
    const client = fakeClient({ 'CREATE TABL x ();': pgError });
    await assert.rejects(applyScript(client, 'CREATE TABL x ();'), pgError);
    assert.deepEqual(client.calls, ['BEGIN', 'CREATE TABL x ();', 'ROLLBACK']);
  });
});
