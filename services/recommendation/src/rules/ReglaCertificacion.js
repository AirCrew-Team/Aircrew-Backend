const { IRegla } = require('./IRegla');

class ReglaCertificacion extends IRegla {
  constructor() {
    super('certificacion');
  }

  cumple(/* contexto */) {
    // TODO: verificar certificaciones vigentes del tripulante
  }
}

module.exports = { ReglaCertificacion };
