import { Ajv } from 'ajv';
import type { CampaignSpec } from '../../domain/campaign.js';
import type { CampaignValidator } from '../../application/ports/campaign-validator.js';

export function createCampaignValidator(schema: object): CampaignValidator {
  const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false });
  ajv.addFormat('date-time', value => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return false;
    const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction: string | undefined) => '.' + (fraction || '').padEnd(3, '0') + 'Z');
    return date.toISOString() === normalized;
  });
  const validate = ajv.compile<CampaignSpec>(schema);
  return {
    parse(value) {
      if (!validate(value)) throw new Error('CAMPAIGN_SCHEMA_INVALID');
      const window = value.historical_window;
      if (window.mode === 'RANGE' && Date.parse(window.from_utc!) >= Date.parse(window.to_utc!)) {
        // Contract uses a nonempty half-open [from, to) window; errors never echo input.
        throw new Error('CAMPAIGN_RANGE_INVALID');
      }
      // Return a detached record so callers cannot change configuration during a preview.
      return structuredClone(value);
    },
  };
}
