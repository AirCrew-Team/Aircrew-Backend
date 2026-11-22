// Datos de demo de AirCrew (Delta Air Lines): un supervisor de JFK, 21
// tripulantes de JFK, ATL y LAX, 6 aeronaves, 3 destinos internacionales y 14
// vuelos DL (12 en los próximos 7 días y 2 ya realizados).
//
// NUNCA en producción: el script se niega a correr con NODE_ENV=production.
// Borra y vuelve a crear datos, así que úsalo solo con una base local o de pruebas.
//
// Uso (desde la raíz):  npm run seed:demo
//
// - Conexión, en este orden:
//   1. DATABASE_URL (una URL de PostgreSQL; el nombre de la base se cambia por
//      cada una de las cuatro).
//   2. PGHOST, PGPORT, PGUSER y PGPASSWORD.
//   3. services/admin/.env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD).
//   Las cuatro bases (admin_db, crew_db, flights_db, recommendation_db) deben
//   existir con sus scripts de database/ ya ejecutados: ellos siembran los 9 hubs.
// - Se puede ejecutar las veces que quieras: primero borra SOLO los datos de demo
//   (correos @aircrew.demo, los vuelos DL de esta lista y, de la demo antigua de
//   Colombia, los vuelos AV-*, sus aeronaves y sus aeropuertos) y los vuelve a
//   crear con fechas a partir de ahora. Tus otros datos no se tocan.
// - Todos los usuarios de demo tienen la contraseña DEMO_PASSWORD.
// - Teléfonos de ficción (+1 … 555-01xx), nombres y matrículas inventados.

const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { HUBS } = require('@vuelos/shared');
const { findModel } = require('../services/flights/src/domain/aircraftCatalog');

if (process.env.NODE_ENV === 'production') {
  console.error('seed-demo no se ejecuta con NODE_ENV=production: borra y recrea datos.');
  process.exit(1);
}

const DEMO_PASSWORD = 'AirCrewDemo2026';
const DEMO_DOMAIN = '@aircrew.demo';
const HOUR = 60 * 60 * 1000;
const DATABASES = ['admin_db', 'crew_db', 'flights_db', 'recommendation_db'];

// ---------- Conexión ----------

