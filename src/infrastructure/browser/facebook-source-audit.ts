// Narrow rule grounded in observed Vietnamese profile headers. User alone is never evidence.
export interface SourceAudit {
  source_url: string; observed_url: string; source_name: string; main_text: string;
  at: string; document_json_sha256: string;
}
export function classifyObservedFacebookSource(audit: SourceAudit): 'PROFILE' | 'UNKNOWN' {
  try {
    const source = new URL(audit.source_url), observed = new URL(audit.observed_url);
    if (source.origin !== 'https://www.facebook.com' || source.username || source.password ||
        source.href !== observed.href || !audit.source_name?.trim() || !Number.isFinite(Date.parse(audit.at))) return 'UNKNOWN';
    const lines = audit.main_text.slice(0,500).split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
    // At the actual source header: exact observed name, numeric friend count, Add Friend control.
    // Pages have follower counts; a Friends tab elsewhere or a quoted phrase is insufficient.
    if (lines[0] !== audit.source_name.trim() || !/^[\d.,]+\s*[KM]? người bạn$/.test(lines[1] ?? '') ||
        !lines.slice(2,5).includes('Thêm bạn bè')) return 'UNKNOWN';
    return 'PROFILE';
  } catch { return 'UNKNOWN'; }
}
