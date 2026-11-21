// Catálogos de la flota: modelos, bases y motivos de mantenimiento con sus tareas.
// Son la única fuente: el frontend los pide con GET /aircraft/options.

// narrow_body: un pasillo · wide_body: dos pasillos · regional: menos de 100 asientos.
const AIRCRAFT_MODELS = Object.freeze([
  {
    id: 'a321neo',
    name: 'Airbus A321neo',
    category: 'narrow_body',
    capacity: 194,
    minimum_crew: { pilots: 2, cabin: 4 },
    engines: '2 × Pratt & Whitney PW1100G',
  },
  {
    id: 'b739',
    name: 'Boeing 737-900ER',
    category: 'narrow_body',
    capacity: 180,
    minimum_crew: { pilots: 2, cabin: 4 },
    engines: '2 × CFM International CFM56-7B',
  },
  {
    id: 'a220',
    name: 'Airbus A220-300',
    category: 'narrow_body',
    capacity: 130,
    minimum_crew: { pilots: 2, cabin: 3 },
    engines: '2 × Pratt & Whitney PW1500G',
  },
  {
    id: 'a330neo',
    name: 'Airbus A330-900neo',
    category: 'wide_body',
    capacity: 281,
    minimum_crew: { pilots: 2, cabin: 8 },
    engines: '2 × Rolls-Royce Trent 7000',
  },
  {
    id: 'a350',
    name: 'Airbus A350-900',
    category: 'wide_body',
    capacity: 306,
    minimum_crew: { pilots: 2, cabin: 9 },
    engines: '2 × Rolls-Royce Trent XWB',
  },
  {
    id: 'b764',
    name: 'Boeing 767-400ER',
    category: 'wide_body',
    capacity: 238,
    minimum_crew: { pilots: 2, cabin: 7 },
    engines: '2 × General Electric CF6-80C2',
  },
  {
    id: 'e175',
    name: 'Embraer E175',
    category: 'regional',
    capacity: 76,
    minimum_crew: { pilots: 2, cabin: 2 },
    engines: '2 × General Electric CF34-8E',
  },
]);

// Bases de Delta en EE. UU.
const AIRCRAFT_BASES = Object.freeze([
  { code: 'ATL', name: 'Atlanta (ATL)' },
  { code: 'BOS', name: 'Boston (BOS)' },
  { code: 'DTW', name: 'Detroit (DTW)' },
  { code: 'LAX', name: 'Los Ángeles (LAX)' },
  { code: 'MSP', name: 'Minneapolis (MSP)' },
  { code: 'JFK', name: 'Nueva York (JFK)' },
  { code: 'SLC', name: 'Salt Lake City (SLC)' },
  { code: 'SEA', name: 'Seattle (SEA)' },
]);

// Motivos de mantenimiento y sus tareas, en el orden en que se hacen.
const MAINTENANCE_TYPES = Object.freeze([
  {
    code: 'motor',
    label: 'Problemas con el motor',
    tasks: [
      'Inspección visual del motor y sus soportes',
      'Revisión interna con cámara (boroscopio)',
      'Cambio de las piezas dañadas',
      'Prueba del motor en tierra',
      'Vuelo de prueba y liberación a servicio',
    ],
  },
  {
    code: 'ala',
    label: 'Daño en el ala',
    tasks: [
      'Evaluación del daño en el ala',
      'Reparación de la estructura',
      'Pintura y sellado',
      'Prueba de flaps y alerones',
    ],
  },
  {
    code: 'tren_aterrizaje',
    label: 'Tren de aterrizaje',
    tasks: [
      'Inspección del tren de aterrizaje',
      'Cambio de llantas y frenos',
      'Lubricación y ajuste',
      'Prueba de subida y bajada del tren',
    ],
  },
  {
    code: 'fuselaje',
    label: 'Daño en el fuselaje',
    tasks: [
      'Evaluación del daño en el fuselaje',
      'Reparación de la estructura',
      'Prueba de presurización de la cabina',
      'Pintura y liberación a servicio',
    ],
  },
  {
    code: 'electrico',
    label: 'Falla eléctrica',
    tasks: [
      'Diagnóstico del sistema eléctrico',
      'Cambio de cableado o componentes',
      'Prueba de instrumentos de cabina',
      'Liberación a servicio',
    ],
  },
  {
    code: 'hidraulico',
    label: 'Falla hidráulica',
    tasks: [
      'Detección de la fuga o la falla',
      'Cambio de mangueras o bombas',
      'Recarga del líquido hidráulico',
      'Prueba de los mandos del avión',
    ],
  },
  {
    code: 'revision_programada',
    label: 'Revisión programada',
    tasks: [
      'Inspección general del avión',
      'Revisión de motores',
      'Revisión de equipos de emergencia',
      'Pruebas finales y liberación a servicio',
    ],
  },
]);

function findModel(id) {
  return AIRCRAFT_MODELS.find((model) => model.id === id) || null;
}

function findBase(code) {
  return AIRCRAFT_BASES.find((base) => base.code === code) || null;
}

function findMaintenanceType(code) {
  return MAINTENANCE_TYPES.find((type) => type.code === code) || null;
}

module.exports = {
  AIRCRAFT_MODELS,
  AIRCRAFT_BASES,
  MAINTENANCE_TYPES,
  findModel,
  findBase,
  findMaintenanceType,
};
