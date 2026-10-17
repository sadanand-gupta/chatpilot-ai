#!/usr/bin/env node
/**
 * ChatPilot AI — run the whole stack locally in dev mode with one command.
 *
 *   node scripts/dev.mjs [--ai=mock|openai|ollama] [--ai-model=NAME]
 *                        [--api-port=8787] [--web-port=5173]
 *                        [--no-web] [--no-widget-watch]
 *                        [--smoke] [--exit-after=SECONDS] [--help]
 *
 * What it does
 *   1. Ensures apps/api/.env.development and apps/web/.env.development exist
 *      (copied from the matching *.example file, else written with safe dev defaults).
 *   2. Builds the widget once (apps/widget/dist/widget.js — the API serves it at /widget.js).
 *   3. Starts, with prefixed coloured output:
 *        [widget]  npm run dev -w @chatpilot/widget   (esbuild --watch)
 *        [api]     npm run dev -w @chatpilot/api      (tsx watch, port 8787)
 *        [web]     npm run dev -w @chatpilot/web      (vite, port 5173)
 *   4. Ctrl+C (SIGINT/SIGTERM) stops every child process tree
 *      (Windows: `taskkill /pid <pid> /T /F`; POSIX: kill the process group).
 *   5. If any child exits on its own the whole stack is stopped and this
 *      script exits non-zero.
 *
 * Only Node built-ins are used, so it works before/without extra deps.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const STARTED_AT = Date.now();
/** A child exiting within this window counts as a startup crash. */
const EARLY_EXIT_MS = 30_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { ai: undefined, aiModel: undefined, apiPort: undefined, webPort: undefined, web: true, widgetWatch: true, smoke: false, exitAfter: 0, help: false };
  for (const arg of argv) {
    const [k, ...rest] = arg.replace(/^--/, '').split('=');
    const v = rest.join('=');
    switch (k) {
      case 'ai':
        if (!['openai', 'ollama', 'mock'].includes(v)) die(`--ai must be one of openai|ollama|mock (got "${v}")`);
        out.ai = v;
        break;
      case 'ai-model':
        out.aiModel = v;
        break;
      case 'api-port':
        out.apiPort = Number(v);
        if (!Number.isInteger(out.apiPort) || out.apiPort < 1 || out.apiPort > 65535) die('--api-port must be a port number');
        break;
      case 'web-port':
        out.webPort = Number(v);
        if (!Number.isInteger(out.webPort) || out.webPort < 1 || out.webPort > 65535) die('--web-port must be a port number');
        break;
      case 'no-web':
        out.web = false;
        break;
      case 'no-widget-watch':
        out.widgetWatch = false;
        break;
      case 'smoke':
        out.smoke = true;
        break;
      case 'exit-after':
        out.exitAfter = Number(v);
        if (!(out.exitAfter > 0)) die('--exit-after must be a positive number of seconds');
        break;
      case 'help':
      case 'h':
        out.help = true;
        break;
      default:
        die(`Unknown option "${arg}". Run with --help.`);
    }
  }
  return out;
}

const HELP = `Usage: node scripts/dev.mjs [options]

  --ai=mock|openai|ollama   AI provider for the API (overrides AI_PROVIDER in apps/api/.env.development)
  --ai-model=NAME           AI model (overrides AI_MODEL)
  --api-port=8787           API port (also rewires the web app + widget URLs)
  --web-port=5173           Dashboard (Vite) port
  --no-web                  Do not start the dashboard
  --no-widget-watch         Build the widget once but do not watch it
  --smoke                   Run scripts/smoke.mjs once the API is healthy, then stop (exit code = smoke result)
  --exit-after=SECONDS      Stop everything after N seconds (exit 0 if nothing crashed) — handy for CI
  --help                    Show this help
`;

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { cyan: paint('36'), magenta: paint('35'), yellow: paint('33'), green: paint('32'), red: paint('31'), gray: paint('90'), bold: paint('1') };

const tag = (name, color) => color(`[${name}]`.padEnd(9));
const DEV = tag('dev', c.gray);
const log = (...a) => console.log(DEV, ...a);
const warn = (...a) => console.log(DEV, c.yellow('warning:'), ...a);
function die(msg, code = 1) {
  console.error(`${tag('dev', c.gray)}${c.red('error:')} ${msg}`);
  process.exit(code);
}

