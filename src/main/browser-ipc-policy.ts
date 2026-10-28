import { isBrowserProfileId, profileLabel } from '../domain/browser-profile.js';
export type BrowserCommand =
  | { action: 'list' }
  | { action: 'create'; label: string }
  | { action: 'open' | 'close' | 'login'; profileId: string };
export function parseBrowserCommand(action: string, args: unknown[]): BrowserCommand {
  if (action === 'list' && args.length === 0) return { action };
  if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) throw new Error('BROWSER_INPUT_INVALID');
  const payload = args[0] as Record<string, unknown>;
  if (action === 'create' && Object.keys(payload).join() === 'label') return { action, label: profileLabel(payload.label) };
  if (['open', 'close', 'login'].includes(action) && Object.keys(payload).join() === 'profileId' && isBrowserProfileId(payload.profileId)) {
    return { action: action as 'open' | 'close' | 'login', profileId: payload.profileId };
  }
  throw new Error('BROWSER_INPUT_INVALID');
}
