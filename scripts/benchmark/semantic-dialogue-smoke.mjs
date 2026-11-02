// Bounded integration probe, using the exact desktop planner, durable dialogue and model ledger.
// Synthetic probes are not a semantic accuracy benchmark. Never logs credentials.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { prepareSemanticDraft, continueSemanticDraft, readDialogue } from '../../dist/application/campaign-drafts.js';
import { createCampaignModelGateway } from '../../dist/infrastructure/llm/campaign-model-gateway.js';
const output = process.argv[2]; if (!output) throw Error('Pass a private evidence output directory.');
let key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!key && process.platform === 'win32') key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "[Environment]::GetEnvironmentVariable('GEMINI_API_KEY','User')"], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (!key) throw Error('GEMINI_KEY_REQUIRED');
const directory = resolve(output), results = [];
const gatewayFactory = options => createCampaignModelGateway({ ...options, apiKey: key, maxAttempts: 1, timeoutMs: 60000 });
const config = prompt => ({ enabled: true, prompt, brandContext: '', totalTarget: 10, threadsShare: .8, rawCap: 30, budgetUsd: .25, commentsEnabled: false });
function record(name, value) {
  const dialogue = readDialogue({ directory, runId: value.runId });
  const summary = { name, runId: value.runId, model: value.cost.model, revision: dialogue.input.revision,
    state: dialogue.plan.state, questions: dialogue.plan.questions.map(q => q.prompt),
    queries: dialogue.plan.queries.filter(q => !q.rejection).map(q => q.text), uncovered: dialogue.plan.uncovered,
    audience: value.criteria?.audience, costUsd: value.cost.measuredUsd, attempts: value.cost.billableAttempts };
  results.push(summary); console.log(JSON.stringify(summary)); return dialogue;
}
try {
  record('lawyer', await prepareSemanticDraft({ directory, gatewayFactory, config: config('tìm người muốn thuê luật sư') }));
  const initial = await prepareSemanticDraft({ directory, gatewayFactory,
    config: config('Tìm người mua bán đàn piano. Tôi chưa quyết định lấy người hỏi mua hay người đang rao bán.') });
  let dialogue = record('piano-ambiguous', initial);
  if (dialogue.plan.state !== 'NEEDS_CLARIFICATION') throw Error('PROBE_EXPECTED_CLARIFICATION');
  const answers = dialogue.plan.questions.filter(q => q.required).map(q => ({ question_id: q.id, selected_option_ids: [],
    raw_text: 'Tôi chỉ tìm người đang hỏi mua đàn piano để bán đàn cho họ, không lấy người rao bán hoặc chỉ thảo luận chung.' }));
  const ready = await continueSemanticDraft({ directory, gatewayFactory, request: { runId: dialogue.runId, expectedRevision: dialogue.revision, answers } });
  dialogue = record('piano-buyers', ready);
  if (!('campaign' in ready)) throw Error('PROBE_EXPECTED_READY');
  const old = dialogue.input.answers.find(a => a.target_field === 'target_roles');
  if (!old) throw Error('PROBE_EXPECTED_ROLE_ANSWER');
  const edited = await continueSemanticDraft({ directory, gatewayFactory, request: { runId: dialogue.runId, expectedRevision: dialogue.revision,
    editAnswerId: old.answer_id, answers: [{ question_id: old.question_id, selected_option_ids: [],
      raw_text: 'Tôi sửa lại: chỉ tìm người đang rao bán đàn piano để mua đàn từ họ; không lấy người hỏi mua hoặc thảo luận chung.' }] } });
  record('piano-sellers-after-edit', edited);
  if (!('campaign' in edited)) throw Error('PROBE_EXPECTED_READY_AFTER_EDIT');
} catch (error) { results.push({ error: /^[A-Z_]+$/.test(error.message) ? error.message : 'PROBE_FAILED' }); process.exitCode = 1; }
finally { key = ''; await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'smoke-summary.json'), JSON.stringify({ observed_at: new Date().toISOString(), results }, null, 2)); }
