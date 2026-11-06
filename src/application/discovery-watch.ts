import type { ProductionState, RunState } from '../shared/production-api.js';
import type { DiscoveryStore } from '../infrastructure/storage/discovery-store.js';

export function createDiscoveryWatch(input: {
  store: DiscoveryStore; getState(): Promise<ProductionState>; readRunState(id: string): RunState | null;
  start(sourceRunId: string, target: number, excludedRootKeys: string[]): Promise<ProductionState>;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date()); let busy = false, stopped = false;
  const active = (run: RunState | null) => run && (['RUNNING', 'STOPPING'].includes(run.state) || run.opportunity?.assessmentActive || run.opportunity?.watchActive);
  const resultCount = (run: RunState): number => {
    const o = run.opportunity;
    const count = o ? o.targetCount ?? (o.filterMode === 'OFF' ? o.counts.raw : o.counts.suitable) : 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw Error('DISCOVERY_RESULT_COUNT_INVALID');
    return count;
  };
  async function tick(requestId?: string) {
    if (requestId !== undefined && (typeof requestId !== 'string' || !input.store.list().some(s => s.id === requestId))) throw Error('DISCOVERY_INPUT_INVALID');
    if (busy || stopped) { if (requestId) throw Error(stopped ? 'DISCOVERY_STOPPED' : 'DISCOVERY_BUSY'); return; }
    busy = true;
    try {
      const state = await input.getState();
      if (state.run?.discoverySourceRunId) {
        const source = input.store.scopeForRun(state.run.discoverySourceRunId);
        const owner = input.store.list().find(s => s.sourceRunId === source);
        // Recover a service-start / subscription-write crash before any export or new start.
        if (owner && input.store.scopeForRun(state.run.id) === state.run.id && !owner.activeRunId && !owner.awaitingExport) input.store.beginRun(owner.id, state.run.id);
      }
      let outstandingRun = false;
      for (const sub of input.store.list().filter(s => s.activeRunId || s.awaitingExport)) {
        let run: RunState | null;
        try { run = state.run?.id === (sub.activeRunId ?? sub.lastRunId) ? state.run : input.readRunState((sub.activeRunId ?? sub.lastRunId)!); }
        catch {
          input.store.defer(sub.id, 'DISCOVERY_RUN_STATE_UNREADABLE'); outstandingRun = true; continue;
        }
        if (!run || run.id !== (sub.activeRunId ?? sub.lastRunId)) {
          input.store.defer(sub.id, 'DISCOVERY_RUN_STATE_MISSING'); outstandingRun = true; continue;
        }
        if (active(run)) { outstandingRun = true; continue; }
        input.store.finishRun(sub.id, resultCount(run), ['FAILED', 'INTERRUPTED'].includes(run.state) ? 'DISCOVERY_RUN_' + run.state : null);
      }
      if (outstandingRun) { if (requestId) throw Error('RUN_ACTIVE'); return; }
      if (active(state.run) || state.campaignDraftPreparing) { if (requestId) throw Error('RUN_ACTIVE'); return; }
      // Do not replace a completed result the user has not exported.
      if (state.run?.opportunity && resultCount(state.run) > 0 && !input.store.hasExport(state.run.id, resultCount(state.run))) {
        if (requestId) throw Error('DISCOVERY_EXPORT_REQUIRED'); return;
      }
      const selected = input.store.list().find(s => (!requestId || s.id === requestId) && s.enabled && !s.activeRunId && !s.awaitingExport
        && s.deliveredThisMonth < s.monthlyTarget && (!!requestId || Date.parse(s.nextRunAt) <= now().getTime()));
      if (!selected) { if (requestId) throw Error('DISCOVERY_NOT_DUE'); return; }
      if (stopped) return;
      try {
        const next = await input.start(selected.sourceRunId, selected.monthlyTarget - selected.deliveredThisMonth, input.store.deliveredKeys(selected.sourceRunId));
        if (!next.run || next.run.discoverySourceRunId !== selected.sourceRunId) throw Error('DISCOVERY_START_FAILED');
        input.store.beginRun(selected.id, next.run.id);
      } catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'DISCOVERY_START_FAILED';
        input.store.defer(selected.id, code); if (requestId) throw error;
      }
    } finally { busy = false; }
  }
  return { tick, async stop() { stopped = true; while (busy) await new Promise(resolve => setTimeout(resolve, 10)); }, get busy() { return busy; } };
}
