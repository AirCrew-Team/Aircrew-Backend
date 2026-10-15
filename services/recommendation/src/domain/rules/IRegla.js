class IRegla {
  constructor(nombre) {
    this.nombre = nombre;
  }

  cumple(/* contexto */) {
    throw new Error('cumple() debe implementarse en cada regla');
  }
}

module.exports = { IRegla };
