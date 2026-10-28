// Metadata only. Never retain URL/query/fragment, headers, bodies, DOM, identifiers or raw errors.
import { diagnosticRegistrableDomain, DIAGNOSTIC_DOMAIN_POLICY } from './diagnostic-domain.js';
import { isRecaptchaDependency } from './navigation-policy.js';
const exactOrigins = ['https://www.facebook.com', 'https://m.facebook.com', 'https://facebook.com',
  'https://connect.facebook.net', 'https://static.xx.fbcdn.net', 'https://www.gstatic.com',
  'https://www.google.com', 'https://www.recaptcha.net', 'https://accountscenter.facebook.com'] as const;
export const DIAGNOSTIC_KINDS = ['REQUEST_ALLOWED', 'REQUEST_BLOCKED', 'RESOURCE_COMPLETED', 'RESOURCE_FAILED',
  'NAVIGATION_ALLOWED', 'NAVIGATION_BLOCKED', 'NAVIGATION_STARTED', 'NAVIGATION_COMMITTED', 'LOAD_FINISHED',
  'LOAD_FAILED', 'HOST_NAVIGATION_TIMEOUT', 'POPUP_DENIED', 'PERMISSION_DENIED', 'RENDERER_GONE', 'VIEW_CLOSED'] as const;
export type DiagnosticKind = typeof DIAGNOSTIC_KINDS[number];
const resourceTypes = ['mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object', 'xhr', 'ping', 'cspReport', 'media', 'webSocket', 'other'] as const;
const errors = ['net::ERR_ABORTED', 'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_RESPONSE', 'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_CONNECTION_RESET', 'net::ERR_CONNECTION_CLOSED', 'net::ERR_CONNECTION_TIMED_OUT', 'net::ERR_TIMED_OUT',
  'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_DATE_INVALID', 'net::ERR_FAILED',
  'net::ERR_EMPTY_RESPONSE', 'net::ERR_INCOMPLETE_CHUNKED_ENCODING', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_SSL_PROTOCOL_ERROR'] as const;
export type SafeLocation = { origin: string; family: 'FACEBOOK' | 'FBCDN' | 'FACEBOOK_CONNECT' | 'FACEBOOK_SANDBOX'
  | 'META' | 'GOOGLE' | 'RECAPTCHA' | 'HCAPTCHA' | 'ARKOSE' | 'LOOPBACK' | 'OTHER';
  scheme: 'HTTPS' | 'HTTP' | 'WSS' | 'WS' | 'ABOUT' | 'DATA' | 'BLOB' | 'OTHER';
  registrableDomain: string | null;
  pathCategory: 'TWO_STEP_VERIFICATION' | 'LOGIN' | 'CHECKPOINT' | 'RECOVERY' | 'RECAPTCHA' | 'ROOT' | 'OTHER_REDACTED' };
const domain = (host: string, root: string) => host === root || host.endsWith('.' + root);
export function diagnosticLocation(value: unknown): SafeLocation {
  const fallback: SafeLocation = { origin: 'REDACTED_OTHER', family: 'OTHER', scheme: 'OTHER', registrableDomain: null, pathCategory: 'OTHER_REDACTED' };
  if (typeof value !== 'string' || value.length > 32768) return fallback;
  try {
    const url = new URL(value);
    if (url.username || url.password) return fallback;
    const scheme: SafeLocation['scheme'] = url.protocol === 'https:' ? 'HTTPS' : url.protocol === 'http:' ? 'HTTP'
      : url.protocol === 'wss:' ? 'WSS' : url.protocol === 'ws:' ? 'WS'
      : url.protocol === 'about:' ? 'ABOUT' : url.protocol === 'data:' ? 'DATA' : url.protocol === 'blob:' ? 'BLOB' : 'OTHER';
    // Blob inner URLs may contain identifiers; do not parse or serialize the payload.
    if (!['HTTPS', 'HTTP', 'WSS', 'WS'].includes(scheme)) return { ...fallback, scheme };
    const host = url.hostname;
    const family: SafeLocation['family'] = domain(host, 'facebook.com') ? 'FACEBOOK' : domain(host, 'fbcdn.net') ? 'FBCDN'
      : domain(host, 'facebook.net') ? 'FACEBOOK_CONNECT' : domain(host, 'fbsbx.com') ? 'FACEBOOK_SANDBOX'
      : domain(host, 'meta.com') ? 'META' : domain(host, 'google.com') || domain(host, 'gstatic.com') ? 'GOOGLE'
      : domain(host, 'recaptcha.net') ? 'RECAPTCHA' : domain(host, 'hcaptcha.com') ? 'HCAPTCHA'
      : domain(host, 'arkoselabs.com') ? 'ARKOSE' : host === '127.0.0.1' || host === '[::1]' ? 'LOOPBACK' : 'OTHER';
    const pathCategory: SafeLocation['pathCategory'] = isRecaptchaDependency(url) ? 'RECAPTCHA'
      : /^\/two_step_verification(?:\/|$)/.test(url.pathname) ? 'TWO_STEP_VERIFICATION'
      : /^\/login(?:\/|\.php|$)/.test(url.pathname) ? 'LOGIN' : /^\/checkpoint(?:\/|$)/.test(url.pathname) ? 'CHECKPOINT'
      : /^\/(?:recover|recovery)(?:\/|$)/.test(url.pathname) ? 'RECOVERY' : url.pathname === '/' ? 'ROOT' : 'OTHER_REDACTED';
    return { origin: !url.port && (exactOrigins as readonly string[]).includes(url.origin) ? url.origin : 'REDACTED_' + family,
      family, scheme, pathCategory, registrableDomain: diagnosticRegistrableDomain(host) };
  } catch { return fallback; }
}
export interface PolicyDiagnostic {
  sequence: number; at: string; kind: DiagnosticKind; view: number; location: SafeLocation;
  resourceType: string; statusCode: number | null; networkError: string | null; errorCode: number | null;
}
export interface PolicyDiagnosticSnapshot {
  version: 2; domainPolicy: typeof DIAGNOSTIC_DOMAIN_POLICY; purpose: 'MANUAL_SESSION_POLICY_DIAGNOSTICS'; observerEnabled: false; postsCollected: 0;
  startedAt: string; totalEvents: number; droppedOldEvents: number; priorityEventsDropped: number; publishFailures: number;
  counts: Record<string, number>; events: PolicyDiagnostic[]; priorityEvents: PolicyDiagnostic[]; limitations: string[];
}
export function createPolicyDiagnostics(input: { now?: () => number; maxEvents?: number; publish?: (snapshot: PolicyDiagnosticSnapshot) => void } = {}) {
  const max = input.maxEvents ?? 128;
  if (!Number.isSafeInteger(max) || max < 4 || max > 256) throw new Error('DIAGNOSTICS_LIMIT_INVALID');
  let sequence = 0, dropped = 0, priorityDropped = 0, publishFailures = 0;
  const events: PolicyDiagnostic[] = [], counts: Record<string, number> = {};
  const priorityEvents: PolicyDiagnostic[] = [];
  const startedAt = new Date((input.now || Date.now)()).toISOString();
  function snapshot(): PolicyDiagnosticSnapshot {
    return { version: 2, domainPolicy: DIAGNOSTIC_DOMAIN_POLICY, purpose: 'MANUAL_SESSION_POLICY_DIAGNOSTICS' as const, observerEnabled: false as const,
      postsCollected: 0 as const, startedAt, totalEvents: sequence, droppedOldEvents: dropped, priorityEventsDropped: priorityDropped, publishFailures,
      counts: { ...counts }, events: structuredClone(events), priorityEvents: structuredClone(priorityEvents), limitations: ['NO_BODY_HEADERS_QUERY_DOM_OR_CREDENTIALS',
        'EXACT_ORIGIN_ALLOWLIST_PLUS_ICANN_REGISTRABLE_DOMAIN_ONLY', 'PRIVATE_TENANT_LABELS_IP_SPECIAL_USE_AND_OBVIOUS_IDS_WITHHELD',
        'REGISTRABLE_DOMAIN_NOT_OWNERSHIP_REGISTRATION_OR_AUTHORIZATION_PROOF',
        'RING_BUFFER_NOT_COMPLETE_NETWORK_TRACE', 'PATH_CATEGORY_NOT_VERIFICATION_OUTCOME'] };
  }
  function record(kind: DiagnosticKind, details: { url?: unknown; view?: number; resourceType?: unknown; statusCode?: unknown; networkError?: unknown; errorCode?: unknown } = {}) {
    if (!(DIAGNOSTIC_KINDS as readonly string[]).includes(kind)) return;
    const event: PolicyDiagnostic = { sequence: ++sequence, at: new Date((input.now || Date.now)()).toISOString(), kind,
      view: Number.isSafeInteger(details.view) && details.view! > 0 ? details.view! : 0,
      location: diagnosticLocation(details.url),
      resourceType: (resourceTypes as readonly unknown[]).includes(details.resourceType) ? details.resourceType as string : 'other',
      statusCode: typeof details.statusCode === 'number' && Number.isSafeInteger(details.statusCode) && details.statusCode >= 100 && details.statusCode <= 599 ? details.statusCode : null,
      networkError: details.networkError === undefined ? null : (errors as readonly unknown[]).includes(details.networkError) ? details.networkError as string : 'OTHER_REDACTED',
      errorCode: typeof details.errorCode === 'number' && Number.isSafeInteger(details.errorCode) && details.errorCode >= -10000 && details.errorCode <= 0 ? details.errorCode : null };
    counts[kind] = (counts[kind] || 0) + 1;
    if (events.length === max) { events.shift(); dropped++; } events.push(event);
    if (['REQUEST_BLOCKED', 'NAVIGATION_BLOCKED', 'RESOURCE_FAILED', 'LOAD_FAILED', 'HOST_NAVIGATION_TIMEOUT', 'POPUP_DENIED', 'PERMISSION_DENIED', 'RENDERER_GONE'].includes(kind)) {
      if (priorityEvents.length === Math.min(32, max)) { priorityEvents.shift(); priorityDropped++; }
      priorityEvents.push(event);
    }
  }
  return { record, snapshot,
    publish() { try { input.publish?.(snapshot()); } catch { publishFailures++; } },
  };
}
export type PolicyDiagnostics = ReturnType<typeof createPolicyDiagnostics>;
