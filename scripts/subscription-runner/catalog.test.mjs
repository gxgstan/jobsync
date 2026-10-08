import test from 'node:test';
import assert from 'node:assert/strict';
import { codexCatalog, claudeCatalog, withMetadataCli } from './catalog.mjs';

test('uses the Codex picker catalogue, per-model efforts and configured Tinyboy default', () => {
  const result = codexCatalog([
    { model: 'model-a', displayName: 'Model A', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low', isDefault: true },
    { model: 'model-b', displayName: 'Model B', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium' },
    { model: 'hidden-model', hidden: true }, { model: '--unsafe' },
  ], { model: 'model-b', model_reasoning_effort: 'medium' });
  assert.deepEqual(result.models, ['default', 'model-a', 'model-b']);
  assert.deepEqual(result.modelDetails[0], { id: 'default', displayName: 'Tinyboy default (Model B)', effortLevels: ['medium'], defaultEffort: 'medium' });
  assert.deepEqual(result.modelDetails[1].effortLevels, ['low', 'high']);
});

test('does not invent efforts when the configured Codex model is outside the picker', () => {
  const result = codexCatalog([{ model: 'model-a', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], isDefault: true }], { model: 'custom-model' });
  assert.deepEqual(result.modelDetails[0].effortLevels, []);
});

test('reads Claude efforts from CLI metadata and preserves models with no effort support', () => {
  const result = claudeCatalog([
    { value: 'opus', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'max'] },
    { value: 'legacy-model', displayName: 'Legacy' }, { value: '--unsafe' },
  ]);
  assert.deepEqual(result.models, ['opus', 'legacy-model']);
  assert.deepEqual(result.modelDetails.map(m => m.effortLevels), [['low', 'high', 'max'], []]);
});

test('reads a metadata RPC response and terminates the process without sending an inference prompt', async () => {
  const program = `process.stdin.on('data', chunk => {
    const m = JSON.parse(chunk.toString());
    if (m.method !== 'model/list') process.exit(2);
    console.log(JSON.stringify({id:m.id,result:{data:['model-a']}}));
  });`;
  const result = await withMetadataCli(process.execPath, ['-e', program], AbortSignal.timeout(2000), process.cwd(), process.env,
    async ({ request }) => request({ id: 1, method: 'model/list', params: {} }));
  assert.deepEqual(result, { data: ['model-a'] });
});

test('metadata cancellation kills a CLI that never responds', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(withMetadataCli(process.execPath, ['-e', 'setInterval(()=>{},1000)'], controller.signal, process.cwd(), process.env,
      async ({ request }) => request({ id: 1, method: 'model/list' })), { name: 'AbortError' });
  } finally { clearTimeout(timer); }
});
