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

async function findCrewMembers() {
  const { rows } = await pool.query(
    `SELECT id, user_id, employee_code, position, current_location, status,
            is_active, created_at
     FROM public.crew_members
     ORDER BY employee_code`
  );

  return rows;
}

async function findCrewMemberByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, employee_code, position, current_location, status,
            is_active, created_at
     FROM public.crew_members
     WHERE user_id = $1`,
    [userId]
  );

  return rows[0] || null;
}

module.exports = { createCrewMember, findCrewMembers, findCrewMemberByUserId };