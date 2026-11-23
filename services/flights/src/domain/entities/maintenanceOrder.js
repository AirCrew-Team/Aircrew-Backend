const { DomainError } = require('../errors');
const { findMaintenanceType } = require('../aircraftCatalog');

// Orden de taller de una aeronave en mantenimiento. Sus tareas salen del motivo;
// la aeronave vuelve a servicio solo cuando todas están hechas.

function tasksFor(type) {
  const maintenanceType = findMaintenanceType(type);
  return maintenanceType ? maintenanceType.tasks : [];
}

// Orden nueva: ninguna tarea hecha. El hangar es el de su base.
function openOrder({ type, base }) {
  return {
    type,
    hangar: `Hangar 1 · ${base}`,
    tasksDone: tasksFor(type).map(() => false),
  };
}

// Orden en curso como la ve el informe.
function toMaintenanceRecord(order, description) {
  return {
    order_number: order.order_number,
    type: order.type,
    description: description ?? null,
    hangar: order.hangar,
    opened_on: order.opened_on,
    tasks: tasksFor(order.type).map((name, index) => ({
      name,
      done: Boolean(order.tasks_done[index]),
    })),
  };
}

// Valida el cambio de una tarea y devuelve la lista nueva de tareas hechas.
function markTask(order, index, done) {
  const position = Number(index);
  const tasks = tasksFor(order.type);

  if (!Number.isInteger(position) || position < 0 || position >= tasks.length) {
    throw new DomainError(`La tarea debe ser un número de 0 a ${tasks.length - 1}.`, 404);
  }

  if (typeof done !== 'boolean') {
    throw new DomainError('done debe ser true o false.');
  }

  const tasksDone = tasks.map((_, i) => Boolean(order.tasks_done[i]));
  tasksDone[position] = done;
  return tasksDone;
}

function assertCanRelease(order) {
  const tasks = tasksFor(order.type);

  if (!tasks.every((_, index) => order.tasks_done[index] === true)) {
    throw new DomainError('Faltan tareas por completar antes de liberar la aeronave.', 409);
  }
}

module.exports = { tasksFor, openOrder, toMaintenanceRecord, markTask, assertCanRelease };
