const pool = require('../pool');

const suggestionColumns = `id, absence_id, crew_user_id, rank_position, affinity,
       checks, rationale, source, status, round, created_at`;

// Guarda una ronda nueva de candidatos y descarta los que seguían propuestos
// de rondas anteriores. Todo en una transacción.
async function saveRound(absenceId, suggestions) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: last } = await client.query(
      'SELECT COALESCE(MAX(round), 0) AS round FROM public.replacement_suggestions WHERE absence_id = $1',
      [absenceId]
    );
    const round = Number(last[0].round) + 1;

    await client.query(
      `UPDATE public.replacement_suggestions SET status = 'discarded'
       WHERE absence_id = $1 AND status = 'proposed'`,
      [absenceId]
    );

    const saved = [];
    for (const item of suggestions) {
      const { rows } = await client.query(
        `INSERT INTO public.replacement_suggestions
           (absence_id, crew_user_id, rank_position, affinity, checks, rationale, source, round)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${suggestionColumns}`,
        [
          absenceId,
          item.crewUserId,
          item.rankPosition,
          item.affinity,
          JSON.stringify(item.checks),
          item.rationale,
          item.source,
          round,
        ]
      );
      saved.push(rows[0]);
    }

    await client.query('COMMIT');
    return { round, suggestions: saved };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Candidatos de la última ronda, en orden.
async function findLatestRound(absenceId) {
  const { rows } = await pool.query(
    `SELECT ${suggestionColumns}
     FROM public.replacement_suggestions
     WHERE absence_id = $1
       AND round = (SELECT MAX(round) FROM public.replacement_suggestions WHERE absence_id = $1)
     ORDER BY rank_position`,
    [absenceId]
  );

  return rows;
}

module.exports = { saveRound, findLatestRound };
