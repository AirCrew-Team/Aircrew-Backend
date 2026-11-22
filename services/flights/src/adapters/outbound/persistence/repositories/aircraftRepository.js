const pool = require('../pool');

// Aeronave con la fecha de su foto (nunca los bytes). Las fechas de solo día
// salen como texto para que no cambien de día con la zona horaria.
const aircraftColumns = `a.id, a.name, a.registration, a.msn, a.model_id, a.base,
       a.manufacture_year, to_char(a.in_fleet_since, 'YYYY-MM-DD') AS in_fleet_since,
       a.flight_hours, a.cycles, a.capacity, a.minimum_crew, a.status,
       a.maintenance_type, a.maintenance_note, a.created_at, a.updated_at,
       p.updated_at AS photo_updated_at`;

const aircraftFrom = `FROM public.aircraft a
  LEFT JOIN public.aircraft_photos p ON p.aircraft_id = a.id`;

const orderColumns = `id, order_number, type, description, hangar, tasks_done,
       to_char(opened_on, 'YYYY-MM-DD') AS opened_on,
       to_char(closed_on, 'YYYY-MM-DD') AS closed_on`;

function toDuplicateError(cause) {
  if (cause.code === '23505' && cause.constraint === 'aircraft_registration_key') {
    const error = new Error('Ya existe una aeronave con esa matrícula.');
    error.status = 409;
    return error;
  }

  return cause;
}

async function findAllAircraft({ status = null } = {}) {
  const { rows } = await pool.query(
    `SELECT ${aircraftColumns}
     ${aircraftFrom}
     WHERE ($1::text IS NULL OR a.status = $1)
     ORDER BY a.created_at DESC, a.registration`,
    [status]
  );

  return rows;
}

async function findAircraftById(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${aircraftColumns}
     ${aircraftFrom}
     WHERE a.id = $1`,
    [id]
  );

  return rows[0] || null;
}

// Operativas, para programar vuelos.
async function findOperatingAircraft() {
  const { rows } = await pool.query(
    `SELECT ${aircraftColumns}
     ${aircraftFrom}
     WHERE a.status = 'operating'
     ORDER BY a.registration`
  );

  return rows;
}

async function findOpenOrder(aircraftId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${orderColumns}
     FROM public.aircraft_maintenance_orders
     WHERE aircraft_id = $1 AND closed_on IS NULL`,
    [aircraftId]
  );

  return rows[0] || null;
}

// Reparaciones terminadas, la más reciente primero.
async function findClosedOrders(aircraftId) {
  const { rows } = await pool.query(
    `SELECT ${orderColumns}
     FROM public.aircraft_maintenance_orders
     WHERE aircraft_id = $1 AND closed_on IS NOT NULL
     ORDER BY closed_on DESC, created_at DESC`,
    [aircraftId]
  );

  return rows;
}

async function hasFlights(aircraftId) {
  const { rows } = await pool.query(
    'SELECT EXISTS (SELECT 1 FROM public.flights WHERE aircraft_id = $1)',
    [aircraftId]
  );

  return rows[0].exists;
}

