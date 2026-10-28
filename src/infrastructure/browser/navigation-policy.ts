export interface BrowserPolicyOptions { fixtureOrigin?: string; manualLoginEnabled: boolean; }
export interface BrowserRequestContext { topLevelUrl: string; resourceType: string; }
export interface OwnedContentsContext { id: number; isDestroyed(): boolean; getURL(): string; }
export function isRecaptchaDependency(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    ['www.google.com', 'www.gstatic.com', 'recaptcha.google.com'].includes(url.hostname) && url.pathname.startsWith('/recaptcha/');
}
// Called only by BrowserHost with its current native WebContents, never by IPC/renderer.
export function ownedRequestContext(contents: OwnedContentsContext | null | undefined, requesterId: number | undefined,
  resourceType: string): BrowserRequestContext | undefined {
  try {
    if (!contents || contents.isDestroyed() || contents.id !== requesterId) return undefined;
    return { topLevelUrl: contents.getURL(), resourceType };
  } catch { return undefined; }
}
export function createBrowserPolicy(options: BrowserPolicyOptions) {
  let fixture: URL | null = null;
  if (options.fixtureOrigin) {
    fixture = new URL(options.fixtureOrigin);
    if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || fixture.username || fixture.password ||
      fixture.pathname !== '/' || fixture.search || fixture.hash) throw new Error('FIXTURE_ORIGIN_INVALID');
  }
  const facebook = (host: string) => host === 'facebook.com' || host.endsWith('.facebook.com');
  const family = (host: string, root: string) => host === root || host.endsWith('.' + root);
  function manualAuthDependency(input: string, context: BrowserRequestContext | undefined, navigation: boolean): boolean {
    if (fixture || !options.manualLoginEnabled || !context) return false;
    try {
      const source = new URL(context.topLevelUrl), target = new URL(input);
      if (source.protocol !== 'https:' || source.username || source.password || source.port || !facebook(source.hostname) ||
        target.protocol !== 'https:' || target.username || target.password || target.port) return false;
      const recaptcha = isRecaptchaDependency(target);
      const recaptchaFrame = recaptcha && target.hostname !== 'www.gstatic.com';
      if (navigation) return context.resourceType === 'subFrame' && (family(target.hostname, 'fbsbx.com') || recaptchaFrame);
      if (recaptcha) return target.hostname === 'www.gstatic.com'
        ? ['script', 'stylesheet', 'image', 'font'].includes(context.resourceType)
        : ['subFrame', 'script', 'xhr', 'stylesheet', 'image', 'font', 'media'].includes(context.resourceType);
      if (family(target.hostname, 'instagram.com')) return context.resourceType === 'xhr';
      return family(target.hostname, 'fbsbx.com') && ['subFrame', 'script', 'stylesheet', 'image', 'font', 'xhr', 'media'].includes(context.resourceType);
    } catch { return false; }
  }
  function permitted(input: string, resource: boolean): boolean {
    if (input === 'about:blank') return true;
    try {
      const url = new URL(input);
      if (url.username || url.password) return false;
      if (fixture) return url.origin === fixture.origin;
      if (!options.manualLoginEnabled || url.protocol !== 'https:' || url.port) return false;
      return facebook(url.hostname) || (resource && (url.hostname === 'fbcdn.net' || url.hostname.endsWith('.fbcdn.net')));
    } catch { return false; }
  }
  return {
    navigationAllowed: (url: string, context?: BrowserRequestContext) => permitted(url, false) || manualAuthDependency(url, context, true),
    resourceAllowed: (url: string, context?: BrowserRequestContext) => permitted(url, true) || manualAuthDependency(url, context, false),
    cookieUrl(domain: string, path: string, secure: boolean): string | null {
      const host = domain.replace(/^\./, '');
      if (!host || /[^a-z0-9.-]/i.test(host) || !path.startsWith('/')) return null;
      if (fixture) return host === fixture.hostname && !secure ? fixture.origin + path : null;
      return facebook(host) ? 'https://' + host + path : null;
    },
    fixtureOrigin: fixture?.origin || null,
  };
}
