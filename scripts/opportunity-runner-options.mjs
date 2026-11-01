const platforms = ['threads', 'facebook'];
const profileId = value => typeof value === 'string' && /^csd-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Small CLI-only controls; the persisted UI OpportunityConfig schema is unchanged. */
export function parseOpportunityRunnerOptions(config) {
  if (config === null || config === undefined) return {};
  if (typeof config !== 'object' || Array.isArray(config)) throw Error('CAMPAIGN_CONFIG_INVALID');
  const output = {};
  if (config.maxRunMinutes !== undefined) {
    if (!Number.isInteger(config.maxRunMinutes) || config.maxRunMinutes < 1 || config.maxRunMinutes > 240) throw Error('CAMPAIGN_RUN_MINUTES_INVALID');
    output.maxRunMinutes = config.maxRunMinutes;
  }
  if (config.profiles !== undefined) {
    const value = config.profiles;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length
      || Object.keys(value).some(platform => !platforms.includes(platform) || !profileId(value[platform]))) throw Error('CAMPAIGN_PROFILE_SELECTION_INVALID');
    output.profiles = { ...value };
  }
  return output;
}

/** Explicit profiles fail closed instead of silently using a different logged-in account. */
export function selectOpportunityRunnerProfiles(accounts, explicitProfiles) {
  const configured = parseOpportunityRunnerOptions({ profiles: explicitProfiles }).profiles;
  return platforms.map(platform => {
    const expected = configured?.[platform];
    const account = accounts.find(item => item.platform === platform && (expected === undefined || item.id === expected)
      && item.authenticated && !item.persistenceError);
    if (!account) throw Error(platform === 'threads' ? 'THREADS_LOGIN_REQUIRED' : 'FACEBOOK_LOGIN_REQUIRED');
    return { platform, profileId: account.id };
  });
}