/** Pipes a stream line-by-line with a prefix (handles partial lines and \r\n). */
function pipeWithPrefix(stream, prefix, target, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      // When we kill a tree on purpose, npm reports "Lifecycle script failed" — hide that noise.
      if (shuttingDown && /^npm (error|ERR!)/.test(line)) continue;
      target.write(`${prefix}${line}\n`);
      onLine?.(line);
    }
  });
  stream.on('end', () => {
    if (buf) target.write(`${prefix}${buf}\n`);
    buf = '';
  });
}

// ---------------------------------------------------------------------------
// .env files
// ---------------------------------------------------------------------------
const API_ENV_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: '8787',
  AUTH_MODE: 'dev',
  DEV_JWT_SECRET: 'dev-only-secret-change-me',
  DATA_STORE: 'file',
  FILE_STORE_DIR: '.data',
  AI_PROVIDER: 'mock',
  FRONTEND_URLS: 'http://localhost:5173',
  PUBLIC_APP_URL: 'http://localhost:5173',
  PUBLIC_API_URL: 'http://localhost:8787',
  PUBLIC_WIDGET_URL: 'http://localhost:8787/widget.js',
  CONVERSATION_SECRET: 'dev-conversation-secret',
  ADMIN_TOKEN: 'dev-admin-token',
};

const WEB_ENV_DEFAULTS = {
  VITE_API_URL: 'http://localhost:8787',
  VITE_AUTH_MODE: 'dev',
  VITE_WIDGET_URL: 'http://localhost:8787/widget.js',
  VITE_PUBLIC_APP_URL: 'http://localhost:5173',
};

/** Minimal dotenv parser (KEY=VALUE, # comments, optional quotes). */
function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^"/.test(v)) v = v.replace(/^"((?:[^"\\]|\\.)*)".*$/, '$1');
    else if (/^'/.test(v)) v = v.replace(/^'([^']*)'.*$/, '$1');
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

function serializeDotenv(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

/**
 * Makes sure `<dir>/.env.development` exists. Never overwrites an existing file.
 * Returns the parsed contents.
 */
function ensureEnvFile(relDir, defaults, label) {
  const dir = path.join(ROOT, relDir);
  const target = path.join(dir, '.env.development');
  const example = path.join(dir, '.env.development.example');
  const rel = path.relative(ROOT, target).replace(/\\/g, '/');

  if (!fs.existsSync(target)) {
    if (fs.existsSync(example)) {
      let text = fs.readFileSync(example, 'utf8');
      // Append required dev keys the example does not define, so the stack boots.
      const parsed = parseDotenv(text);
      const missing = Object.fromEntries(Object.entries(defaults).filter(([k]) => !(k in parsed)));
      if (Object.keys(missing).length) {
        text = `${text.replace(/\s*$/, '')}\n\n# Added by scripts/dev.mjs (missing from the example)\n${serializeDotenv(missing)}\n`;
      }
      fs.writeFileSync(target, text);
      log(`created ${c.bold(rel)} from ${path.basename(example)}`);
    } else {
      const header = `# ${label} — local development only. Generated by scripts/dev.mjs.\n# Never use these values in production.\n`;
      fs.writeFileSync(target, `${header}${serializeDotenv(defaults)}\n`);
      log(`created ${c.bold(rel)} with dev defaults`);
    }
  } else {
    log(`using existing ${rel}`);
  }
  return parseDotenv(fs.readFileSync(target, 'utf8'));
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------
/** @type {{name: string, child: import('node:child_process').ChildProcess, persistent: boolean}[]} */
const children = [];
let shuttingDown = false;
/** Set once the API answers /health (or a fatal line was seen) — disables fatal-output detection. */
let startupDone = false;
let exitCode = 0;

function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM'); // whole process group (spawned detached)
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, 4000).unref();
  }
}

function run(name, color, command, { env = {}, persistent = true, fatalOutput } = {}) {
  const prefix = tag(name, color);
  const child = spawn(command, {
    cwd: ROOT,
    shell: true,
    // stdin ignored: avoids cmd.exe's "Terminate batch job (Y/N)?" prompt on Windows.
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN, // POSIX: own process group so we can kill the tree
    windowsHide: true,
    env: { ...process.env, ...(useColor ? { FORCE_COLOR: '1' } : {}), ...env },
  });
  // Watchers (tsx watch) stay alive when the app dies at boot, so also treat known
  // fatal startup output as a crash until the app is reported healthy.
  const onLine = fatalOutput
    ? (line) => {
        if (shuttingDown || startupDone || !fatalOutput.test(line)) return;
        startupDone = true;
        console.error(`${DEV}${c.red(`${name} failed during startup ("${line.trim()}") — stopping everything.`)}`);
        setTimeout(() => shutdown(1), 500); // let the rest of the error print
      }
    : undefined;
  pipeWithPrefix(child.stdout, prefix, process.stdout, onLine);
  pipeWithPrefix(child.stderr, prefix, process.stderr, onLine);
  const entry = { name, child, persistent };
  children.push(entry);
  child.on('error', (err) => {
    console.error(`${prefix}${c.red(`failed to start: ${err.message}`)}`);
  });
  if (persistent) {
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      const early = Date.now() - STARTED_AT < EARLY_EXIT_MS;
      const why = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`${DEV}${c.red(`${name} exited ${early ? 'during startup ' : ''}(${why}) — stopping everything.`)}`);
      shutdown(code && code !== 0 ? code : 1);
    });
  }
  return child;
}

