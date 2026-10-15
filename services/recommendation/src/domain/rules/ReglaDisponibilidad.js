const { IRegla } = require('./IRegla');

class ReglaDisponibilidad extends IRegla {
  constructor() {
    super('disponibilidad');
  }

  cumple(/* contexto */) {
    // TODO: verificar que el tripulante no tenga otra asignación en el intervalo
  }
}

module.exports = { ReglaDisponibilidad };
