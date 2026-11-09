export interface BrowserProfile {
  id: string;
  label: string;
  platform?: 'facebook' | 'threads';
  createdAt: string;
  accountBinding: { status: 'UNVERIFIED'; accountId: null; revision: 0 };
}
export const isBrowserProfileId = (value: unknown): value is string =>
  typeof value === 'string' && /^csd-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export function displayProfileLabel(label: string): string {
  return label.replace(/^CSD (?=(?:Facebook|Threads)(?: \d+)?$)/, 'TrendLink ');
}

/** Prefer an exact label so saved collector configs still select the same profile. */
export function profilesByLabel<T extends BrowserProfile>(profiles: T[], label: unknown): T[] {
  if (typeof label !== 'string') return [];
  const exact = profiles.filter(profile => profile.label === label);
  if (exact.length) return exact;
  const displayLabel = displayProfileLabel(label);
  return profiles.filter(profile => displayProfileLabel(profile.label) === displayLabel);
}

export function profileLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('PROFILE_INPUT_INVALID');
  const label = value.normalize('NFC').trim();
  if (!label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('PROFILE_INPUT_INVALID');
  return label;
}
