// Datos de demo para AirCrew: bases, aeropuertos, aeronaves, un supervisor,
// 21 tripulantes, 12 vuelos en los próximos 7 días y 2 ya realizados.
//
// Uso (desde la raíz):  npm run seed:demo
//
// - Se puede ejecutar las veces que quieras: primero borra SOLO los datos de
//   demo (correos @aircrew.demo y vuelos AV-*) y los vuelve a crear con fechas
//   a partir de ahora. Tus otros datos no se tocan.
// - Usa la conexión de services/admin/.env (DB_HOST, DB_PORT, DB_USER,
//   DB_PASSWORD). Las cuatro bases deben existir con sus scripts ejecutados.
// - Todos los usuarios de demo tienen la contraseña DEMO_PASSWORD.

const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const env = require('dotenv').config({
  path: path.join(__dirname, '../services/admin/.env'),
}).parsed || {};

const DEMO_PASSWORD = 'AirCrewDemo2026';
const DEMO_DOMAIN = '@aircrew.demo';
const HOUR = 60 * 60 * 1000;

const connection = {
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT) || 5432,
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD,
};

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

const bases = [
  ['BOG', 'SKBO', 'Base Eldorado', 'Bogotá', 'Jefatura de Operaciones de Vuelo', 'BOG-HQ'],
  ['MDE', 'SKRG', 'Base José María Córdova', 'Rionegro', 'Jefatura Regional Antioquia', 'MDE-HQ'],
  ['CLO', 'SKCL', 'Base Alfonso Bonilla Aragón', 'Cali', 'Jefatura Regional Pacífico', 'CLO-HQ'],
];

const airports = [
  ['BOG', 'SKBO', 'Bogotá', 'El Dorado', 'CO', 'America/Bogota'],
  ['MDE', 'SKRG', 'Rionegro', 'José María Córdova', 'CO', 'America/Bogota'],
  ['CLO', 'SKCL', 'Cali', 'Alfonso Bonilla Aragón', 'CO', 'America/Bogota'],
  ['CTG', 'SKCG', 'Cartagena', 'Rafael Núñez', 'CO', 'America/Bogota'],
  ['MIA', 'KMIA', 'Miami', 'Miami Intl', 'US', 'America/New_York'],
  ['MAD', 'LEMD', 'Madrid', 'Adolfo Suárez Madrid-Barajas', 'ES', 'Europe/Madrid'],
  ['PTY', 'MPTO', 'Ciudad de Panamá', 'Tocumen', 'PA', 'America/Panama'],
  ['LIM', 'SPJC', 'Lima', 'Jorge Chávez', 'PE', 'America/Lima'],
];

// [matrícula, modelo, familia, sillas, estado]
const aircraft = [
  ['HK-5320', 'Airbus A320', 'A320', 180, 'operating'],
  ['HK-5321', 'Airbus A320neo', 'A320', 186, 'operating'],
  ['HK-5330', 'Airbus A321', 'A320', 220, 'operating'],
  ['HK-5322', 'Airbus A320', 'A320', 180, 'maintenance'],
  ['N781AV', 'Boeing 787-8', '787', 248, 'operating'],
];

// ---------- Personas ----------

const supervisor = {
  key: 'camila.restrepo',
  name: 'Camila Restrepo',
  phone: '+573001112233',
  employeeCode: 'SUP-BOG-01',
  base: 'BOG',
  shift: 'afternoon',
};

const POSITION_LABEL = {
  captain: 'Comandante',
  first_officer: 'Primer Oficial',
  purser: 'Jefe de Cabina',
  flight_attendant: 'Auxiliar de Vuelo',
};

