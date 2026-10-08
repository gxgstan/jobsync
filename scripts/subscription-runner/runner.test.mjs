import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { runnerServer, validateRequest, generationPlan, normalizeResponse, runProcess, createLimiter } from './server.mjs';

const input = () => ({ provider: 'codex', model: 'default', prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] });

test('rejects unknown models and native provider tools before launching a CLI', () => {
  assert.throws(() => validateRequest({ ...input(), model: 'default; touch /tmp/unsafe' }), /Unknown/);
  assert.throws(() => validateRequest({ ...input(), tools: [{ type: 'provider', id: 'shell' }] }), /function tools/);
  assert.throws(() => validateRequest({ ...input(), prompt: [{ role: 'user', content: [{ type: 'file', data: 'x' }] }] }), /Extract files/);
});

test('specific and forbidden tool choices constrain proposals', () => {
  const request = validateRequest({ ...input(), tools: [{ type: 'function', name: 'save' }, { type: 'function', name: 'read' }], toolChoice: { type: 'tool', toolName: 'read' } });
  assert.deepEqual(generationPlan(request).schema.properties.toolCalls.items.properties.name.enum, ['read']);
  assert.throws(() => normalizeResponse(request, JSON.stringify({ text: '', toolCalls: [{ name: 'save', arguments: '{}' }] })), /unavailable tool/);
  assert.throws(() => normalizeResponse(request, JSON.stringify({ text: 'No', toolCalls: [] })), /required tool/);
  const none = validateRequest({ ...input(), tools: [{ type: 'function', name: 'save' }], toolChoice: { type: 'none' } });
  assert.equal(generationPlan(none).schema, undefined);
});

test('validates structured output instead of passing incomplete responses to the app', () => {
  const request = validateRequest({ ...input(), responseFormat: { type: 'json' } });
  assert.throws(() => normalizeResponse(request, 'unfinished'), /invalid structured/);
  assert.throws(() => normalizeResponse(request, JSON.stringify({ text: 'Not JSON', toolCalls: [] })), /invalid JSON/);
  const result = normalizeResponse(request, JSON.stringify({ text: '{"score":80}', toolCalls: [] }));
  assert.equal(JSON.parse(result.text).score, 80);
});

test('runner requires its own bearer token and validates requests before execution', async () => {
  let calls = 0;
  const token = 't'.repeat(48);
  const server = runnerServer({ token, ready: async () => true, execute: async () => { calls++; return { text: 'OK', toolCalls: [] }; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/generate`, { method: 'POST', body: JSON.stringify(input()) })).status, 401);
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${url}/generate`, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal(calls, 0);
    const response = await fetch(`${url}/generate`, { method: 'POST', headers, body: JSON.stringify(input()) });
    assert.equal(response.status, 200); assert.equal((await response.json()).text, 'OK'); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('serializes each subscription and cancels queued work without executing it', async () => {
  const limit = createLimiter();
  const ac = new AbortController();
  let release, secondRan = false;
  const first = limit('codex', new AbortController().signal, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const second = limit('codex', ac.signal, () => { secondRan = true; });
  ac.abort(); await assert.rejects(second, { name: 'AbortError' });
  release('done'); await first;
  assert.equal(secondRan, false);
  assert.equal(await limit('codex', new AbortController().signal, async () => 'next'), 'next');
});

test('cancellation terminates an active CLI process', async () => {
  const ac = new AbortController();
  const run = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', ac.signal, process.cwd(), process.env);
  const timer = setTimeout(() => ac.abort(), 100);
  try { await assert.rejects(run, { name: 'AbortError' }); } finally { clearTimeout(timer); }
});
