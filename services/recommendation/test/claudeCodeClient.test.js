const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const {
  createClaudeCodeClient,
  resolveClaudeCodePath,
  buildChildEnv,
} = require('../src/adapters/outbound/ai/claudeCodeClient');

// Sin ejecutar Claude Code de verdad: el spawn es falso y el entorno se pasa
// explícito (process.env del test trae el .env local y la sesión de quien lo corre).
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));

const SECRETS = {
  JWT_SECRET: 'jwt',
  DB_PASSWORD: 'db',
  CREW_SERVICE_KEY: 'crew',
  ADMIN_SERVICE_KEY: 'admin',
  ANTHROPIC_API_KEY: 'sk-ant-api',
  DATABASE_URL: 'postgres://u:p@h/db',
  NODE_OPTIONS: '--inspect',
  LANG: 'es_CO.UTF-8',
};

function fakeSpawn({ stdout = '', code = 0 } = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    const call = { command, args, options, stdin: null };
    child.stdin = {
      end(data) {
        call.stdin = data;
        setImmediate(() => {
          if (stdout) child.stdout.emit('data', stdout);
          child.emit('close', code);
        });
      },
    };
    calls.push(call);
    return child;
  };
  return { spawnImpl, calls };
}

const envelope = (result, extra = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, usage: { input_tokens: 3, output_tokens: 4 }, ...extra });

const enabledAi = (extra = {}) => ({
  enabled: true,
  disabledReason: null,
  model: 'sonnet',
  timeoutMs: 1000,
  claudeCodePath: '/app/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
  ...extra,
});

describe('Ruta de Claude Code', () => {
  it('por defecto usa el binario del paquete instalado, con ruta absoluta', () => {
    const command = resolveClaudeCodePath({ configured: null });
    const packageDir = path.dirname(require.resolve('@anthropic-ai/claude-code/package.json'));
    const { bin } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    assert.equal(command, path.join(packageDir, typeof bin === 'string' ? bin : bin.claude));
    assert.ok(path.isAbsolute(command));
    assert.ok(fs.existsSync(command));
  });

  it('CLAUDE_CODE_PATH la sobrescribe', () => {
    assert.equal(resolveClaudeCodePath({ configured: '/opt/claude' }), '/opt/claude');
  });

  it('si el paquete no está instalado, usa `claude` del PATH', () => {
    const resolvePackage = () => {
      const error = new Error('Cannot find module');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    };
    assert.equal(resolveClaudeCodePath({ configured: null, resolvePackage }), 'claude');
  });
});

describe('Entorno del proceso de Claude Code', () => {
  it('en Linux solo pasa PATH, HOME, TMPDIR y el token: ningún secreto del backend', () => {
    const home = tempDir();
    const env = buildChildEnv({
      env: { PATH: '/usr/bin', HOME: home, TMPDIR: '/tmp/x', CLAUDE_CODE_OAUTH_TOKEN: 'tok', ...SECRETS },
      platform: 'linux',
      tmpdir: tempDir(),
    });
    assert.deepEqual(env, { PATH: '/usr/bin', HOME: home, TMPDIR: '/tmp/x', CLAUDE_CODE_OAUTH_TOKEN: 'tok' });
  });

  it('en Windows la carpeta personal va en HOME y USERPROFILE, con TEMP y TMP', () => {
    const home = tempDir();
    const env = buildChildEnv({
      env: { PATH: 'C:\\bin', USERPROFILE: home, TEMP: 'C:\\t', TMP: 'C:\\t', APPDATA: 'C:\\a', CLAUDE_CODE_OAUTH_TOKEN: 'tok', ...SECRETS },
      platform: 'win32',
      tmpdir: tempDir(),
    });
    assert.deepEqual(env, { PATH: 'C:\\bin', HOME: home, USERPROFILE: home, TEMP: 'C:\\t', TMP: 'C:\\t', CLAUDE_CODE_OAUTH_TOKEN: 'tok' });
  });

  it('no inventa variables que no existen en el entorno', () => {
    const home = tempDir();
    assert.deepEqual(buildChildEnv({ env: { PATH: '/usr/bin', HOME: home }, platform: 'linux', tmpdir: tempDir() }), {
      PATH: '/usr/bin',
      HOME: home,
    });
  });

  it('si HOME no existe, usa una carpeta dentro del directorio temporal y la crea', () => {
    const tmpdir = tempDir();
    const env = buildChildEnv({ env: { PATH: '/usr/bin', HOME: path.join(tmpdir, 'no-existe') }, platform: 'linux', tmpdir });
    assert.equal(env.HOME, path.join(tmpdir, 'aircrew-claude-home'));
    assert.ok(fs.statSync(env.HOME).isDirectory());
  });

  it('si no hay HOME, también usa la carpeta temporal', () => {
    const tmpdir = tempDir();
    assert.equal(buildChildEnv({ env: { PATH: '/usr/bin' }, platform: 'linux', tmpdir }).HOME, path.join(tmpdir, 'aircrew-claude-home'));
  });
});