// key, nombre, código, rank, base, familias, inglés OACI, días hasta vencer el
// certificado médico, estado, guardia [ubicación, minutos a rampa] (si on_duty)
const crew = [
  ['ricardo.morales', 'Ricardo Morales', 'EMP-010', 'captain', 'BOG', ['A320', '787'], 5, 200, 'available'],
  ['laura.perez', 'Laura Pérez', 'EMP-011', 'captain', 'BOG', ['A320'], 4, 150, 'available'],
  ['jorge.castano', 'Jorge Castaño', 'EMP-012', 'captain', 'MDE', ['A320'], 4, 90, 'available'],
  ['sofia.herrera', 'Sofía Herrera', 'EMP-013', 'captain', 'BOG', ['787', 'A320'], 6, 300, 'on_duty', ['Sala de tripulaciones T1', 15]],
  ['andres.gomez', 'Andrés Gómez', 'EMP-021', 'first_officer', 'BOG', ['A320'], 5, 120, 'on_duty', ['Sala de tripulaciones T1', 12]],
  ['valentina.rios', 'Valentina Ríos', 'EMP-022', 'first_officer', 'BOG', ['A320', '787'], 5, 180, 'available'],
  ['daniel.ortiz', 'Daniel Ortiz', 'EMP-023', 'first_officer', 'BOG', ['A320'], 3, 160, 'on_duty', ['Hotel aeropuerto', 25]],
  ['juan.ruiz', 'Juan Ruiz', 'EMP-024', 'first_officer', 'BOG', ['A320'], 4, -5, 'available'],
  ['camilo.vargas', 'Camilo Vargas', 'EMP-025', 'first_officer', 'MDE', ['A320'], 4, 100, 'vacation'],
  ['carolina.mendez', 'Carolina Méndez', 'EMP-026', 'first_officer', 'BOG', ['A320'], 4, 140, 'available'],
  ['felipe.rojas', 'Felipe Rojas', 'EMP-027', 'first_officer', 'BOG', ['A320', '787'], 5, 190, 'available'],
  ['sebastian.pardo', 'Sebastián Pardo', 'EMP-028', 'first_officer', 'BOG', ['A320'], 5, 220, 'on_duty', ['Hotel aeropuerto', 30]],
  ['diego.salazar', 'Diego Salazar', 'EMP-014', 'captain', 'BOG', ['A320'], 5, 250, 'available'],
  ['natalia.suarez', 'Natalia Suárez', 'EMP-030', 'purser', 'BOG', ['A320', '787'], 5, 140, 'available'],
  ['paula.mejia', 'Paula Mejía', 'EMP-031', 'purser', 'BOG', ['A320'], 4, 110, 'on_duty', ['Sala de tripulaciones T1', 10]],
  ['mateo.lopez', 'Mateo López', 'EMP-040', 'flight_attendant', 'BOG', ['A320'], 4, 130, 'available'],
  ['isabella.torres', 'Isabella Torres', 'EMP-041', 'flight_attendant', 'BOG', ['A320', '787'], 5, 170, 'on_duty', ['Sala de tripulaciones T1', 8]],
  ['santiago.ramirez', 'Santiago Ramírez', 'EMP-042', 'flight_attendant', 'BOG', ['A320'], 3, 95, 'available'],
  ['mariana.cruz', 'Mariana Cruz', 'EMP-043', 'flight_attendant', 'BOG', ['A320', '787'], 4, 210, 'available'],
  ['luisa.fernandez', 'Luisa Fernández', 'EMP-044', 'flight_attendant', 'BOG', ['A320'], 4, 60, 'medical_leave'],
  ['tomas.alvarez', 'Tomás Álvarez', 'EMP-045', 'flight_attendant', 'MDE', ['A320'], 3, 80, 'available'],
];

// ---------- Vuelos ----------

// número, matrícula, origen, destino, horas desde ahora, duración (min), puerta
const flights = [
  // Ya realizados (historial de Mis Vuelos).
  ['AV-9340', 'HK-5320', 'MIA', 'BOG', -50, 235, 'E2'],
  ['AV-8118', 'HK-5321', 'BOG', 'MDE', -26, 60, 'B10'],
  ['AV-9344', 'HK-5320', 'BOG', 'MIA', 3, 230, 'C04'],
  ['AV-8120', 'HK-5321', 'BOG', 'MDE', 5, 60, 'B12'],
  ['AV-4021', 'N781AV', 'BOG', 'MAD', 26, 620, 'D02'],
  ['AV-8122', 'HK-5321', 'MDE', 'BOG', 28, 60, '7'],
  ['AV-9120', 'HK-5330', 'BOG', 'CTG', 30, 85, 'B08'],
  ['AV-9345', 'HK-5320', 'MIA', 'BOG', 50, 235, 'E9'],
  ['AV-8124', 'HK-5321', 'BOG', 'CLO', 52, 65, 'B15'],
  ['AV-4022', 'N781AV', 'MAD', 'BOG', 74, 640, 'K40'],
  ['AV-9346', 'HK-5330', 'BOG', 'PTY', 76, 110, 'C10'],
  ['AV-8126', 'HK-5321', 'BOG', 'MDE', 100, 60, 'B12'],
  ['AV-9122', 'HK-5330', 'BOG', 'LIM', 124, 205, 'C02'],
  ['AV-8128', 'HK-5321', 'BOG', 'MDE', 148, 60, 'B11'],
];

// Tripulación ya armada: AV-9344 completa y confirmada (sirve para reportar
// una ausencia en la demo); AV-8120 y AV-4021 a medias (para Programación).
const assignments = [
  ['AV-9340', 'first_officer', 'first_officer', 'valentina.rios'],
  ['AV-9340', 'captain', 'captain', 'laura.perez'],
  ['AV-8118', 'first_officer', 'first_officer', 'valentina.rios'],
  ['AV-8118', 'captain', 'captain', 'diego.salazar'],
  ['AV-9344', 'captain', 'captain', 'laura.perez'],
  ['AV-9344', 'first_officer', 'first_officer', 'valentina.rios'],
  ['AV-9344', 'purser', 'purser', 'natalia.suarez'],
  ['AV-9344', 'fa-1', 'flight_attendant', 'mateo.lopez'],
  ['AV-9344', 'fa-2', 'flight_attendant', 'santiago.ramirez'],
  ['AV-9344', 'fa-3', 'flight_attendant', 'mariana.cruz'],
  ['AV-8120', 'captain', 'captain', 'ricardo.morales'],
  ['AV-8120', 'first_officer', 'first_officer', 'felipe.rojas'],
  ['AV-4021', 'captain', 'captain', 'sofia.herrera'],
];
const confirmedFlights = ['AV-9340', 'AV-8118', 'AV-9344'];

