// Crea las bases que falten y aplica sus scripts de database/.
//
// Uso (desde la raíz):
//   npm run db:migrate                  las cinco bases
//   npm run db:migrate -- crew          solo crew_db (también vale «crew_db»)
//   npm run db:migrate -- admin crew    varias
//
// - Conexión, en este orden:
//   1. DATABASE_URL. Si trae nombre de base, es solo la base de mantenimiento:
//      el nombre se cambia por cada base destino.
//   2. PGHOST, PGPORT, PGUSER y PGPASSWORD.
//   3. DB_HOST, DB_PORT, DB_USER y DB_PASSWORD, las mismas de los servicios
//      (DB_NAME se ignora: la base sale del argumento).
//   La base de mantenimiento, donde se ejecuta CREATE DATABASE, es PGDATABASE
//   o, si no está, postgres. Sin ninguna de esas variables, el script no se
//   conecta a nada. No lee los .env de los servicios.
// - Por cada base: la crea si no existe y ejecuta su script completo en una
//   transacción. Si el script falla, no queda nada a medias de esa base.
// - Se detiene en el primer error, lo muestra y sale con código 1. Los scripts
//   se pueden repetir sin error.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASES = ['admin_db', 'crew_db', 'flights_db', 'recommendation_db', 'notification_db'];

function scriptPath(database) {
  return path.join(__dirname, `${database}.sql`);
}

function shortName(database) {
  return database.replace(/_db$/, '');
}

// Nombres de base de los argumentos («crew» o «crew_db»), en el orden de
// DATABASES. Sin argumentos, todas. Un nombre desconocido es un error.
function resolveTargets(args) {
  if (args.length === 0) return [...DATABASES];
  const unknown = args.filter((arg) => !DATABASES.some((db) => arg === db || arg === shortName(db)));
  if (unknown.length > 0) {
    const names = unknown.map((arg) => `«${arg}»`).join(', ');
    throw new Error(
      `Base desconocida: ${names}. Válidas: ${DATABASES.map(shortName).join(', ')} (o con _db).`
    );
  }
  return DATABASES.filter((db) => args.some((arg) => arg === db || arg === shortName(db)));
}

// source y server se pueden mostrar: nunca llevan la contraseña.
function resolveConnection(env) {
  if (env.DATABASE_URL) {
    const base = new URL(env.DATABASE_URL);
    const maintenance = decodeURIComponent(base.pathname.replace(/^\//, '')) || 'postgres';
    return {
      source: 'DATABASE_URL',
      server: `${base.hostname}:${base.port || 5432}`,
      maintenance,
      configFor(database) {
        const url = new URL(env.DATABASE_URL);
        url.pathname = `/${database}`;
        return { connectionString: url.toString() };
      },
    };
  }

  const [source, prefix] = env.PGHOST ? ['PG*', 'PG'] : env.DB_HOST ? ['DB_*', 'DB_'] : [];
  if (!source) {
    throw new Error(
      'Falta la conexión: define DATABASE_URL, PGHOST (con PGPORT, PGUSER y PGPASSWORD) o DB_HOST (con DB_PORT, DB_USER y DB_PASSWORD).'
    );
  }
  const host = env[`${prefix}HOST`];
  const port = Number(env[`${prefix}PORT`]) || 5432;
  return {
    source,
    server: `${host}:${port}`,
    maintenance: env.PGDATABASE || 'postgres',
    configFor(database) {
      return {
        host,
        port,
        user: env[`${prefix}USER`] || 'postgres',
        password: env[`${prefix}PASSWORD`],
        database,
      };
    },
  };
}

// 'creada' o 'existente'. El nombre debe ser uno de DATABASES: nunca se
// interpola otra cosa en CREATE DATABASE.
async function ensureDatabase(client, database) {
  if (!DATABASES.includes(database)) {
    throw new Error(`${database} no está en la lista de bases.`);
  }
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (rows.length > 0) return 'existente';
  try {
    await client.query(`CREATE DATABASE "${database}"`);
    return 'creada';
  } catch (err) {
    if (err.code === '42P04') return 'existente'; // otro proceso la creó a la vez
    throw err;
  }
}

// Ningún script tiene sentencias que no admitan transacción (CREATE DATABASE,
// VACUUM, CREATE INDEX CONCURRENTLY...): los BEGIN que contienen son de bloques DO.
// lock_timeout: si una tabla está bloqueada (p. ej. por los servicios encendidos), el
// script falla a los 10 s y se deshace, en vez de dejar en cola todas las consultas.
async function applyScript(client, sql) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// Solo los campos del error de Postgres: nunca la configuración de conexión.
function describeError(err, sql) {
  const parts = [err.message];
  if (err.code) parts[0] += ` [${err.code}]`;
  if (sql && err.position) {
    const line = sql.slice(0, Number(err.position) - 1).split('\n').length;
    parts.push(`línea ${line} del script`);
  }
  if (err.detail) parts.push(`detalle: ${err.detail}`);
  if (err.hint) parts.push(`sugerencia: ${err.hint}`);
  if (err.where) parts.push(`contexto: ${err.where}`);
  return parts.join('\n    ');
}

async function withClient(config, fn) {
  const client = new Client(config);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main(args, env) {
  const targets = resolveTargets(args);
  const conn = resolveConnection(env);
  const scripts = targets.map((database) => {
    const file = scriptPath(database);
    if (!fs.existsSync(file)) throw new Error(`No existe ${path.relative(process.cwd(), file)}.`);
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  });

  console.log(
    `Servidor ${conn.server} (${conn.source}), base de mantenimiento ${conn.maintenance}: ${targets.join(', ')}`
  );
  const started = Date.now();
  for (const [i, database] of targets.entries()) {
    const sql = scripts[i];
    const t0 = Date.now();
    let step = 'comprobar o crear la base';
    try {
      const state = await withClient(conn.configFor(conn.maintenance), (client) =>
        ensureDatabase(client, database)
      );
      step = `aplicar database/${database}.sql`;
      await withClient(conn.configFor(database), (client) => applyScript(client, sql));
      console.log(`  ${database}: ${state}, script aplicado (${Date.now() - t0} ms)`);
    } catch (err) {
      console.error(`  ${database}: ERROR al ${step}:\n    ${describeError(err, step.startsWith('aplicar') && sql)}`);
      const pending = targets.slice(i + 1);
      if (pending.length > 0) console.error(`Migración detenida: no se tocaron ${pending.join(', ')}.`);
      return 1;
    }
  }
  console.log(`Listo: ${targets.length} base(s) en ${Date.now() - started} ms.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

module.exports = { DATABASES, scriptPath, resolveTargets, resolveConnection, ensureDatabase, applyScript };
