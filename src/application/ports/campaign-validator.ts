import type { CampaignSpec } from '../../domain/campaign.js';
export interface CampaignValidator {
  parse(value: unknown): CampaignSpec;
}