// Consultas que solo existen dentro de una transacción, con su cliente.
function transactionRepository(client) {
  return {
    findAircraftById: (id) => findAircraftById(id, client),
    findOpenOrder: (aircraftId) => findOpenOrder(aircraftId, client),

    async lockAircraft(id) {
      const { rows } = await client.query(
        'SELECT id FROM public.aircraft WHERE id = $1 FOR UPDATE',
        [id]
      );
      return rows.length > 0;
    },

    async insertAircraft(aircraft) {
      try {
        const { rows } = await client.query(
          `INSERT INTO public.aircraft
             (name, registration, msn, model_id, base, manufacture_year, in_fleet_since,
              capacity, minimum_crew, status, maintenance_type, maintenance_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            aircraft.name,
            aircraft.registration,
            aircraft.msn,
            aircraft.modelId,
            aircraft.base,
            aircraft.manufactureYear,
            aircraft.inFleetSince,
            aircraft.capacity,
            aircraft.minimumCrew,
            aircraft.status,
            aircraft.maintenanceType,
            aircraft.maintenanceNote,
          ]
        );
        return rows[0].id;
      } catch (cause) {
        throw toDuplicateError(cause);
      }
    },

    async updateAircraft(id, aircraft) {
      try {
        await client.query(
          `UPDATE public.aircraft
           SET name = $2, registration = $3, msn = $4, model_id = $5, base = $6,
               manufacture_year = $7, in_fleet_since = $8, capacity = $9,
               minimum_crew = $10, status = $11, maintenance_type = $12,
               maintenance_note = $13, updated_at = now()
           WHERE id = $1`,
          [
            id,
            aircraft.name,
            aircraft.registration,
            aircraft.msn,
            aircraft.modelId,
            aircraft.base,
            aircraft.manufactureYear,
            aircraft.inFleetSince,
            aircraft.capacity,
            aircraft.minimumCrew,
            aircraft.status,
            aircraft.maintenanceType,
            aircraft.maintenanceNote,
          ]
        );
      } catch (cause) {
        throw toDuplicateError(cause);
      }
    },

    // Vuelve a servicio: sin motivo ni nota.
    async setOperating(id) {
      await client.query(
        `UPDATE public.aircraft
         SET status = 'operating', maintenance_type = NULL, maintenance_note = NULL,
             updated_at = now()
         WHERE id = $1`,
        [id]
      );
    },

    async insertOrder(aircraftId, { type, description, hangar, tasksDone }) {
      await client.query(
        `INSERT INTO public.aircraft_maintenance_orders
           (aircraft_id, type, description, hangar, tasks_done)
         VALUES ($1, $2, $3, $4, $5)`,
        [aircraftId, type, description, hangar, tasksDone]
      );
    },

    async updateOrderDescription(orderId, description) {
      await client.query(
        'UPDATE public.aircraft_maintenance_orders SET description = $2 WHERE id = $1',
        [orderId, description]
      );
    },

    async updateOrderTasks(orderId, tasksDone) {
      await client.query(
        'UPDATE public.aircraft_maintenance_orders SET tasks_done = $2 WHERE id = $1',
        [orderId, tasksDone]
      );
    },

    // Orden descartada porque cambió el motivo: no pasa al historial.
    async deleteOrder(orderId) {
      await client.query('DELETE FROM public.aircraft_maintenance_orders WHERE id = $1', [orderId]);
    },

    async closeOrder(orderId) {
      await client.query(
        'UPDATE public.aircraft_maintenance_orders SET closed_on = CURRENT_DATE WHERE id = $1',
        [orderId]
      );
    },
  };
}

// Transacción: si `fn` falla, no queda nada guardado.
async function inTransaction(fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(transactionRepository(client));
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (error) {
    // Si el ROLLBACK falla, la conexión se descarta y se relanza el error original.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      client.release(rollbackError);
      throw error;
    }
    client.release();
    throw error;
  }
}

// Borra la aeronave; su foto y sus órdenes se borran en cascada.
async function deleteAircraft(id) {
  const { rowCount } = await pool.query('DELETE FROM public.aircraft WHERE id = $1', [id]);
  return rowCount > 0;
}

// --- Foto ---

async function savePhoto(aircraftId, { mimeType, sizeBytes, data }) {
  const { rows } = await pool.query(
    `INSERT INTO public.aircraft_photos (aircraft_id, mime_type, size_bytes, data, updated_at)
     SELECT id, $2::text, $3::integer, $4::bytea, now()
     FROM public.aircraft
     WHERE id = $1
     ON CONFLICT (aircraft_id) DO UPDATE
     SET mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at
     RETURNING updated_at`,
    [aircraftId, mimeType, sizeBytes, data]
  );

  return rows[0] ? rows[0].updated_at : null;
}

async function findPhoto(aircraftId) {
  const { rows } = await pool.query(
    'SELECT mime_type, data FROM public.aircraft_photos WHERE aircraft_id = $1',
    [aircraftId]
  );

  return rows[0] || null;
}

async function deletePhoto(aircraftId) {
  const { rowCount } = await pool.query(
    'DELETE FROM public.aircraft_photos WHERE aircraft_id = $1',
    [aircraftId]
  );

  return rowCount > 0;
}

module.exports = {
  findAllAircraft,
  findAircraftById,
  findOperatingAircraft,
  findOpenOrder,
  findClosedOrders,
  hasFlights,
  inTransaction,
  deleteAircraft,
  savePhoto,
  findPhoto,
  deletePhoto,
};