// ---------- Ejecución ----------

async function connect(database) {
  const client = new Client({ ...connection, database });
  await client.connect();
  return client;
}

async function main() {
  if (!connection.password) {
    throw new Error('Falta DB_PASSWORD en services/admin/.env.');
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const userId = (key) => stableId(`user:${key}`);
  const demoUserIds = [supervisor.key, ...crew.map((c) => c[0])].map(userId);
  const flightIds = Object.fromEntries(flights.map((f) => [f[0], stableId(`flight:${f[0]}`)]));

  const admin = await connect('admin_db');
  const crewDb = await connect('crew_db');
  const flightsDb = await connect('flights_db');
  const recommendation = await connect('recommendation_db');

  try {
    // 1. Borrar los datos de demo anteriores (de hijos a padres).
    const { rows: oldAbsences } = await crewDb.query(
      'SELECT id FROM public.absences WHERE crew_user_id = ANY($1::uuid[]) OR flight_id = ANY($2::uuid[])',
      [demoUserIds, Object.values(flightIds)]
    );
    const oldAbsenceIds = oldAbsences.map((row) => row.id);
    await recommendation.query('DELETE FROM public.replacement_suggestions WHERE absence_id = ANY($1::uuid[])', [oldAbsenceIds]);
    await recommendation.query('DELETE FROM public.ai_calls WHERE subject_id = ANY($1::uuid[])', [[...oldAbsenceIds, ...Object.values(flightIds)]]);
    await crewDb.query('DELETE FROM public.absences WHERE id = ANY($1::uuid[])', [oldAbsenceIds]);
    await crewDb.query('DELETE FROM public.crew_members WHERE user_id = ANY($1::uuid[])', [demoUserIds]);
    await flightsDb.query("DELETE FROM public.flight_assignments WHERE flight_id IN (SELECT id FROM public.flights WHERE flight_number LIKE 'AV-%')");
    await flightsDb.query("DELETE FROM public.flights WHERE flight_number LIKE 'AV-%'");
    await admin.query('DELETE FROM public.users WHERE email LIKE $1', [`%${DEMO_DOMAIN}`]);

    // 2. Catálogos.
    for (const [code, icao, name, city, unit, hq] of bases) {
      await admin.query(
        `INSERT INTO public.bases (code, icao, name, city, unit, hq_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET icao = $2, name = $3, city = $4, unit = $5, hq_code = $6`,
        [code, icao, name, city, unit, hq]
      );
    }

    for (const [code, icao, city, name, country, timezone] of airports) {
      await flightsDb.query(
        `INSERT INTO public.airports (code, icao, city, name, country, timezone)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET icao = $2, city = $3, name = $4, country = $5, timezone = $6`,
        [code, icao, city, name, country, timezone]
      );
    }

    const aircraftIds = {};
    for (const [registration, model, family, seats, status] of aircraft) {
      const cabin = Math.ceil(seats / 50);
      const { rows } = await flightsDb.query(
        `INSERT INTO public.aircraft
           (name, registration, capacity, minimum_crew, base, status, maintenance_type, family)
         VALUES ($1, $2, $3, $4, 'BOG', $5, $6, $7)
         ON CONFLICT (registration) DO UPDATE
           SET name = $1, capacity = $3, minimum_crew = $4, status = $5,
               maintenance_type = $6, family = $7
         RETURNING id`,
        [model, registration, seats, 2 + cabin, status,
          status === 'maintenance' ? 'revision_programada' : null, family]
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
          `+5730000${String(index + 10).padStart(4, '0')}`,
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
    console.log(`  ${bases.length} bases, ${airports.length} aeropuertos, ${aircraft.length} aeronaves`);
    console.log(`  1 supervisor y ${crew.length} tripulantes (contraseña: ${DEMO_PASSWORD})`);
    console.log(`  ${flights.length} vuelos (2 ya realizados), ${assignments.length} asignaciones`);
    console.log(`  Supervisor: ${supervisor.key}${DEMO_DOMAIN}`);
  } finally {
    await Promise.all([admin, crewDb, flightsDb, recommendation].map((client) => client.end()));
  }
}

main().catch((error) => {
  console.error(`No se pudieron cargar los datos de demo: ${error.message}`);
  process.exit(1);
});
