import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from '../infrastructure/config/user-config.js';
import { contentHash } from '../domain/conversation.js';
import type { CampaignPlan } from '../domain/campaign-plan.js';
import type { ModelGateway } from './ports/model-gateway.js';

/** Initial coverage and the durable reserve are separate; every profile can replay the same reserve safely. */
export function initialDiscoveryQueries(campaign: CampaignPlan, platform: 'facebook' | 'threads'): string[] {
  return campaign.queries.filter(q => q.platforms.includes(platform) && (!campaign.discovery_plan || q.wave === 0)).map(q => q.text);
}

/** At most one paid expansion per campaign, shared by both platforms and persisted before dispatch. */
export function createCoverageExpansion(directory: string, campaign: CampaignPlan, gateway: ModelGateway, signal: AbortSignal) {
  const file = join(directory, 'coverage-query-expansion.json');
  let work: Promise<string[]> | undefined;
  return () => work ??= (async () => {
    const fingerprint = contentHash(campaign);
    if (campaign.discovery_plan) {
      // This is a frozen retrieval portfolio, not a new inference or a destructive queue pop.
      // Replaying the full reserve avoids one platform/profile consuming another's query wave.
      signal.throwIfAborted();
      const queries = campaign.discovery_plan.queries.filter(q => q.wave > 0).map(q => q.text);
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string; queries: string[]; state: string };
        if (saved.fingerprint !== fingerprint || saved.state !== 'FROZEN_RESERVE'
          || JSON.stringify(saved.queries) !== JSON.stringify(queries)) throw Error('QUERY_EXPANSION_STATE_INVALID');
      } else atomicJson(file, { fingerprint, queries, state: 'FROZEN_RESERVE',
        waves: campaign.discovery_plan.queries.filter(q => q.wave > 0).map(q => ({ query_id: q.query_id, wave: q.wave, family_id: q.family_id, facet_ids: q.facet_ids })) });
      return [...queries];
    }
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { fingerprint: string; queries: string[] };
      if (saved.fingerprint !== fingerprint || !Array.isArray(saved.queries)) throw Error('QUERY_EXPANSION_STATE_INVALID');
      return saved.queries;
    }
    const branches = campaign.intent_resolution?.plan.branches.filter(b => b.scope === 'CORE') ?? [];
    if (!branches.length || gateway.summary().remaining_usd < 0.01) return [];
    // An interrupted request must not trigger an unbounded new expansion on Resume.
    atomicJson(file, { fingerprint, queries: [], state: 'STARTED' });
    try {
      const result = await gateway.generateJson({ purpose: 'coverage-query-expansion-v1',
        system: 'Đề xuất tối đa 4 truy vấn tìm kiếm ngắn khác existing, cùng một nhánh CORE đã chốt. Tìm cách nói tự nhiên và tín hiệu gián tiếp của đúng vai/nhu cầu; không mở lĩnh vực hoặc đổi mua/thuê/mượn. Mỗi query phải chứa nguyên văn anchor của branch tương ứng. Chỉ dùng branch id được cấp. Không sửa tiêu chí. Chỉ JSON.',
        input: { goal: campaign.prompt, branches: branches.map(b => ({ id: b.id, label: b.label, anchor: b.anchor })), existing: campaign.queries.map(q => q.text) },
        schema: { type: 'array', maxItems: 4, items: { type: 'object', properties: { branch: { type: 'string' }, query: { type: 'string' } }, required: ['branch', 'query'] } },
        max_output_tokens: 600, signal });
      if (!Array.isArray(result.value) || result.value.length > 4) throw Error('QUERY_EXPANSION_INVALID');
      const queries: string[] = [];
      for (const item of result.value) {
        const branch = branches.find(b => b.id === item?.branch);
        if (!branch || typeof item.query !== 'string' || !item.query.trim() || item.query.length > 200 || /[\r\n]/.test(item.query)
          || !item.query.normalize('NFC').toLowerCase().includes(branch.anchor.normalize('NFC').toLowerCase())) throw Error('QUERY_EXPANSION_UNGROUNDED');
        if (!campaign.queries.some(q => q.text.toLowerCase() === item.query.toLowerCase()) && !queries.includes(item.query)) queries.push(item.query.trim());
      }
      atomicJson(file, { fingerprint, queries, state: 'COMPLETE', request_hash: result.request_hash, model: result.model }); return queries;
    } catch (error) { atomicJson(file, { fingerprint, queries: [], state: 'FAILED' }); throw error; }
  })();
}
