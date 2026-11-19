const os = require('os');
const { spawn } = require('child_process');
const { ai } = require('../../../config/env');

// Adaptador de salida hacia Claude Code (`claude -p`, modo no interactivo).
// Usa la suscripción de quien corre el backend: el token de
// `claude setup-token` en CLAUDE_CODE_OAUTH_TOKEN, o la sesión ya iniciada.
// Cumple el mismo contrato que claudeClient.js (API): decide() devuelve el JSON
// que respondió Claude, o lanza un error y el caso de uso lo informa.
//
// Seguridad: Claude Code no recibe acceso a la base de datos ni al proyecto.
// El backend le entrega los datos ya consultados y filtrados por las reglas;
// corre en una carpeta temporal y sin herramientas (--tools "").

const SAFE_MODEL = /^[a-z0-9.-]+$/i;

function isEnabled() {
  return ai.enabled;
}

function buildPrompt({ system, data, schema }) {
  return `${system}

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después y sin
bloques de código, que cumpla este JSON Schema:
${JSON.stringify(schema)}

Datos de la decisión:
${JSON.stringify(data)}`;
}

// Claude puede envolver el JSON en ```json ... ```: se toma del primer { al último }.
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Claude Code no devolvió un JSON.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function runClaudeCode(prompt) {
  const args = [
    '-p',
    '"Responde solo con el JSON pedido en las instrucciones de la entrada estandar."',
    '--output-format',
    'json',
    // Sin herramientas: no puede leer archivos, ejecutar comandos ni navegar.
    '--tools',
    '""',
  ];
  if (ai.model && SAFE_MODEL.test(ai.model)) {
    args.push('--model', ai.model);
  }

  // Sin ANTHROPIC_API_KEY: si estuviera, Claude Code cobraría a la API en vez
  // de usar la suscripción.
  // Sin token, Claude Code usa la sesión iniciada en el equipo (`claude` login).
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) delete env.CLAUDE_CODE_OAUTH_TOKEN;

  return new Promise((resolve, reject) => {
    // shell: en Windows `claude` es un .cmd. Los argumentos son fijos; el
    // contenido variable (el prompt) va por la entrada estándar, nunca en la
    // línea de comandos.
    const child = spawn(ai.claudeCodePath, args, {
      cwd: os.tmpdir(),
      env,
      shell: true,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude Code no respondió en ${ai.timeoutMs / 1000} s.`));
    }, ai.timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`No se pudo ejecutar Claude Code: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude Code terminó con código ${code}: ${(stderr || stdout).trim().slice(0, 300)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(prompt);
  });
}

async function decide({ system, data, schema }) {
  if (!ai.enabled) {
    throw new Error('IA desactivada (AI_ENABLED=false).');
  }

  const started = Date.now();
  const stdout = await runClaudeCode(buildPrompt({ system, data, schema }));

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (error) {
    throw new Error('La salida de Claude Code no es JSON.');
  }

  if (envelope.is_error || (envelope.subtype && envelope.subtype !== 'success')) {
    throw new Error(`Claude Code no terminó bien (${envelope.subtype || 'error'}).`);
  }

  const usage = envelope.usage || {};

  return {
    output: extractJson(String(envelope.result || '')),
    model: ai.model || 'claude-code',
    inputTokens: Number.isInteger(usage.input_tokens) ? usage.input_tokens : null,
    outputTokens: Number.isInteger(usage.output_tokens) ? usage.output_tokens : null,
    durationMs: Date.now() - started,
  };
}

module.exports = { decide, isEnabled, model: ai.model || 'claude-code' };