describe('Llamada a Claude Code', () => {
  it('ejecuta la ruta absoluta sin shell, con argumentos literales y el prompt por stdin', async () => {
    const { spawnImpl, calls } = fakeSpawn({ stdout: envelope('{"ok":true}') });
    const tmpdir = tempDir();
    const home = tempDir();
    const client = createClaudeCodeClient({
      ai: enabledAi(),
      spawnImpl,
      env: { PATH: '/usr/bin', HOME: home, CLAUDE_CODE_OAUTH_TOKEN: 'tok', ...SECRETS },
      platform: 'linux',
      tmpdir,
    });

    const result = await client.decide({ system: 'Sistema', data: { vuelo: 'AV-100' }, schema: { type: 'object' } });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, '/app/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    assert.deepEqual(calls[0].args, [
      '-p',
      'Responde solo con el JSON pedido en las instrucciones de la entrada estandar.',
      '--output-format',
      'json',
      '--tools',
      '',
      '--model',
      'sonnet',
    ]);
    assert.deepEqual(calls[0].options, {
      cwd: tmpdir,
      env: { PATH: '/usr/bin', HOME: home, CLAUDE_CODE_OAUTH_TOKEN: 'tok' },
      shell: false,
      windowsHide: true,
    });
    assert.match(calls[0].stdin, /Sistema/);
    assert.match(calls[0].stdin, /AV-100/);
    assert.deepEqual(result.output, { ok: true });
    assert.equal(result.inputTokens, 3);
    assert.equal(result.outputTokens, 4);
  });

  it('en Windows, un comando que no es .exe (p. ej. claude.cmd) va por shell y entre comillas', async () => {
    const { spawnImpl, calls } = fakeSpawn({ stdout: envelope('{}') });
    const client = createClaudeCodeClient({
      ai: enabledAi({ claudeCodePath: 'C:\\Program Files\\npm\\claude.cmd' }),
      spawnImpl,
      env: { PATH: 'C:\\bin', USERPROFILE: tempDir() },
      platform: 'win32',
      tmpdir: tempDir(),
    });

    await client.decide({ system: 'S', data: {}, schema: {} });

    assert.equal(calls[0].command, '"C:\\Program Files\\npm\\claude.cmd"');
    assert.deepEqual(calls[0].args, [
      '-p',
      '"Responde solo con el JSON pedido en las instrucciones de la entrada estandar."',
      '--output-format',
      'json',
      '--tools',
      '""',
      '--model',
      'sonnet',
    ]);
    assert.equal(calls[0].options.shell, true);
  });

  it('en Windows, el .exe del paquete va sin shell', async () => {
    const { spawnImpl, calls } = fakeSpawn({ stdout: envelope('{}') });
    const client = createClaudeCodeClient({
      ai: enabledAi({ claudeCodePath: 'C:\\Mis Proyectos\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe' }),
      spawnImpl,
      env: { PATH: 'C:\\bin', USERPROFILE: tempDir() },
      platform: 'win32',
      tmpdir: tempDir(),
    });

    await client.decide({ system: 'S', data: {}, schema: {} });

    assert.equal(calls[0].command, 'C:\\Mis Proyectos\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
    assert.equal(calls[0].args[5], '');
    assert.equal(calls[0].options.shell, false);
  });

  it('sin configurar, no lanza la CLI y responde el motivo', async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const reason = 'La IA no está configurada: falta CLAUDE_CODE_OAUTH_TOKEN.';
    const client = createClaudeCodeClient({
      ai: enabledAi({ enabled: false, disabledReason: reason }),
      spawnImpl,
      env: { PATH: '/usr/bin', HOME: tempDir() },
      platform: 'linux',
      tmpdir: tempDir(),
    });

    assert.equal(client.isEnabled(), false);
    assert.equal(client.disabledReason, reason);
    await assert.rejects(client.decide({ system: 'S', data: {}, schema: {} }), { message: reason });
    assert.equal(calls.length, 0);
  });

  it('si la CLI termina con error y deja su respuesta en JSON, el error trae ese texto', async () => {
    const { spawnImpl } = fakeSpawn({
      code: 1,
      stdout: envelope('Failed to authenticate. API Error: 401 OAuth access token is invalid.', { is_error: true }),
    });
    const client = createClaudeCodeClient({
      ai: enabledAi(),
      spawnImpl,
      env: { PATH: '/usr/bin', HOME: tempDir() },
      platform: 'linux',
      tmpdir: tempDir(),
    });

    await assert.rejects(client.decide({ system: 'S', data: {}, schema: {} }), {
      message: 'Claude Code terminó con código 1: Failed to authenticate. API Error: 401 OAuth access token is invalid.',
    });
  });
});
