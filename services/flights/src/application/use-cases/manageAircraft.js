const {
  AIRCRAFT_MODELS,
  AIRCRAFT_BASES,
  MAINTENANCE_TYPES,
  findModel,
  findBase,
} = require('../../domain/aircraftCatalog');
const {
  isValidAircraftId,
  validateAircraftInput,
  parseAircraftListParams,
  matchesSearch,
} = require('../../domain/entities/aircraft');
const {
  openOrder,
  toMaintenanceRecord,
  markTask,
  assertCanRelease,
} = require('../../domain/entities/maintenanceOrder');
const { parseAircraftPhoto } = require('../../domain/value-objects/aircraftPhoto');
const { DomainError } = require('../../domain/errors');

function notFound() {
  return new DomainError('Aeronave no encontrada.', 404);
}

function notInMaintenance() {
  return new DomainError('La aeronave no está en mantenimiento.', 409);
}

// Aeronave como la ve la pantalla: con los datos de su modelo y su base. Las
// filas antiguas sin modelo usan el nombre y la capacidad que tenían guardados.
function toAircraftItem(row) {
  const model = findModel(row.model_id);
  const base = findBase(row.base);

  return {
    id: row.id,
    registration: row.registration,
    msn: row.msn,
    model_id: row.model_id,
    model_name: model ? model.name : row.name,
    category: model ? model.category : null,
    capacity: model ? model.capacity : row.capacity,
    minimum_crew: model ? { ...model.minimum_crew } : null,
    engines: model ? model.engines : null,
    base: row.base,
    base_name: base ? base.name : null,
    manufacture_year: row.manufacture_year,
    in_fleet_since: row.in_fleet_since,
    flight_hours: row.flight_hours,
    cycles: row.cycles,
    status: row.status,
    maintenance_type: row.maintenance_type,
    maintenance_note: row.maintenance_note,
    photo_updated_at: row.photo_updated_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toHistoryEntry(order) {
  return {
    order_number: order.order_number,
    type: order.type,
    description: order.description,
    hangar: order.hangar,
    opened_on: order.opened_on,
    closed_on: order.closed_on,
  };
}

// Flota del super_admin: registrar, editar, eliminar, mantenimiento y foto.
function createManageAircraft({ aircraftRepository, now = () => new Date() }) {
  async function findExisting(id) {
    const row = isValidAircraftId(id) ? await aircraftRepository.findAircraftById(id) : null;

    if (!row) {
      throw notFound();
    }

    return row;
  }

  // Bloquea la aeronave dentro de la transacción y la lee.
  async function lockExisting(tx, id) {
    if (!isValidAircraftId(id) || !(await tx.lockAircraft(id))) {
      throw notFound();
    }

    return tx.findAircraftById(id);
  }

  function newOrder(aircraft) {
    const order = openOrder({ type: aircraft.maintenanceType, base: aircraft.base });
    return { ...order, description: aircraft.maintenanceNote };
  }

  async function listAircraft(query) {
    const { page, pageSize, search, status } = parseAircraftListParams(query);
    const rows = await aircraftRepository.findAllAircraft({ status });
    const matches = rows.map(toAircraftItem).filter((item) => matchesSearch(item, search));
    const start = (page - 1) * pageSize;

    return {
      items: matches.slice(start, start + pageSize),
      page,
      page_size: pageSize,
      total: matches.length,
    };
  }

  // Indicadores: total, operativas, en mantenimiento, asientos de toda la flota y
  // los modelos en línea (de las operativas), para la tarjeta de flota del inicio.
  async function getAircraftStats() {
    const items = (await aircraftRepository.findAllAircraft()).map(toAircraftItem);
    const operating = items.filter((item) => item.status === 'operating');

    return {
      total: items.length,
      operational: operating.length,
      maintenance: items.filter((item) => item.status === 'maintenance').length,
      total_seats: items.reduce((sum, item) => sum + (item.capacity || 0), 0),
      models_in_service: [...new Set(operating.map((item) => item.model_name))].sort(),
    };
  }

  function getAircraftOptions() {
    return {
      models: AIRCRAFT_MODELS,
      bases: AIRCRAFT_BASES,
      maintenance_types: MAINTENANCE_TYPES,
    };
  }

  async function getOperatingAircraft() {
    return (await aircraftRepository.findOperatingAircraft()).map(toAircraftItem);
  }

  // Toda la flota, sin paginar, para el manifiesto.
  async function getFleetManifest() {
    return (await aircraftRepository.findAllAircraft()).map(toAircraftItem);
  }

  // Si se registra en mantenimiento, se abre su orden de taller.
  async function createAircraft(input) {
    const aircraft = validateAircraftInput(input, now());

    const row = await aircraftRepository.inTransaction(async (tx) => {
      const id = await tx.insertAircraft(aircraft);

      if (aircraft.status === 'maintenance') {
        await tx.insertOrder(id, newOrder(aircraft));
      }

      return tx.findAircraftById(id);
    });

    return toAircraftItem(row);
  }

  // PUT: se envían todos los datos. Pasar a mantenimiento abre una orden; cambiar
  // el motivo abre otra sin tareas hechas. Volver a servicio solo se hace con
  // «Liberar a servicio», cuando todas las tareas están hechas.
  async function updateAircraft(id, input) {
    const aircraft = validateAircraftInput(input, now());

    const row = await aircraftRepository.inTransaction(async (tx) => {
      const current = await lockExisting(tx, id);
      const order = await tx.findOpenOrder(current.id);

      if (current.status === 'maintenance' && aircraft.status === 'operating') {
        throw new DomainError(
          'La aeronave está en mantenimiento: completa las tareas y usa «Liberar a servicio».',
          409
        );
      }

      if (aircraft.status === 'maintenance') {
        if (order && order.type !== aircraft.maintenanceType) {
          await tx.deleteOrder(order.id);
          await tx.insertOrder(current.id, newOrder(aircraft));
        } else if (order) {
          await tx.updateOrderDescription(order.id, aircraft.maintenanceNote);
        } else {
          await tx.insertOrder(current.id, newOrder(aircraft));
        }
      }

      await tx.updateAircraft(current.id, aircraft);
      return tx.findAircraftById(current.id);
    });

    return toAircraftItem(row);
  }

  // Una aeronave con vuelos no se borra: sus vuelos la referencian.
  async function deleteAircraft(id) {
    const row = await findExisting(id);

    if (await aircraftRepository.hasFlights(row.id)) {
      throw new DomainError('La aeronave tiene vuelos registrados: no se puede eliminar.', 409);
    }

    await aircraftRepository.deleteAircraft(row.id);
  }

  // Informe: datos, mantenimiento en curso (si está en hangar) e historial.
  async function getAircraftReport(id) {
    const row = await findExisting(id);
    const order =
      row.status === 'maintenance' ? await aircraftRepository.findOpenOrder(row.id) : null;
    const history = await aircraftRepository.findClosedOrders(row.id);

    return {
      aircraft: toAircraftItem(row),
      maintenance: order ? toMaintenanceRecord(order, row.maintenance_note) : null,
      history: history.map(toHistoryEntry),
    };
  }

  async function setMaintenanceTask(id, taskIndex, input) {
    const { done } = input || {};

    return aircraftRepository.inTransaction(async (tx) => {
      const row = await lockExisting(tx, id);
      const order = row.status === 'maintenance' ? await tx.findOpenOrder(row.id) : null;

      if (!order) {
        throw notInMaintenance();
      }

      const tasksDone = markTask(order, taskIndex, done);
      await tx.updateOrderTasks(order.id, tasksDone);
      return toMaintenanceRecord({ ...order, tasks_done: tasksDone }, row.maintenance_note);
    });
  }

  // Solo con todas las tareas hechas. La orden pasa al historial.
  async function releaseToService(id) {
    const row = await aircraftRepository.inTransaction(async (tx) => {
      const current = await lockExisting(tx, id);
      const order = current.status === 'maintenance' ? await tx.findOpenOrder(current.id) : null;

      if (!order) {
        throw notInMaintenance();
      }

      assertCanRelease(order);
      await tx.closeOrder(order.id);
      await tx.setOperating(current.id);
      return tx.findAircraftById(current.id);
    });

    return toAircraftItem(row);
  }

  async function savePhoto(id, input) {
    const photo = parseAircraftPhoto(input);
    const updatedAt = isValidAircraftId(id) ? await aircraftRepository.savePhoto(id, photo) : null;

    if (!updatedAt) {
      throw notFound();
    }

    return { photo_updated_at: updatedAt };
  }

  async function getPhoto(id) {
    const row = await findExisting(id);
    const photo = await aircraftRepository.findPhoto(row.id);

    if (!photo) {
      throw new DomainError('La aeronave no tiene foto.', 404);
    }

    return photo;
  }

  async function deletePhoto(id) {
    const row = await findExisting(id);
    await aircraftRepository.deletePhoto(row.id);
  }

  return {
    listAircraft,
    getAircraftStats,
    getAircraftOptions,
    getOperatingAircraft,
    getFleetManifest,
    createAircraft,
    updateAircraft,
    deleteAircraft,
    getAircraftReport,
    setMaintenanceTask,
    releaseToService,
    savePhoto,
    getPhoto,
    deletePhoto,
  };
}

module.exports = createManageAircraft;
module.exports.toAircraftItem = toAircraftItem;