function connectionFor(database) {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${database}`;
    return { connectionString: url.toString() };
  }
  if (process.env.PGHOST) {
    return {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database,
    };
  }
  const env = require('dotenv').config({
    path: path.join(__dirname, '../services/admin/.env'),
  }).parsed || {};
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 5432,
    user: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD,
    database,
  };
}

// Servidor al que se va a escribir, para mostrarlo antes de borrar nada.
function describeTarget() {
  const sample = connectionFor('admin_db');
  if (sample.connectionString) {
    const url = new URL(sample.connectionString);
    return { label: `${url.hostname}:${url.port || 5432} (DATABASE_URL)`, hasPassword: true };
  }
  const source = process.env.PGHOST ? 'PG*' : 'services/admin/.env';
  return { label: `${sample.host}:${sample.port} (${source})`, hasPassword: Boolean(sample.password) };
}

// UUID estable a partir de un texto: el mismo tripulante tiene siempre el mismo id.
function stableId(text) {
  const hex = crypto.createHash('sha256').update(`aircrew-demo:${text}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function dateOnly(daysFromToday) {
  const date = new Date(Date.now() + daysFromToday * 24 * HOUR);
  return date.toISOString().slice(0, 10);
}

// ---------- Catálogos ----------

// Destinos internacionales de Delta que usan los vuelos de demo. Los hubs (EE. UU.)
// los siembran los scripts; estos van solo en el seed.
const internationalAirports = [
  ['CDG', 'LFPG', 'París', 'Paris-Charles de Gaulle', 'FR', 'Europe/Paris'],
  ['LHR', 'EGLL', 'Londres', 'London Heathrow', 'GB', 'Europe/London'],
  ['CUN', 'MMUN', 'Cancún', 'Cancún International', 'MX', 'America/Cancun'],
];

// Restos de la demo antigua (Colombia). Se borran si ningún vuelo los usa.
const LEGACY_AIRCRAFT = ['HK-5320', 'HK-5321', 'HK-5330', 'HK-5322', 'N781AV'];
const LEGACY_AIRPORTS = ['BOG', 'MDE', 'CLO', 'CTG', 'MIA', 'MAD', 'PTY', 'LIM'];

// Familia de cada modelo del catálogo para la regla de habilitación (ratings).
const FAMILY_BY_MODEL = { a321neo: 'A320', b739: '737', a330neo: 'A330', a350: 'A350' };

// [matrícula, modelo del catálogo de flights, base, estado]
const aircraft = [
  ['N321AC', 'a321neo', 'JFK', 'operating'],
  ['N322AC', 'a321neo', 'ATL', 'operating'],
  ['N739AC', 'b739', 'JFK', 'operating'],
  ['N740AC', 'b739', 'LAX', 'maintenance'],
  ['N330AC', 'a330neo', 'JFK', 'operating'],
  ['N350AC', 'a350', 'ATL', 'operating'],
];

// ---------- Personas ----------

const supervisor = {
  key: 'karen.walsh',
  name: 'Karen Walsh',
  phone: '+12125550100',
  employeeCode: 'SUP-JFK-01',
  base: 'JFK',
  shift: 'afternoon',
};

// Cargo (CREW_POSITIONS de admin) según el rango a bordo.
const POSITION_LABEL = {
  captain: 'Comandante',
  first_officer: 'Copiloto',
  purser: 'Sobrecargo Principal',
  flight_attendant: 'Auxiliar de Vuelo',
};

// key, nombre, código, rank, base, familias, inglés OACI, días hasta vencer el
// certificado médico, estado, guardia [ubicación, minutos a rampa] (si on_duty)
const crew = [
  ['michael.carter', 'Michael Carter', 'EMP-010', 'captain', 'JFK', ['737', 'A330'], 6, 200, 'available'],
  ['jennifer.hayes', 'Jennifer Hayes', 'EMP-011', 'captain', 'JFK', ['737'], 6, 150, 'available'],
  ['robert.sullivan', 'Robert Sullivan', 'EMP-012', 'captain', 'ATL', ['A320', 'A350'], 6, 90, 'available'],
  ['emily.brooks', 'Emily Brooks', 'EMP-013', 'captain', 'JFK', ['A330', 'A350'], 6, 300, 'on_duty', ['Sala de tripulaciones T4', 15]],
  ['james.reed', 'James Reed', 'EMP-021', 'first_officer', 'JFK', ['A320'], 5, 120, 'on_duty', ['Sala de tripulaciones T4', 12]],
  ['sarah.collins', 'Sarah Collins', 'EMP-022', 'first_officer', 'JFK', ['737', 'A330'], 6, 180, 'available'],
  ['daniel.foster', 'Daniel Foster', 'EMP-023', 'first_officer', 'JFK', ['A320'], 4, 160, 'on_duty', ['Hotel del aeropuerto', 25]],
  ['kevin.price', 'Kevin Price', 'EMP-024', 'first_officer', 'JFK', ['737'], 5, -5, 'available'],
  ['brian.ward', 'Brian Ward', 'EMP-025', 'first_officer', 'LAX', ['737'], 5, 100, 'vacation'],
  ['amanda.ross', 'Amanda Ross', 'EMP-026', 'first_officer', 'JFK', ['A320'], 5, 140, 'available'],
  ['ryan.bennett', 'Ryan Bennett', 'EMP-027', 'first_officer', 'JFK', ['A320', 'A330'], 6, 190, 'available'],
  ['tyler.morgan', 'Tyler Morgan', 'EMP-028', 'first_officer', 'JFK', ['737', 'A330'], 3, 220, 'on_duty', ['Hotel del aeropuerto', 30]],
  ['david.mitchell', 'David Mitchell', 'EMP-014', 'captain', 'JFK', ['A320', '737'], 6, 250, 'available'],
  ['nicole.turner', 'Nicole Turner', 'EMP-030', 'purser', 'JFK', ['737', 'A330'], 5, 140, 'available'],
  ['rachel.adams', 'Rachel Adams', 'EMP-031', 'purser', 'JFK', ['A320'], 4, 110, 'on_duty', ['Sala de tripulaciones T4', 10]],
  ['matthew.hill', 'Matthew Hill', 'EMP-040', 'flight_attendant', 'JFK', ['737'], 4, 130, 'available'],
  ['olivia.parker', 'Olivia Parker', 'EMP-041', 'flight_attendant', 'JFK', ['A320', 'A330'], 5, 170, 'on_duty', ['Sala de tripulaciones T4', 8]],
  ['andrew.cooper', 'Andrew Cooper', 'EMP-042', 'flight_attendant', 'JFK', ['737'], 3, 95, 'available'],
  ['megan.howard', 'Megan Howard', 'EMP-043', 'flight_attendant', 'JFK', ['737', 'A330'], 4, 210, 'available'],
  ['lauren.bailey', 'Lauren Bailey', 'EMP-044', 'flight_attendant', 'JFK', ['A320'], 4, 60, 'medical_leave'],
  ['joshua.kelly', 'Joshua Kelly', 'EMP-045', 'flight_attendant', 'LAX', ['737'], 3, 80, 'available'],
];

// ---------- Vuelos ----------

// número, matrícula, origen, destino, horas desde ahora, duración (min), puerta
const flights = [
  // Ya realizados (historial de Mis Vuelos).
  ['DL0410', 'N739AC', 'LAX', 'JFK', -50, 330, 'B24'],
  ['DL2104', 'N321AC', 'JFK', 'BOS', -26, 75, 'C61'],
  ['DL1102', 'N739AC', 'JFK', 'LAX', 3, 380, 'B27'],
  ['DL2231', 'N321AC', 'JFK', 'ATL', 5, 150, 'C64'],
  ['DL0044', 'N330AC', 'JFK', 'CDG', 26, 435, 'B32'],
  ['DL2232', 'N322AC', 'ATL', 'JFK', 28, 135, 'A17'],
  ['DL1105', 'N739AC', 'JFK', 'SEA', 30, 380, 'B29'],
  ['DL1103', 'N739AC', 'LAX', 'JFK', 50, 320, '23A'],
  ['DL2235', 'N321AC', 'JFK', 'MSP', 52, 190, 'C66'],
  ['DL0045', 'N330AC', 'CDG', 'JFK', 74, 520, '2E-K40'],
  ['DL0598', 'N322AC', 'ATL', 'CUN', 76, 135, 'E12'],
  ['DL2237', 'N321AC', 'JFK', 'DTW', 100, 125, 'C68'],
  ['DL0001', 'N330AC', 'JFK', 'LHR', 124, 420, 'B30'],
  ['DL2239', 'N321AC', 'JFK', 'SLC', 148, 315, 'C70'],
];

// Tripulación ya armada: DL1102 completa y confirmada (sirve para reportar una
// ausencia en la demo); DL2231 y DL0044 a medias (para Programación).
const assignments = [
  ['DL0410', 'first_officer', 'first_officer', 'sarah.collins'],
  ['DL0410', 'captain', 'captain', 'jennifer.hayes'],
  ['DL2104', 'first_officer', 'first_officer', 'amanda.ross'],
  ['DL2104', 'captain', 'captain', 'david.mitchell'],
  ['DL1102', 'captain', 'captain', 'jennifer.hayes'],
  ['DL1102', 'first_officer', 'first_officer', 'sarah.collins'],
  ['DL1102', 'purser', 'purser', 'nicole.turner'],
  ['DL1102', 'fa-1', 'flight_attendant', 'matthew.hill'],
  ['DL1102', 'fa-2', 'flight_attendant', 'andrew.cooper'],
  ['DL1102', 'fa-3', 'flight_attendant', 'megan.howard'],
  ['DL2231', 'captain', 'captain', 'david.mitchell'],
  ['DL2231', 'first_officer', 'first_officer', 'ryan.bennett'],
  ['DL0044', 'captain', 'captain', 'emily.brooks'],
];
const confirmedFlights = ['DL0410', 'DL2104', 'DL1102'];

// ---------- Ejecución ----------

async function connect(database) {
  const client = new Client(connectionFor(database));
  await client.connect();
  return client;
}

async function main() {
  const target = describeTarget();
  if (!target.hasPassword) {
    throw new Error('Falta la contraseña: usa DATABASE_URL, PGPASSWORD o DB_PASSWORD en services/admin/.env.');
  }
  console.log(`Destino: ${target.label} · ${DATABASES.join(', ')}`);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userId = (key) => stableId(`user:${key}`);
  const flightNumbers = flights.map((f) => f[0]);
  const flightIds = Object.fromEntries(flightNumbers.map((number) => [number, stableId(`flight:${number}`)]));

  const [admin, crewDb, flightsDb, recommendation] = await Promise.all(DATABASES.map(connect));

  try {
    // 1. Borrar los datos de demo anteriores (de hijos a padres). Los ids salen de
    //    la base, para borrar también los de la demo antigua (otros nombres).
    const { rows: oldUsers } = await admin.query('SELECT id FROM public.users WHERE email LIKE $1', [`%${DEMO_DOMAIN}`]);
    const demoUserIds = [...new Set([
      ...oldUsers.map((row) => row.id),
      ...[supervisor.key, ...crew.map((c) => c[0])].map(userId),
    ])];
    // Solo los números DL de esta lista: un LIKE 'DL%' borraría también vuelos
    // reales de Delta cargados a mano en la misma base.
    const { rows: oldFlights } = await flightsDb.query(
      "SELECT id FROM public.flights WHERE flight_number LIKE 'AV-%' OR flight_number = ANY($1::text[])",
      [flightNumbers]
    );
    const demoFlightIds = oldFlights.map((row) => row.id);

    const { rows: oldAbsences } = await crewDb.query(
      'SELECT id FROM public.absences WHERE crew_user_id = ANY($1::uuid[]) OR flight_id = ANY($2::uuid[])',
      [demoUserIds, demoFlightIds]
    );
    const oldAbsenceIds = oldAbsences.map((row) => row.id);
    await recommendation.query('DELETE FROM public.replacement_suggestions WHERE absence_id = ANY($1::uuid[])', [oldAbsenceIds]);
    await recommendation.query('DELETE FROM public.ai_calls WHERE subject_id = ANY($1::uuid[])', [[...oldAbsenceIds, ...demoFlightIds]]);
    await crewDb.query('DELETE FROM public.absences WHERE id = ANY($1::uuid[])', [oldAbsenceIds]);
    await crewDb.query('DELETE FROM public.crew_members WHERE user_id = ANY($1::uuid[])', [demoUserIds]);
    await flightsDb.query(
      'DELETE FROM public.flight_assignments WHERE flight_id = ANY($1::uuid[]) OR crew_user_id = ANY($2::uuid[])',
      [demoFlightIds, demoUserIds]
    );
    await flightsDb.query('DELETE FROM public.flights WHERE id = ANY($1::uuid[])', [demoFlightIds]);
    await flightsDb.query(
      `DELETE FROM public.aircraft ac
       WHERE ac.registration = ANY($1::text[])
         AND NOT EXISTS (SELECT 1 FROM public.flights f WHERE f.aircraft_id = ac.id)`,
      [LEGACY_AIRCRAFT]
    );
    await flightsDb.query(
      `DELETE FROM public.airports a
       WHERE a.code = ANY($1::text[])
         AND NOT EXISTS (SELECT 1 FROM public.flights f WHERE f.origin = a.code OR f.destination = a.code)`,
      [LEGACY_AIRPORTS]
    );
    await admin.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [demoUserIds]);

    // 2. Catálogos: los hubs (por si los scripts son de antes de BE-4) y los
    //    destinos internacionales. No se toca la condición operativa de la base.
    for (const hub of HUBS) {
      await admin.query(
        `INSERT INTO public.bases (code, icao, name, city, unit, hq_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET icao = $2, name = $3, city = $4, unit = $5, hq_code = $6`,
        [hub.code, hub.icao, hub.airport, hub.city, hub.unit, hub.hqCode]
      );
    }

    const airports = [
      ...HUBS.map((hub) => [hub.code, hub.icao, hub.city, hub.airport, hub.country, hub.timezone]),
      ...internationalAirports,
    ];
    for (const [code, icao, city, name, country, timezone] of airports) {
      await flightsDb.query(
        `INSERT INTO public.airports (code, icao, city, name, country, timezone)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET icao = $2, city = $3, name = $4, country = $5, timezone = $6`,
        [code, icao, city, name, country, timezone]
      );
    }

    const aircraftIds = {};
    for (const [registration, modelId, base, status] of aircraft) {
      const model = findModel(modelId);
      const { rows } = await flightsDb.query(
        `INSERT INTO public.aircraft
           (name, registration, model_id, capacity, minimum_crew, base, status, maintenance_type, family)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (registration) DO UPDATE
           SET name = $1, model_id = $3, capacity = $4, minimum_crew = $5, base = $6,
               status = $7, maintenance_type = $8, maintenance_note = NULL, family = $9
         RETURNING id`,
        [model.name, registration, model.id, model.capacity,
          model.minimum_crew.pilots + model.minimum_crew.cabin, base, status,
          status === 'maintenance' ? 'revision_programada' : null, FAMILY_BY_MODEL[model.id]]
      );
      aircraftIds[registration] = rows[0].id;
    }

    // 3. Usuarios en Admin.
    await admin.query(
      `INSERT INTO public.users
         (id, name, email, password_hash, role, phone, employee_code, base, shift,
          operational_status, password_changed_at)
       VALUES ($1, $2, $3, $4, 'supervisor', $5, $6, $7, $8, 'available', now())`,
      [userId(supervisor.key), supervisor.name, `${supervisor.key}${DEMO_DOMAIN}`, passwordHash,
        supervisor.phone, supervisor.employeeCode, supervisor.base, supervisor.shift]
    );

    // En Admin solo los supervisores tienen base; la del tripulante está en Crew.
    for (const [key, name] of crew) {
      await admin.query(
        `INSERT INTO public.users (id, name, email, password_hash, role, password_changed_at)
         VALUES ($1, $2, $3, $4, 'crew', now())`,
        [userId(key), name, `${key}${DEMO_DOMAIN}`, passwordHash]
      );
    }

    // 4. Perfiles en Crew.
    for (const [index, [key, , code, rank, base, ratings, english, medicalDays, status, standby]] of crew.entries()) {
      await crewDb.query(
        `INSERT INTO public.crew_members
           (user_id, employee_code, position, rank, base, ratings, english_level,
            medical_expires_on, hire_date, phone, radio_channel, current_location, status,
            standby_location, minutes_to_ramp, standby_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          userId(key), code, POSITION_LABEL[rank], rank, base, ratings, english,
          dateOnly(medicalDays), dateOnly(-365 * (2 + (index % 8))),
          `+1212555${String(110 + index).padStart(4, '0')}`,
          standby ? 'OPS-2' : null,
          base, status,
          standby ? standby[0] : null,
          standby ? standby[1] : null,
          standby ? new Date(Date.now() + 8 * HOUR).toISOString() : null,
        ]
      );
    }

    // 5. Vuelos y tripulación armada. Salidas en horas en punto desde ahora.
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);

    for (const [number, registration, origin, destination, hours, minutes, gate] of flights) {
      const departure = new Date(start.getTime() + hours * HOUR);
      const arrival = new Date(departure.getTime() + minutes * 60 * 1000);
      await flightsDb.query(
        `INSERT INTO public.flights
           (id, flight_number, aircraft_id, origin, destination, departure_at, arrival_at, gate,
            crew_confirmed_at, crew_confirmed_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          flightIds[number], number, aircraftIds[registration], origin, destination,
          departure.toISOString(), arrival.toISOString(), gate,
          confirmedFlights.includes(number) ? new Date().toISOString() : null,
          confirmedFlights.includes(number) ? userId(supervisor.key) : null,
          hours < 0 ? 'completed' : 'scheduled',
        ]
      );
    }

    for (const [number, slotId, role, key] of assignments) {
      await flightsDb.query(
        `INSERT INTO public.flight_assignments (flight_id, crew_user_id, role, slot_id, source)
         VALUES ($1, $2, $3, $4, 'manual')`,
        [flightIds[number], userId(key), role, slotId]
      );
    }

    console.log('Datos de demo cargados:');
    console.log(`  ${HUBS.length} hubs, ${internationalAirports.length} destinos internacionales, ${aircraft.length} aeronaves`);
    console.log(`  1 supervisor y ${crew.length} tripulantes (contraseña: ${DEMO_PASSWORD})`);
    console.log(`  ${flights.length} vuelos (2 ya realizados), ${assignments.length} asignaciones`);
    console.log(`  Supervisor: ${supervisor.key}${DEMO_DOMAIN} (base ${supervisor.base})`);
  } finally {
    await Promise.all([admin, crewDb, flightsDb, recommendation].map((client) => client.end()));
  }
}

main().catch((error) => {
  console.error(`No se pudieron cargar los datos de demo: ${error.message}`);
  process.exit(1);
});
