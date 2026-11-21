const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateAircraftInput, parseAircraftListParams } = require('../src/domain/entities/aircraft');
const { markTask, assertCanRelease, openOrder } = require('../src/domain/entities/maintenanceOrder');
const { parseAircraftPhoto } = require('../src/domain/value-objects/aircraftPhoto');
const createManageAircraft = require('../src/application/use-cases/manageAircraft');

const NOW = new Date('2026-11-20T12:00:00Z');
const AIRCRAFT_ID = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function input(overrides = {}) {
  return {
    registration: ' n391dn ',
    msn: '10342',
    model_id: 'a321neo',
    base: 'atl',
    manufacture_year: 2021,
    in_fleet_since: '2021-06-15',
    ...overrides,
  };
}

function rejectsWith(status, message) {
  return (error) => {
    assert.equal(error.status, status);
    if (message) assert.match(error.message, message);
    return true;
  };
}

// ---------------------------------------------------------------- dominio

test('una aeronave nueva toma nombre, capacidad y tripulación de su modelo', () => {
  const aircraft = validateAircraftInput(input(), NOW);

  assert.deepEqual(aircraft, {
    registration: 'N391DN',
    msn: '10342',
    modelId: 'a321neo',
    name: 'Airbus A321neo',
    capacity: 194,
    minimumCrew: 6,
    base: 'ATL',
    manufactureYear: 2021,
    inFleetSince: '2021-06-15',
    status: 'operating',
    maintenanceType: null,
    maintenanceNote: null,
  });
});

test('valida la matrícula FAA, el número de serie, el modelo y la base', () => {
  for (const registration of ['391DN', 'N0123', 'N12345A', 'XA-ABC']) {
    assert.throws(() => validateAircraftInput(input({ registration }), NOW), /registration/, registration);
  }
  for (const msn of ['12', '123456789', '12a4']) {
    assert.throws(() => validateAircraftInput(input({ msn }), NOW), /msn/, msn);
  }
  assert.throws(() => validateAircraftInput(input({ model_id: 'b747' }), NOW), /model_id/);
  assert.throws(() => validateAircraftInput(input({ base: 'BOG' }), NOW), /base/);
});

test('valida el año de fabricación y la llegada a la flota', () => {
  assert.throws(() => validateAircraftInput(input({ manufacture_year: 1979 }), NOW), /manufacture_year/);
  assert.throws(() => validateAircraftInput(input({ manufacture_year: 2027 }), NOW), /manufacture_year/);
  assert.throws(() => validateAircraftInput(input({ manufacture_year: '2021' }), NOW), /manufacture_year/);
  assert.throws(() => validateAircraftInput(input({ in_fleet_since: '2021-02-30' }), NOW), /in_fleet_since/);
  assert.throws(() => validateAircraftInput(input({ in_fleet_since: '2026-11-21' }), NOW), /futura/);
  assert.throws(() => validateAircraftInput(input({ in_fleet_since: '2020-12-31' }), NOW), /anterior al año/);
});

test('en mantenimiento exige el motivo; la nota es opcional y de máximo 300 caracteres', () => {
  assert.throws(() => validateAircraftInput(input({ status: 'maintenance' }), NOW), /maintenance_type/);
  assert.throws(
    () => validateAircraftInput(input({ status: 'maintenance', maintenance_type: 'motor', maintenance_note: 'x'.repeat(301) }), NOW),
    /maintenance_note/
  );

  const aircraft = validateAircraftInput(
    input({ status: 'maintenance', maintenance_type: 'motor', maintenance_note: '  Vibración  ' }),
    NOW
  );
  assert.equal(aircraft.maintenanceType, 'motor');
  assert.equal(aircraft.maintenanceNote, 'Vibración');
});

test('una aeronave operativa no lleva motivo ni nota, y el estado inactive ya no se acepta', () => {
  assert.throws(() => validateAircraftInput(input({ maintenance_type: 'motor' }), NOW), /solo aplican en mantenimiento/);
  assert.throws(() => validateAircraftInput(input({ status: 'inactive' }), NOW), /status/);
});

