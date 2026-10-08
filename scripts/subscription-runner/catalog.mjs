import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PROVIDERS = ['codex', 'claude-code'];
export const validModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,159}$/.test(value);
export const validEffort = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
export const CODEX_CONFIG = [
  'approval_policy="never"', 'features.hooks=false', 'features.apps=false',
  'features.shell_tool=false', 'features.unified_exec=false',
  'features.multi_agent=false', 'features.multi_agent_v2=false',
  'features.plugins=false', 'features.image_generation=false',
  'features.shell_snapshot=false', 'web_search="disabled"', 'mcp_servers={}',
];
export const CLAUDE_OPTIONS = [
  '--tools', '', '--disable-slash-commands', '--no-session-persistence',
  '--setting-sources', '', '--settings', '{"disableAllHooks":true,"ultracode":false}',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
];

export function cliEnvironment() {
  const env = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

// Metadata only: no thread, user message, inference, or configuration write.
// Keep the same tool restrictions as generation and discard all other CLI data.
export async function withMetadataCli(binary, args, signal, cwd, env, callback) {
  signal.throwIfAborted();
  const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  const pending = new Map();
  let buffer = '', size = 0, ended = false, failure, killTimer;
  const closed = new Promise(resolve => child.once('close', resolve));
  const fail = error => { failure = error; for (const p of pending.values()) p.reject(error); pending.clear(); };
  const stop = () => {
    if (ended) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
    killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } }, 1000);
  };
  const aborted = () => { fail(signal.reason); stop(); };
  signal.addEventListener('abort', aborted, { once: true });
  const count = chunk => {
    size += Buffer.byteLength(chunk);
    if (size > 2 * 1024 * 1024) { fail(new Error('CLI metadata exceeded its size limit.')); stop(); return false; }
    return true;
  };
  child.stderr.on('data', count);
  child.stdout.on('data', chunk => {
    if (!count(chunk)) return;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const response = message.type === 'control_response' ? message.response : message;
      const key = String(response?.request_id ?? response?.id);
      const p = pending.get(key);
      if (!p) continue;
      pending.delete(key);
      if (response.error || response.subtype === 'error') p.reject(new Error('CLI model discovery failed.'));
      else p.resolve(message.type === 'control_response' ? response.response : response.result);
    }
  });
  child.on('error', () => fail(new Error('Subscription CLI is unavailable.')));
  child.on('close', () => { ended = true; fail(failure ?? new Error('Subscription CLI closed during model discovery.')); clearTimeout(killTimer); });
  child.stdin.on('error', () => {});
  const notify = message => { if (failure) throw failure; child.stdin.write(JSON.stringify(message) + '\n'); };
  const request = (message, key = message.id) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    pending.set(String(key), { resolve, reject });
    try { notify(message); } catch (error) { pending.delete(String(key)); reject(error); }
  });
  try { return await callback({ request, notify }); }
  finally { signal.removeEventListener('abort', aborted); stop(); await closed; clearTimeout(killTimer); }
}

export function codexCatalog(models, config = {}) {
  const details = models.filter(m => !m.hidden && validModel(m.model)).map(m => {
    const effortLevels = [...new Set((m.supportedReasoningEfforts ?? []).map(e => e.reasoningEffort).filter(validEffort))];
    return { id: m.model, displayName: m.displayName || m.model, effortLevels,
      defaultEffort: effortLevels.includes(m.defaultReasoningEffort) ? m.defaultReasoningEffort : undefined };
  });
  if (!details.length) throw new Error('Codex returned no selectable models.');
  const configured = details.find(m => m.id === config.model)
    ?? (!config.model ? details.find(m => models.find(raw => raw.model === m.id)?.isDefault) : undefined);
  details.unshift({
    id: 'default', displayName: configured ? `Tinyboy default (${configured.displayName})` : 'Tinyboy default',
    effortLevels: configured?.effortLevels ?? [],
    defaultEffort: configured?.effortLevels.includes(config.model_reasoning_effort) ? config.model_reasoning_effort : configured?.defaultEffort,
  });
  return { models: details.map(m => m.id), modelDetails: details };
}

export function claudeCatalog(models) {
  const details = models.filter(m => validModel(m.value)).map(m => ({
    id: m.value, displayName: m.displayName || m.value,
    effortLevels: m.supportsEffort ? [...new Set((m.supportedEffortLevels ?? []).filter(validEffort))] : [],
  }));
  if (!details.length) throw new Error('Claude Code returned no selectable models.');
  return { models: details.map(m => m.id), modelDetails: details };
}

export async function discoverModels(provider, signal) {
  const dir = await mkdtemp(join(tmpdir(), 'jobsync-models-'));
  try {
    if (provider === 'codex') {
      const args = ['app-server', '--listen', 'stdio://', ...CODEX_CONFIG.flatMap(c => ['-c', c])];
      return await withMetadataCli('codex', args, signal, dir, cliEnvironment(), async ({ request, notify }) => {
        await request({ id: 1, method: 'initialize', params: { clientInfo: { name: 'jobsync', version: '1.1.21' }, capabilities: null } });
        notify({ method: 'initialized', params: {} });
        let cursor, models = [];
        for (let page = 0; page < 5; page++) {
          const result = await request({ id: page + 2, method: 'model/list', params: { limit: 100, includeHidden: false, cursor } });
          models.push(...result.data);
          cursor = result.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error('Codex model catalogue exceeded its page limit.');
        const result = await request({ id: 10, method: 'config/read', params: { includeLayers: false } });
        return codexCatalog(models, result.config);
      });
    }
    return await withMetadataCli('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...CLAUDE_OPTIONS], signal, dir, cliEnvironment(), async ({ request }) => {
      const result = await request({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }, 'models');
      return claudeCatalog(result.models);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const cache = new Map(), pendingCatalogs = new Map();
export async function subscriptionCatalog(provider, signal, { refresh = false } = {}) {
  signal.throwIfAborted();
  const home = provider === 'codex' ? process.env.CODEX_HOME : process.env.CLAUDE_CONFIG_DIR;
  const files = provider === 'codex' ? ['auth.json', 'config.toml'] : ['.credentials.json'];
  const stamps = await Promise.all(files.map(async file => { try { return (await stat(join(home ?? '', file))).mtimeMs; } catch { return 0; } }));
  const key = JSON.stringify([provider, home, stamps]);
  const entry = cache.get(provider);
  if (!refresh && entry?.key === key && entry.expires > Date.now()) return entry.data;
  if (!pendingCatalogs.has(key)) {
    const pending = discoverModels(provider, AbortSignal.timeout(20_000)).then(data => {
      cache.set(provider, { key, data, expires: Date.now() + 5 * 60_000 }); return data;
    }).finally(() => pendingCatalogs.delete(key));
    pendingCatalogs.set(key, pending);
  }
  const data = await pendingCatalogs.get(key);
  signal.throwIfAborted();
  return data;
}
