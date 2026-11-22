const { ai } = require('../../../config/env');

// Elige el adaptador de IA según AI_PROVIDER. Los dos cumplen el mismo
// contrato { decide, isEnabled, model }, así que los casos de uso no saben
// cuál se está usando: cambiar de proveedor no toca la lógica del negocio.
module.exports =
  ai.provider === 'claude_code' ? require('./claudeCodeClient') : require('./claudeClient');
