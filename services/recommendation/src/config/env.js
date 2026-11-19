const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const aiProvider = process.env.AI_PROVIDER === 'claude_code' ? 'claude_code' : 'api';

module.exports = {
  nameService: 'recommendation',
  port: Number(process.env.PORT) || 3003,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER || 'aircrew-admin',
  adminServiceUrl: process.env.ADMIN_SERVICE_URL || 'http://localhost:3005',
  crewServiceUrl: process.env.CREW_SERVICE_URL || 'http://localhost:3002',
  // Cada cuánto se revisan los plazos de «Enterado» vencidos (ms).
  deadlineCheckMs: Number(process.env.DEADLINE_CHECK_MS) || 60000,
  flightsServiceUrl:
    process.env.FLIGHTS_SERVICE_URL || 'http://localhost:3001',
  notificationServiceUrl:
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004',
  DataBase: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'recommendation_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  },
  // IA (Claude). Dos proveedores, con el mismo contrato:
  // - claude_code: ejecuta Claude Code (`claude -p`) con la suscripción de quien
  //   corre el backend (token de `claude setup-token` en CLAUDE_CODE_OAUTH_TOKEN).
  // - api: usa la API de Anthropic con ANTHROPIC_API_KEY (saldo de la API).
  // Si la IA está apagada (AI_ENABLED=false) o falla, las recomendaciones y
  // sugerencias responden error (no hay orden de respaldo).
  ai: {
    provider: aiProvider,
    enabled:
      process.env.AI_ENABLED !== 'false' &&
      (aiProvider === 'claude_code' || Boolean(process.env.ANTHROPIC_API_KEY)),
    model: process.env.CLAUDE_MODEL || (aiProvider === 'api' ? 'claude-opus-5-5' : null),
    // Claude Code tarda más: arranca un proceso nuevo en cada llamada.
    timeoutMs:
      Number(process.env.AI_TIMEOUT_MS) || (aiProvider === 'claude_code' ? 90000 : 20000),
    claudeCodePath: process.env.CLAUDE_CODE_PATH || 'claude',
  },
};
