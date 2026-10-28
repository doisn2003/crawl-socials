import { isBrowserProfileId } from '../domain/browser-profile.js';
export function parseProbeCommand(action: string, args: unknown[]): { action: 'config' | 'status' | 'stop' } | { action: 'start'; profileId: string } {
  if (['config', 'status', 'stop'].includes(action) && args.length === 0) return { action: action as 'config' | 'status' | 'stop' };
  if (action === 'start' && args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const value = args[0] as Record<string, unknown>;
    if (Object.keys(value).join() === 'profileId' && isBrowserProfileId(value.profileId)) return { action, profileId: value.profileId };
  }
  throw new Error('PROBE_INPUT_INVALID');
}
