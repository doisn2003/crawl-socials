# R-OH1 + R-OH2 — observed header guard corrections, frozen

28/10/2026 Asia/Bangkok. Supersedes [the first observed-header freeze](p02-observed-header-link-2026-10-28.md). Worker LIVE/source/UI reads0. Shared runtime/dist/profile/master/README and reviewer files untouched. No whitelist or action-scope expansion.

## R-OH1: transparent fill cannot prove SVG ink

The old visibleInk check accepted positive glyph geometry with computed `rgba(..., 0)`. Reviewer reproduced an actual native1click/1read despite transparent glyph fill. Geometry alone was insufficient.

The fixed predicate additionally requires a **supported computed color with positive alpha**. Its bounded parser accepts numeric comma-form rgb(r,g,b) and rgba(r,g,b,a),≤96characters, RGB channels0–255 and alpha0<a≤1 (implicit1 for rgb). Unknown forms, transparent/none/currentColor literals, zero/out-of-range/missing alpha or malformed channels cannot prove ink and return SVG_OTHER. Computed colors outside the supported forms fail closed. The SVG attribute whitelist remains unchanged; an actual currentColor attribute is still allowed only if its computed color satisfies this proof.

The proof read consumes the same remaining work/deadline budget. Existing geometry, clip/style effects, binding and final R-PF1 guards remain. Production facts stay enum-only; no computed color is persisted. Native fixture-only cssFillAlpha is a ZERO/POSITIVE/UNKNOWN enum.

## R-OH2: bounded attribute fallback cannot turn a named target into absent

The old action guard used attr(max160), whose empty fallback for161characters was accidentally accepted as an empty target. The guard now reads getAttribute('target') directly and accepts **only raw null, empty string or exact _self**. Every other raw result is NEW_WINDOW, including oversized strings and other types. There is no truncation, trimming, case normalization or attribute rewrite in this decision. The existing bounded target_kind classifier remains diagnostic only:160-character names report NAMED;161/2048 report INVALID. No raw name is emitted.

Changing target after discovery still invalidates the native observer/raw guard on CLICK; no dispatch follows. BLANK/popup policy, one-click/one-read and native popup deny remain unchanged. Opening schema4 and operation envelope1 remain.

## Verification

Isolated build PASS. **24 focused owner tests PASS**, including full-script alpha supported/transparent/unknown cases, target lengths160/161/2048 and target mutation, plus existing fixed-script budget/owner/Stop/stale/redaction tests. Accepted default search/current-post hashes remain unchanged.

**Both failed reviewer snapshots now PASS** against the current owner compiled modules, copied read-only into the owner test output: `fully transparent computed fill cannot prove visible text` and `oversized named target never becomes absent through bounded attr helper`. Snapshot paths/hashes are in the manifest. These are owner reruns of frozen review repros, not a fresh independent review sign-off.

**9 focused native scenarios PASS** on the combined final fix:

- CSS rgba alpha0 and CSS transparent keyword each have measured positive glyph geometry, native computed ZERO alpha, SVG_OTHER and0click/0read.
- Visible default SVG and CSS rgba alpha0.5 retain SVG_TEXT_ONLY and1click/1read. The positive alpha case records native POSITIVE alpha.
- Named160 and161 characters both NEW_WINDOW,0click/0read, with NAMED/INVALID enums respectively and no raw name in summary. Native target mutation after discovery yields STALE_TARGET/0actions.
- Existing CLICK deadline exhaustion and changed text subtree retain0click/0read.

All native reports: external/source network0, windows0/webContents0 after close, one initial search request (no placeholder reload). The17 other prior native scenarios and46 unchanged search/current-post/verifier tests were not rerun for these narrow fixes. No LIVE target/subtree or source success is claimed.

Evidence: `p02-observed-header-link-guards-{transparent,transparent-keyword,alpha-positive,svg,time,stale-subtree,target160,target161,stale-target}-2026-10-28.json`. Manifest: `p02-observed-header-link-guards-files-2026-10-28.json`. Native cases use the existing smoke `--search-post-open --search-case=observed-<case>`.

Ready for reviewer rerun before activation. Permission UNKNOWN, benchmark OFF, valid0 and source/candidate/identity UNVERIFIED. No runtime restart or source operation performed by worker.
