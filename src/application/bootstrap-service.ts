import { SOURCE_TYPES } from '../domain/campaign.js';
import type { AppInfo, OfflineCheckResult } from '../shared/desktop-api.js';
import type { CampaignValidator } from './ports/campaign-validator.js';

export function createBootstrapService(input: {
  campaign: unknown; offlineFixture: unknown; validator: CampaignValidator; version: string;
}) {
  const spec = input.validator.parse(input.campaign);
  // A bootstrap preview never grants live access or treats schema validity as G00.
  if (spec.mode !== 'DRAFT' || spec.collection_scope !== 'PUBLIC_DISCOVERY') throw new Error('BOOTSTRAP_DRAFT_REQUIRED');
  return {
    getInfo(): AppInfo {
      return {
        product: 'FindLink', fullName: 'FindLink', version: input.version,
        mode: 'OFFLINE_BOOTSTRAP', benchmarkReady: false,
        campaign: {
          name: spec.name, keywords: [...spec.workload.keywords],
          preferredPlaces: [...spec.workload.geography.preferred_places],
          sources: SOURCE_TYPES.filter(type => spec.source_requirements[type].in_scope === true)
            .map(type => ({ type, minimum: spec.source_requirements[type].minimum_valid_unique_posts })),
          target: spec.target.valid_unique_posts, maxHours: spec.target.max_wall_time_seconds / 3600,
          historicalPostsAllowed: spec.historical_window.mode === 'UNBOUNDED',
          expansionAllowed: spec.discovery_policy.expansion !== 'DISABLED',
        },
      };
    },
    runOfflineCheck(): OfflineCheckResult {
      const fixture = input.validator.parse(input.offlineFixture);
      if (fixture.mode !== 'DRAFT' || fixture.workload.confirmation !== 'EXAMPLE_ONLY') throw new Error('OFFLINE_FIXTURE_REQUIRED');
      return { captureMode: 'FIXTURE', configurationValid: true, benchmarkEligible: false, verifiedValidUniquePosts: 0 };
    },
  };
}