function runOnce(name, color, command, opts) {
  return new Promise((resolve) => {
    const child = run(name, color, command, { ...opts, persistent: false });
    child.on('error', () => resolve(1));
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  process.exitCode = code; // in case the event loop drains before process.exit() below runs
  log(code === 0 ? 'stopping…' : c.red(`stopping (exit ${code})…`));
  for (const { child } of children) killTree(child);
  const deadline = setTimeout(() => process.exit(exitCode), 8000);
  deadline.unref();
  const waitAll = () => {
    if (children.every(({ child }) => child.exitCode !== null || child.signalCode !== null || !child.pid)) {
      clearTimeout(deadline);
      process.exit(exitCode);
    } else setTimeout(waitAll, 100);
  };
  waitAll();
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => {
      if (shuttingDown) {
        // Second Ctrl+C: force.
        for (const { child } of children) killTree(child);
        process.exit(exitCode || 130);
      }
      console.log('');
      shutdown(0);
    });
  } catch {
    /* signal not supported on this platform */
  }
}
process.on('exit', () => {
  for (const { child } of children) killTree(child);
});

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(800);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
}

async function waitForHealth(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !shuttingDown) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) die(`Node 20+ is required (found ${process.versions.node}).`);

  for (const p of ['apps/api/package.json', 'apps/web/package.json', 'apps/widget/package.json']) {
    if (!fs.existsSync(path.join(ROOT, p))) die(`${p} not found — run this from the ChatPilot repo.`);
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) die('node_modules missing — run `npm install` at the repo root first.');

  // 1) env files --------------------------------------------------------------
  const apiFile = ensureEnvFile('apps/api', API_ENV_DEFAULTS, 'ChatPilot API');
  const webFile = args.web ? ensureEnvFile('apps/web', WEB_ENV_DEFAULTS, 'ChatPilot dashboard') : {};

  // Real environment variables win over the .env file (that is how the API's dotenv loading works too).
  const fileOrEnv = (k) => process.env[k] ?? apiFile[k];

  const apiEnv = {};
  const webEnv = {};
  const apiPort = args.apiPort ?? Number(fileOrEnv('PORT') || 8787);
  const webPort = args.webPort ?? 5173;
  const apiUrl = `http://localhost:${apiPort}`;
  const webUrl = `http://localhost:${webPort}`;

  if (args.apiPort) {
    Object.assign(apiEnv, { PORT: String(apiPort), PUBLIC_API_URL: apiUrl, PUBLIC_WIDGET_URL: `${apiUrl}/widget.js` });
    Object.assign(webEnv, { VITE_API_URL: apiUrl, VITE_WIDGET_URL: `${apiUrl}/widget.js` });
  }
  if (args.webPort) {
    Object.assign(apiEnv, { FRONTEND_URLS: webUrl, PUBLIC_APP_URL: webUrl });
    Object.assign(webEnv, { VITE_PUBLIC_APP_URL: webUrl });
  }

  // AI provider passthrough ---------------------------------------------------
  if (args.ai) apiEnv.AI_PROVIDER = args.ai;
  if (args.aiModel) apiEnv.AI_MODEL = args.aiModel;
  const provider = apiEnv.AI_PROVIDER ?? fileOrEnv('AI_PROVIDER') ?? 'openai';
  if (provider === 'ollama') {
    // When switching to ollama via the flag, a model configured for another provider is meaningless.
    const fileIsOllama = fileOrEnv('AI_PROVIDER') === 'ollama';
    if (!apiEnv.AI_MODEL && (!fileIsOllama || !fileOrEnv('AI_MODEL'))) apiEnv.AI_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
    // A hosted (OpenAI-style) base URL left in the file would be wrong for Ollama.
    const cur = fileOrEnv('AI_BASE_URL');
    if (!cur || !/localhost|127\.0\.0\.1|:11434/.test(cur)) apiEnv.AI_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
    log(`AI provider: ${c.bold('ollama')} (model ${apiEnv.AI_MODEL ?? fileOrEnv('AI_MODEL')}, ${apiEnv.AI_BASE_URL ?? fileOrEnv('AI_BASE_URL')}) — make sure \`ollama serve\` is running.`);
  } else if (provider === 'openai') {
    const key = fileOrEnv('AI_API_KEY');
    if (!key || /replace-with|^sk-\.\.\.$/.test(key)) warn('AI_PROVIDER=openai but AI_API_KEY is not set in apps/api/.env.development or the environment — the API will refuse to start.');
    if (!apiEnv.AI_MODEL && !fileOrEnv('AI_MODEL')) warn('AI_PROVIDER=openai but AI_MODEL is not set — the API will refuse to start.');
    log(`AI provider: ${c.bold('openai-compatible')} (${fileOrEnv('AI_BASE_URL') ?? 'default base URL'})`);
  } else {
    log(`AI provider: ${c.bold(provider)}`);
  }

  if (fileOrEnv('AUTH_MODE') && fileOrEnv('AUTH_MODE') !== 'dev')
    warn(`AUTH_MODE=${fileOrEnv('AUTH_MODE')} — Firebase credentials are required (dev login is disabled).`);
  if (webFile.VITE_API_URL && !args.apiPort && webFile.VITE_API_URL.replace(/\/$/, '') !== apiUrl)
    warn(`apps/web/.env.development has VITE_API_URL=${webFile.VITE_API_URL} but the API runs on ${apiUrl}.`);

  // Port checks — a stray server makes tsx-watch / vite fail in confusing ways.
  const busy = [];
  if (await portInUse(apiPort)) busy.push(`API port ${apiPort}`);
  if (args.web && (await portInUse(webPort))) busy.push(`web port ${webPort}`);
  if (busy.length) die(`${busy.join(' and ')} already in use. Stop the other process or pass --api-port= / --web-port=.`);

  // 2) widget build ----------------------------------------------------------
  if (!fs.existsSync(path.join(ROOT, 'apps/widget/build.mjs')))
    warn('apps/widget/build.mjs not found yet — the widget build will probably fail.');
  log('building widget…');
  const buildCode = await runOnce('widget', c.yellow, 'npm run build -w @chatpilot/widget');
  if (shuttingDown) return;
  if (buildCode !== 0) die(`widget build failed (exit ${buildCode}).`, buildCode || 1);
  if (!fs.existsSync(path.join(ROOT, 'apps/widget/dist/widget.js'))) warn('widget build finished but apps/widget/dist/widget.js was not found.');

  // 3) long-running processes -------------------------------------------------
  if (args.widgetWatch) run('widget', c.yellow, 'npm run dev -w @chatpilot/widget');
  run('api', c.cyan, 'npm run dev -w @chatpilot/api', {
    env: apiEnv,
    fatalOutput: /Refusing to start|Invalid environment configuration|EADDRINUSE|ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError:/,
  });
  if (args.web) {
    const portFlag = args.webPort ? ` -- --port ${webPort} --strictPort` : '';
    run('web', c.magenta, `npm run dev -w @chatpilot/web${portFlag}`, { env: webEnv });
  }

  if (args.exitAfter) {
    setTimeout(() => {
      log(`--exit-after ${args.exitAfter}s reached.`);
      shutdown(0);
    }, args.exitAfter * 1000).unref();
  }

  const healthy = await waitForHealth(`${apiUrl}/health`, 90_000);
  startupDone = true;
  if (shuttingDown) return;
  if (!healthy) {
    warn(`API did not answer ${apiUrl}/health within 90s — check the [api] output above.`);
    if (args.smoke) shutdown(1);
    return;
  }
  console.log(
    [
      '',
      `${DEV}${c.green(c.bold('ChatPilot AI dev stack is up'))}`,
      `${DEV}  API        ${apiUrl}   (health: ${apiUrl}/health)`,
      `${DEV}  Widget     ${apiUrl}/widget.js`,
      args.web ? `${DEV}  Dashboard  ${webUrl}` : null,
      `${DEV}  ${c.gray('Ctrl+C to stop everything.')}`,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  );

  if (args.smoke) {
    const smokeCode = await runOnce('smoke', c.green, `node "${path.join(ROOT, 'scripts', 'smoke.mjs')}"`, {
      env: { API_URL: apiUrl, WEB_URL: webUrl },
    });
    shutdown(smokeCode);
  }
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
