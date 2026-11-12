import { CREDITS_PER_USD } from '../../shared/managed.js';
import type { RunState } from '../../shared/production-api.js';
import type { OpportunityExportData } from './opportunity-workbook.js';

const microcreditsPerCredit = 1_000_000;

function amountsInCredits(value: unknown, nestedFields: readonly string[] = []): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([field, amount]) => {
    const creditField = field.replace(/_usd$/, '_credits').replace(/Usd$/, 'Credits');
    if (creditField !== field && typeof amount === 'number') {
      return [creditField, Math.round(amount * CREDITS_PER_USD * microcreditsPerCredit) / microcreditsPerCredit];
    }
    if (nestedFields.includes(field)) {
      return [field, Array.isArray(amount) ? amount.map(item => amountsInCredits(item, nestedFields)) : amountsInCredits(amount, nestedFields)];
    }
    return [creditField, amount];
  }));
}

export function starterOpportunityInCredits(data: OpportunityExportData): OpportunityExportData {
  return { ...data, cost_unit: 'credits', campaign: amountsInCredits(data.campaign, ['budget']),
    progress: amountsInCredits(data.progress), cost: amountsInCredits(data.cost, ['models', 'components']),
    runtime_limits: amountsInCredits(data.runtime_limits, ['overrides']) };
}

export function starterRunInCredits(run: RunState) {
  return { ...run, opportunity: amountsInCredits(run.opportunity) };
}
