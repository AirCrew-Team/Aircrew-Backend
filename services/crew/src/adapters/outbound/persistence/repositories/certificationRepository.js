const pool = require('../pool');

// Tripulante con su certificación (si tiene) y los metadatos de su copia.
// Nunca trae los bytes del archivo.
const crewWithCertification = `
  SELECT cm.user_id, cm.employee_code, cm.position, cm.base, cm.is_active,
         c.license_number, c.certificates, c.status,
         c.created_at AS certified_at, c.updated_at,
         CASE WHEN f.crew_user_id IS NULL THEN NULL
              ELSE json_build_object(
                'file_name', f.file_name,
                'mime_type', f.mime_type,
                'size_bytes', f.size_bytes
              )
         END AS file
  FROM public.crew_members cm
  LEFT JOIN public.crew_certifications c ON c.crew_user_id = cm.user_id
  LEFT JOIN public.crew_certification_files f ON f.crew_user_id = cm.user_id`;

// Separa la fila en el tripulante y su certificación (null si no tiene).
function toRecord(row) {
  return {
    member: {
      user_id: row.user_id,
      employee_code: row.employee_code,
      position: row.position,
      base: row.base,
      is_active: row.is_active,
    },
    certification: row.license_number
      ? {
          license_number: row.license_number,
          certificates: row.certificates,
          status: row.status,
          created_at: row.certified_at,
          updated_at: row.updated_at,
          file: row.file,
        }
      : null,
  };
}

// Tripulantes activos con su certificación. Se filtra y pagina en el caso de uso
// porque el nombre y el correo viven en Admin.
async function findActiveCrewCertifications() {
  const { rows } = await pool.query(
    `${crewWithCertification}
     WHERE cm.is_active = true
     ORDER BY cm.employee_code`
  );

  return rows.map(toRecord);
}

async function findCrewCertification(crewUserId) {
  const { rows } = await pool.query(
    `${crewWithCertification}
     WHERE cm.user_id = $1`,
    [crewUserId]
  );

  return rows[0] ? toRecord(rows[0]) : null;
}

// Historial, del más reciente al más antiguo.
async function findHistory(crewUserId) {
  const { rows } = await pool.query(
    `SELECT event, actor_user_id, note, created_at
     FROM public.crew_certification_events
     WHERE crew_user_id = $1
     ORDER BY created_at DESC`,
    [crewUserId]
  );

  return rows;
}

// Copia con sus bytes, solo para la descarga.
async function findFile(crewUserId) {
  const { rows } = await pool.query(
    `SELECT file_name, mime_type, data
     FROM public.crew_certification_files
     WHERE crew_user_id = $1`,
    [crewUserId]
  );

  return rows[0] || null;
}

// Consultas que solo existen dentro de withCertificationLock, con su cliente.
function transactionRepository(client) {
  return {
    async findCertification(crewUserId) {
      const { rows } = await client.query(
        `SELECT license_number, certificates, status
         FROM public.crew_certifications
         WHERE crew_user_id = $1`,
        [crewUserId]
      );

      return rows[0] || null;
    },

    async upsertCertification({ crewUserId, licenseNumber, certificates, status }) {
      await client.query(
        `INSERT INTO public.crew_certifications
           (crew_user_id, license_number, certificates, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (crew_user_id) DO UPDATE
           SET license_number = EXCLUDED.license_number,
               certificates = EXCLUDED.certificates,
               status = EXCLUDED.status,
               updated_at = now()`,
        [crewUserId, licenseNumber, certificates, status]
      );
    },

    async replaceFile({ crewUserId, fileName, mimeType, sizeBytes, data }) {
      await client.query(
        `INSERT INTO public.crew_certification_files
           (crew_user_id, file_name, mime_type, size_bytes, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (crew_user_id) DO UPDATE
           SET file_name = EXCLUDED.file_name,
               mime_type = EXCLUDED.mime_type,
               size_bytes = EXCLUDED.size_bytes,
               data = EXCLUDED.data,
               created_at = now()`,
        [crewUserId, fileName, mimeType, sizeBytes, data]
      );
    },

    async deleteFile(crewUserId) {
      await client.query(
        'DELETE FROM public.crew_certification_files WHERE crew_user_id = $1',
        [crewUserId]
      );
    },

    // En orden: clock_timestamp() les da horas distintas dentro de la transacción.
    async insertEvents(crewUserId, actorUserId, events) {
      for (const { event, note } of events) {
        await client.query(
          `INSERT INTO public.crew_certification_events
             (crew_user_id, event, actor_user_id, note)
           VALUES ($1, $2, $3, $4)`,
          [crewUserId, event, actorUserId, note]
        );
      }
    },
  };
}

// Transacción con la certificación del tripulante bloqueada hasta el COMMIT: dos
// guardados simultáneos van en fila. Si `fn` falla, no queda nada guardado.
async function withCertificationLock(crewUserId, fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `certification:${crewUserId}`,
    ]);
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

// La copia y el historial se borran en cascada. Devuelve si había certificación.
async function deleteCertification(crewUserId) {
  const { rowCount } = await pool.query(
    'DELETE FROM public.crew_certifications WHERE crew_user_id = $1',
    [crewUserId]
  );

  return rowCount > 0;
}

module.exports = {
  findActiveCrewCertifications,
  findCrewCertification,
  findHistory,
  findFile,
  withCertificationLock,
  deleteCertification,
};
