import type { Platform } from '../../shared/production-api.js';

// Only main sees cookie values; the collector also checks server login/challenge responses.
export function hasAuthenticationCookies(platform: Platform, cookies: {
  name: string; value: string; domain?: string; expirationDate?: number;
}[], now = Date.now() / 1000): boolean {
  const root = platform === 'facebook' ? 'facebook.com' : 'threads.com';
  const names = new Set(cookies.filter(cookie => {
    const domain = cookie.domain?.replace(/^\./, '') || '';
    return (domain === root || domain === 'www.' + root) && cookie.value.length > 0 &&
      (cookie.expirationDate === undefined || cookie.expirationDate > now);
  }).map(cookie => cookie.name));
  return platform === 'facebook' ? names.has('c_user') && names.has('xs') : names.has('sessionid') && names.has('ds_user_id');
}
