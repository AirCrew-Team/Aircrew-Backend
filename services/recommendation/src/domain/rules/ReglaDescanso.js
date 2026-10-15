const { IRegla } = require('./IRegla');

class ReglaDescanso extends IRegla {
  constructor() {
    super('descanso');
  }

  cumple(/* contexto */) {
    // TODO: verificar horas de descanso mínimo
  }
}

module.exports = { ReglaDescanso };
