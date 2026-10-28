import { parse } from 'tldts';

export const DIAGNOSTIC_DOMAIN_POLICY = 'TLDTS_7.4.19_ICANN_BASE_ONLY_V1';

// Input is only WHATWG URL.hostname, never a URL/header/body. This value is a
// diagnostic identifier, never a navigation/resource allowlist decision.
export function diagnosticRegistrableDomain(hostname: string): string | null {
  if (hostname.length > 253 || !/^[a-z0-9.-]+$/.test(hostname) || hostname.endsWith('.')) return null;
  const result = parse(hostname, { allowIcannDomains: true, allowPrivateDomains: false,
    extractHostname: false, validateHostname: true, detectIp: true, detectSpecialUse: true });
  if (!result.domain || result.isIcann !== true || result.isPrivate === true || result.isIp || result.isSpecialUse) return null;
  // Retain no subdomain/tenant labels, including the PRIVATE part of the PSL.
  // Conservatively withhold IDN and obvious identifier-like registrant labels.
  const label = result.domainWithoutSuffix;
  if (!label || label.length > 48 || !/^[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(label) || result.domain.includes('xn--') ||
    result.domain.split('.').some(part => /\d{6}/.test(part) || /^[a-f0-9-]{16,}$/.test(part) ||
      /(?:^|-)(?:token|session|account|userid|user-id)(?:-|\d)/.test(part))) return null;
  return result.domain;
}
