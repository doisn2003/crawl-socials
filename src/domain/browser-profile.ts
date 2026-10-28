export interface BrowserProfile {
  id: string;
  label: string;
  createdAt: string;
  accountBinding: { status: 'UNVERIFIED'; accountId: null; revision: 0 };
}
export const isBrowserProfileId = (value: unknown): value is string =>
  typeof value === 'string' && /^csd-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function profileLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('PROFILE_INPUT_INVALID');
  const label = value.normalize('NFC').trim();
  if (!label || label.length > 80 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('PROFILE_INPUT_INVALID');
  return label;
}