test('parámetros de la lista', () => {
  assert.deepEqual(parseAircraftListParams({}), { page: 1, pageSize: 10, search: '', status: null });
  assert.throws(() => parseAircraftListParams({ page: '0' }), /page/);
  assert.throws(() => parseAircraftListParams({ status: 'operativa' }), /status/);
});

test('tareas del mantenimiento: índice válido, done booleano y liberar solo con todas hechas', () => {
  const order = { type: 'ala', tasks_done: [true, true, false, false] };

  assert.deepEqual(markTask(order, '2', true), [true, true, true, false]);
  assert.throws(() => markTask(order, 4, true), rejectsWith(404));
  assert.throws(() => markTask(order, 'x', true), rejectsWith(404));
  assert.throws(() => markTask(order, 0, 'si'), rejectsWith(400));
  assert.throws(() => assertCanRelease(order), rejectsWith(409, /Faltan tareas/));
  assertCanRelease({ type: 'ala', tasks_done: [true, true, true, true] });
  assert.deepEqual(openOrder({ type: 'ala', base: 'MSP' }), {
    type: 'ala',
    hangar: 'Hangar 1 · MSP',
    tasksDone: [false, false, false, false],
  });
});

test('la foto sigue las reglas de la foto de perfil', () => {
  const photo = parseAircraftPhoto({ mime_type: 'image/png', data_base64: PNG.toString('base64') });
  assert.equal(photo.sizeBytes, PNG.length);
  assert.throws(() => parseAircraftPhoto({ mime_type: 'image/gif', data_base64: 'AAAA' }), /PNG, JPEG o WEBP/);
  assert.throws(() => parseAircraftPhoto({ mime_type: 'image/jpeg', data_base64: PNG.toString('base64') }), /no coincide/);
});

// ---------------------------------------------------------- caso de uso

// Repositorio en memoria con la misma forma que el de PostgreSQL.
function fakeRepository() {
  const aircraft = new Map();
  const orders = [];
  const photos = new Map();
  let flights = 0;
  let nextOrder = 1;

  const rowOf = (id) => {
    const row = aircraft.get(id);
    return row ? { ...row, photo_updated_at: photos.has(id) ? 'hoy' : null } : null;
  };
  const openOf = (id) => orders.find((order) => order.aircraft_id === id && !order.closed_on) || null;

  const tx = {
    findAircraftById: async (id) => rowOf(id),
    findOpenOrder: async (id) => openOf(id),
    lockAircraft: async (id) => aircraft.has(id),
    async insertAircraft(data) {
      if ([...aircraft.values()].some((row) => row.registration === data.registration)) {
        throw Object.assign(new Error('Ya existe una aeronave con esa matrícula.'), { status: 409 });
      }
      const id = aircraft.size === 0 ? AIRCRAFT_ID : `id-${aircraft.size}`;
      aircraft.set(id, {
        id,
        name: data.name,
        registration: data.registration,
        msn: data.msn,
        model_id: data.modelId,
        base: data.base,
        manufacture_year: data.manufactureYear,
        in_fleet_since: data.inFleetSince,
        flight_hours: 0,
        cycles: 0,
        capacity: data.capacity,
        minimum_crew: data.minimumCrew,
        status: data.status,
        maintenance_type: data.maintenanceType,
        maintenance_note: data.maintenanceNote,
      });
      return id;
    },
    async updateAircraft(id, data) {
      Object.assign(aircraft.get(id), {
        registration: data.registration,
        status: data.status,
        maintenance_type: data.maintenanceType,
        maintenance_note: data.maintenanceNote,
      });
    },
    async setOperating(id) {
      Object.assign(aircraft.get(id), { status: 'operating', maintenance_type: null, maintenance_note: null });
    },
    async insertOrder(id, { type, description, hangar, tasksDone }) {
      orders.push({
        id: `order-${nextOrder}`,
        aircraft_id: id,
        order_number: `OT-2026-000${nextOrder++}`,
        type,
        description,
        hangar,
        tasks_done: tasksDone,
        opened_on: '2026-11-20',
        closed_on: null,
      });
    },
    async updateOrderDescription(orderId, description) {
      orders.find((order) => order.id === orderId).description = description;
    },
    async updateOrderTasks(orderId, tasksDone) {
      orders.find((order) => order.id === orderId).tasks_done = tasksDone;
    },
    async deleteOrder(orderId) {
      orders.splice(orders.findIndex((order) => order.id === orderId), 1);
    },
    async closeOrder(orderId) {
      orders.find((order) => order.id === orderId).closed_on = '2026-11-21';
    },
  };

  return {
    orders,
    setFlights: (count) => {
      flights = count;
    },
    findAllAircraft: async ({ status = null } = {}) =>
      [...aircraft.keys()].map(rowOf).filter((row) => !status || row.status === status),
    findAircraftById: async (id) => rowOf(id),
    findOperatingAircraft: async () => [...aircraft.keys()].map(rowOf).filter((row) => row.status === 'operating'),
    findOpenOrder: async (id) => openOf(id),
    findClosedOrders: async (id) => orders.filter((order) => order.aircraft_id === id && order.closed_on),
    hasFlights: async () => flights > 0,
    inTransaction: (fn) => fn(tx),
    deleteAircraft: async (id) => aircraft.delete(id),
    savePhoto: async (id, photo) => {
      if (!aircraft.has(id)) return null;
      photos.set(id, photo);
      return 'hoy';
    },
    findPhoto: async (id) => (photos.has(id) ? { mime_type: photos.get(id).mimeType, data: photos.get(id).data } : null),
    deletePhoto: async (id) => photos.delete(id),
  };
}

