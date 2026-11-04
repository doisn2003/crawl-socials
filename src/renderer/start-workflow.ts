import type { ProductionApi, ProductionState } from '../shared/production-api.js';
import type { CampaignDraftReference } from '../shared/campaign-drafts.js';

/** One user action owns planning and collection; clarification never starts collection early. */
export async function planAndStart(host: {
  api: Pick<ProductionApi, 'prepareCampaign' | 'start'>;
  profiles: Parameters<ProductionApi['start']>[0]['profiles'];
  useAi: boolean;
  draftReference(): CampaignDraftReference | undefined;
  prepared(state: ProductionState): void;
  phase(value: 'PLANNING' | 'STARTING'): void;
}): Promise<{ kind: 'STARTED' | 'CLARIFICATION'; state: ProductionState }> {
  let draft = host.useAi ? host.draftReference() : undefined;
  if (host.useAi && !draft) {
    host.phase('PLANNING');
    const next = await host.api.prepareCampaign(); host.prepared(next);
    if (next.campaignDraftError) throw Error(next.campaignDraftError.code);
    if (next.campaignDialogue?.plan.state === 'NEEDS_CLARIFICATION') return { kind: 'CLARIFICATION', state: next };
    draft = host.draftReference();
    if (!draft) throw Error('CAMPAIGN_INTENT_UNRESOLVED');
  }
  host.phase('STARTING');
  const next = await host.api.start({ profiles: host.profiles, ...(draft ? { draft } : {}) });
  return { kind: 'STARTED', state: next };
}
