const pool = require('../pool');

async function createCrewMember({
  userId,
  employeeCode,
  position,
  currentLocation = null,
  status = 'available',
  isActive = true,
}) {
  const { rows } = await pool.query(
    `INSERT INTO public.crew_members
       (user_id, employee_code, position, current_location, status, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, employee_code, position, current_location, status,
               is_active, created_at`,
    [userId, employeeCode, position, currentLocation, status, isActive]
  );

  return rows[0];
}

module.exports = { createCrewMember };