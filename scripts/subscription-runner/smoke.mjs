// Run inside the deployed app container: node /app/subscription-smoke.mjs
// Uses only synthetic data; proposals are never executed or saved in JobSync.
const base = process.env.SUBSCRIPTION_RUNNER_URL;
const token = process.env.SUBSCRIPTION_RUNNER_TOKEN;
if (!base || !token) throw new Error('Runner configuration is missing.');

for (const provider of ['codex', 'claude-code']) {
  const listResponse = await fetch(`${base}/models?provider=${provider}&refresh=1`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!listResponse.ok) throw new Error(`${provider} model discovery failed (HTTP ${listResponse.status}).`);
  const catalog = await listResponse.json();
  const selected = provider === 'codex' ? catalog.modelDetails.find(m => m.id !== 'default' && m.effortLevels.includes('low')) : catalog.modelDetails.find(m => m.id === 'sonnet' && m.effortLevels.includes('low'));
  if (!selected || catalog.models.length < 2) throw new Error(`${provider} returned no selectable model and effort.`);
  const model = selected.id, effort = 'low';
  console.log(JSON.stringify({ provider, test: 'model-catalog', success: true, modelCount: catalog.models.length, model, effortLevels: selected.effortLevels }));
  const start = Date.now();
  const response = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      provider, model, effort,
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Propose saving the synthetic role Engineer at Example QA using test_proposal. Do not claim it has been saved.' }] }],
      tools: [{ type: 'function', name: 'test_proposal', description: 'Propose a synthetic role for a smoke test. JobSync must ask the user for approval before executing it.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, company: { type: 'string' } }, required: ['title', 'company'], additionalProperties: false } }],
      toolChoice: { type: 'required' },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`${provider} smoke request failed (HTTP ${response.status}): ${detail.error ?? 'runner unavailable'}`);
  }
  const data = await response.json();
  const proposal = data.toolCalls?.find(call => call.name === 'test_proposal');
  if (!proposal) throw new Error(`${provider} returned no proposal.`);
  const args = JSON.parse(proposal.arguments);
  if (args.title !== 'Engineer' || args.company !== 'Example QA') throw new Error(`${provider} returned an incorrect proposal.`);
  console.log(JSON.stringify({ provider, test: 'structured-tool-proposal', success: true, elapsedMs: Date.now() - start, model, effort }));
}