function setup() {
  const aircraftRepository = fakeRepository();
  return { repo: aircraftRepository, manage: createManageAircraft({ aircraftRepository, now: () => NOW }) };
}

test('registrar en mantenimiento abre una orden con las tareas del motivo', async () => {
  const { manage } = setup();

  const created = await manage.createAircraft(input({ status: 'maintenance', maintenance_type: 'motor', maintenance_note: 'Vibración' }));
  assert.equal(created.model_name, 'Airbus A321neo');
  assert.deepEqual(created.minimum_crew, { pilots: 2, cabin: 4 });
  assert.equal(created.base_name, 'Atlanta (ATL)');

  const report = await manage.getAircraftReport(created.id);
  assert.equal(report.maintenance.type, 'motor');
  assert.equal(report.maintenance.description, 'Vibración');
  assert.equal(report.maintenance.hangar, 'Hangar 1 · ATL');
  assert.equal(report.maintenance.tasks.length, 5);
  assert.ok(report.maintenance.tasks.every((task) => task.done === false));
  assert.deepEqual(report.history, []);
});

test('flujo de mantenimiento: marcar tareas, no liberar con pendientes, liberar y pasar al historial', async () => {
  const { manage } = setup();
  const { id } = await manage.createAircraft(input({ status: 'maintenance', maintenance_type: 'ala' }));

  await manage.setMaintenanceTask(id, '0', { done: true });
  await assert.rejects(manage.releaseToService(id), rejectsWith(409, /Faltan tareas/));

  for (const index of [1, 2, 3]) await manage.setMaintenanceTask(id, index, { done: true });
  const released = await manage.releaseToService(id);
  assert.equal(released.status, 'operating');
  assert.equal(released.maintenance_type, null);

  const report = await manage.getAircraftReport(id);
  assert.equal(report.maintenance, null);
  assert.equal(report.history.length, 1);
  assert.equal(report.history[0].closed_on, '2026-11-21');

  await assert.rejects(manage.setMaintenanceTask(id, 0, { done: true }), rejectsWith(409, /no está en mantenimiento/));
  await assert.rejects(manage.releaseToService(id), rejectsWith(409, /no está en mantenimiento/));
});

