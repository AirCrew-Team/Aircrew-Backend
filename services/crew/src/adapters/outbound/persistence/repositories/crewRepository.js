const pool = require('../pool');

// Las fechas sin hora salen como texto AAAA-MM-DD: si se dejan como DATE, el
// driver las convierte a medianoche local y en Colombia se correrían un día.
const crewMemberColumns = `id, user_id, employee_code, position, rank, base_code,
       ratings, english_level,
       to_char(medical_expires_on, 'YYYY-MM-DD') AS medical_expires_on,
       to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
       phone, radio_channel, current_location, status, standby_location,
       minutes_to_ramp, standby_until, is_active, created_at`;

async function createCrewMember({
  userId,
  employeeCode,
  position,
  rank,
  baseCode = null,
  ratings = [],
  englishLevel = null,
  medicalExpiresOn = null,
  hireDate = null,
  phone = null,
  currentLocation = null,
  status = 'available',
  isActive = true,
}) {
  const { rows } = await pool.query(
    `INSERT INTO public.crew_members
       (user_id, employee_code, position, rank, base_code, ratings, english_level,
        medical_expires_on, hire_date, phone, current_location, status, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${crewMemberColumns}`,
    [
      userId,
      employeeCode,
      position,
      rank,
      baseCode,
      ratings,
      englishLevel,
      medicalExpiresOn,
      hireDate,
      phone,
      currentLocation,
      status,
      isActive,
    ]
  );

  return rows[0];
}

async function findCrewMembers() {
  const { rows } = await pool.query(
    `SELECT ${crewMemberColumns}
     FROM public.crew_members
     ORDER BY employee_code`
  );

  return rows;
}

async function findCrewMemberByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT ${crewMemberColumns}
     FROM public.crew_members
     WHERE user_id = $1`,
    [userId]
  );

  return rows[0] || null;
}

module.exports = { createCrewMember, findCrewMembers, findCrewMemberByUserId };
