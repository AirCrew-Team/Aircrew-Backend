const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../../config/env');

// Adaptador de salida hacia Claude Code (`claude -p`, modo no interactivo).
// Usa la suscripción de quien corre el backend: el token de suscripción de
// Claude Code en CLAUDE_CODE_OAUTH_TOKEN. Sin el token la IA queda apagada y
// decide() responde el motivo sin lanzar la CLI.
// Cumple el mismo contrato que claudeClient.js (API): decide() devuelve el JSON
// que respondió Claude, o lanza un error y el caso de uso lo informa.
//
// Seguridad: Claude Code no recibe acceso a la base de datos ni al proyecto.
// El backend le entrega los datos ya consultados y filtrados por las reglas;
// corre en una carpeta temporal, sin herramientas (--tools "") y con un
// entorno mínimo: ningún secreto del backend llega al proceso.

const SAFE_MODEL = /^[a-z0-9.-]+$/i;
const PROMPT_ARG = 'Responde solo con el JSON pedido en las instrucciones de la entrada estandar.';
const PACKAGE_JSON = '@anthropic-ai/claude-code/package.json';

// Por defecto, el binario del paquete @anthropic-ai/claude-code instalado con
// el servicio (ruta absoluta, no depende del PATH). Si no está instalado,
// `claude` del PATH. CLAUDE_CODE_PATH lo sobrescribe.
function resolveClaudeCodePath({ configured, resolvePackage = require.resolve }) {
  if (configured) return configured;
  try {
    const packageJson = resolvePackage(PACKAGE_JSON);
    const { bin } = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    return path.join(path.dirname(packageJson), typeof bin === 'string' ? bin : bin.claude);
  } catch {
    return 'claude';
  }
}

function isWritableDir(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// Solo lo que la CLI necesita: PATH, la carpeta personal (guarda ahí su
// configuración, así que debe poder escribirse), la carpeta temporal y el token.
// Nunca JWT_SECRET, DB_PASSWORD, claves de servicio ni ANTHROPIC_API_KEY (con
// ella Claude Code cobraría a la API en vez de usar la suscripción).
function buildChildEnv({ env = process.env, platform = process.platform, tmpdir = os.tmpdir() } = {}) {
  const isWindows = platform === 'win32';
  let home = isWindows ? env.USERPROFILE || env.HOME : env.HOME;
  if (!home || !isWritableDir(home)) {
    home = path.join(tmpdir, 'aircrew-claude-home');
    fs.mkdirSync(home, { recursive: true });
  }

  const child = { PATH: env.PATH, HOME: home };
  if (isWindows) child.USERPROFILE = home;
  for (const name of isWindows ? ['TEMP', 'TMP'] : ['TMPDIR']) {
    if (env[name]) child[name] = env[name];
  }
  if (env.CLAUDE_CODE_OAUTH_TOKEN) child.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  return child;
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

// Con error, la CLI suele dejar su respuesta JSON en stdout (p. ej. «Failed to
// authenticate»): se informa ese texto en vez del JSON completo.
function failureText(stdout, stderr) {
  try {
    const { result } = JSON.parse(stdout);
    if (typeof result === 'string' && result.trim()) return result.trim();
  } catch {
    // stdout no es JSON: se informa tal cual.
  }
  return (stderr || stdout).trim();
}

function createClaudeCodeClient({
  ai,
  spawnImpl = spawn,
  env = process.env,
  platform = process.platform,
  tmpdir = os.tmpdir(),
}) {
  const command = resolveClaudeCodePath({ configured: ai.claudeCodePath });
  // El .exe del paquete (en Linux también se llama claude.exe) se ejecuta sin
  // shell y con argumentos literales. Solo en Windows, un `claude` del PATH o
  // un .cmd necesitan shell, y ahí el comando y los argumentos van entre comillas.
  const useShell = platform === 'win32' && !/\.exe$/i.test(command);
  const quote = (value) => (useShell && /[\s"]|^$/.test(value) ? `"${value}"` : value);

  function runClaudeCode(prompt) {
    const args = [
      '-p',
      PROMPT_ARG,
      '--output-format',
      'json',
      // Sin herramientas: no puede leer archivos, ejecutar comandos ni navegar.
      '--tools',
      '',
    ];
    if (ai.model && SAFE_MODEL.test(ai.model)) {
      args.push('--model', ai.model);
    }

    return new Promise((resolve, reject) => {
      // Los argumentos son fijos; el contenido variable (el prompt) va por la
      // entrada estándar, nunca en la línea de comandos.
      const child = spawnImpl(quote(command), args.map(quote), {
        cwd: tmpdir,
        env: buildChildEnv({ env, platform, tmpdir }),
        shell: useShell,
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
          reject(new Error(`Claude Code terminó con código ${code}: ${failureText(stdout, stderr).slice(0, 300)}`));
          return;
        }
        resolve(stdout);
      });

      child.stdin.end(prompt);
    });
  }

  async function decide({ system, data, schema }) {
    if (!ai.enabled) {
      throw new Error(ai.disabledReason);
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

  return {
    decide,
    isEnabled: () => ai.enabled,
    disabledReason: ai.disabledReason,
    model: ai.model || 'claude-code',
  };
}

module.exports = {
  ...createClaudeCodeClient({ ai: config.ai }),
  createClaudeCodeClient,
  resolveClaudeCodePath,
  buildChildEnv,
};
