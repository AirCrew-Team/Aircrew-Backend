// Los nombres viven en Admin. Este helper los agrega a una lista con una
// sola consulta. `fields` dice qué campo de id produce qué campo de nombre,
// por ejemplo { user_id: 'name' }. Si Admin no responde, los nombres quedan
// en null y la lista sale igual.
function createAttachUserNames(findUsersByIds) {
  return async function attachUserNames(items, fields) {
    const ids = [
      ...new Set(
        items.flatMap((item) => Object.keys(fields).map((key) => item[key])).filter(Boolean)
      ),
    ];
    let users = [];

    if (ids.length > 0) {
      try {
        users = await findUsersByIds(ids);
      } catch (error) {
        console.error(`No se pudieron cargar los nombres desde Admin: ${error.message}`);
      }
    }

    const byId = new Map(users.map((user) => [user.id, user]));

    return items.map((item) => {
      const named = { ...item };

      for (const [idField, nameField] of Object.entries(fields)) {
        const user = byId.get(item[idField]);
        named[nameField] = user ? user.name : null;
      }

      return named;
    });
  };
}

module.exports = createAttachUserNames;