test('editar: pasar a mantenimiento abre orden; cambiar el motivo la reemplaza; volver a operativa por PUT es 409', async () => {
  const { manage, repo } = setup();
  const { id } = await manage.createAircraft(input());

  await manage.updateAircraft(id, input({ status: 'maintenance', maintenance_type: 'motor' }));
  assert.equal(repo.orders.length, 1);

  await manage.setMaintenanceTask(id, 0, { done: true });
  await manage.updateAircraft(id, input({ status: 'maintenance', maintenance_type: 'electrico', maintenance_note: 'Pantalla' }));
  assert.equal(repo.orders.length, 1);
  assert.equal(repo.orders[0].type, 'electrico');
  assert.ok(repo.orders[0].tasks_done.every((done) => done === false));
  assert.equal(repo.orders[0].description, 'Pantalla');

  await assert.rejects(manage.updateAircraft(id, input()), rejectsWith(409, /Liberar a servicio/));
});

test('lista: búsqueda por matrícula, modelo, serie o base sin tildes, filtro y página', async () => {
  const { manage } = setup();
  await manage.createAircraft(input());
  await manage.createAircraft(input({ registration: 'N12345', msn: '55501', model_id: 'e175', base: 'LAX' }));

  assert.equal((await manage.listAircraft({})).total, 2);
  assert.deepEqual((await manage.listAircraft({ search: 'los angeles' })).items.map((a) => a.registration), ['N12345']);
  assert.deepEqual((await manage.listAircraft({ search: 'embraer' })).items.map((a) => a.registration), ['N12345']);
  assert.deepEqual((await manage.listAircraft({ search: '10342' })).items.map((a) => a.registration), ['N391DN']);
  assert.equal((await manage.listAircraft({ page: '2', page_size: '1' })).items.length, 1);
  assert.equal((await manage.listAircraft({ status: 'maintenance' })).total, 0);
});

test('indicadores: total, operativas, en mantenimiento y asientos', async () => {
  const { manage } = setup();
  await manage.createAircraft(input());
  await manage.createAircraft(input({ registration: 'N12345', model_id: 'e175', status: 'maintenance', maintenance_type: 'motor' }));

  assert.deepEqual(await manage.getAircraftStats(), {
    total: 2,
    operational: 1,
    maintenance: 1,
    total_seats: 194 + 76,
    models_in_service: ['Airbus A321neo'],
  });
  assert.deepEqual((await manage.getOperatingAircraft()).map((a) => a.registration), ['N391DN']);
});

test('eliminar: con vuelos es 409; sin vuelos se borra; inexistente es 404', async () => {
  const { manage, repo } = setup();
  const { id } = await manage.createAircraft(input());

  repo.setFlights(1);
  await assert.rejects(manage.deleteAircraft(id), rejectsWith(409, /vuelos/));
  repo.setFlights(0);
  await manage.deleteAircraft(id);
  await assert.rejects(manage.getAircraftReport(id), rejectsWith(404));
  await assert.rejects(manage.deleteAircraft('no-es-uuid'), rejectsWith(404));
});

test('foto: guardar, leer y borrar; una aeronave inexistente es 404', async () => {
  const { manage } = setup();
  const { id } = await manage.createAircraft(input());
  const body = { mime_type: 'image/png', data_base64: PNG.toString('base64') };

  assert.deepEqual(await manage.savePhoto(id, body), { photo_updated_at: 'hoy' });
  assert.ok((await manage.getPhoto(id)).data.equals(PNG));
  await manage.deletePhoto(id);
  await assert.rejects(manage.getPhoto(id), rejectsWith(404, /no tiene foto/));
  await assert.rejects(manage.savePhoto('22222222-2222-4222-8222-222222222222', body), rejectsWith(404));
});

test('el catálogo trae modelos, bases y motivos con sus tareas', () => {
  const { manage } = setup();
  const options = manage.getAircraftOptions();

  assert.equal(options.models.length, 7);
  assert.equal(options.bases.length, 8);
  assert.equal(options.maintenance_types.find((type) => type.code === 'motor').tasks.length, 5);
});
