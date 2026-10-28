# Passive aria-labelledby on HTML SPAN — frozen

28/10/2026 Asia/Bangkok. Implements [the lead dispatch](lead-p02-passive-aria-wrapper-dispatch-2026-10-28.md) after [LIVE v24](../evidence/p02-live-subtree-rejection-v24-2026-10-28.json) identified ATTR_NOT_ALLOWED / SPAN / ARIA_LABELLEDBY / D1. Worker source/UI/LIVE reads0. Shared runtime/dist/profile/.env/master/README/reviewer files untouched.

## Narrow change

The classifier now permits the existing `aria-labelledby` attribute only on HTML SPAN outside SVG, after the existing string type/length, attribute-count and namespace checks. It continues through remaining attributes and all descendants. No other ARIA, style, media, SVG or target rule is expanded. Opening schema5 and operation envelope1 remain.

The attribute value is ignored: no IDREF parsing, getElementById, lookup outside the target or text/time/public/visibility proof. It cannot bypass hidden/transparent/media/control/unknown-child checks. Its value/IDs never enter summaries. Length≤160,≤12attributes,32nodes/depth8, shared2500steps/1s and final R-PF1 action guards remain. `UNIQUE_HEADER_POST_LINK` still requires the existing observed href, public/header/body association, uniqueness, geometry/viewport and unchanged binding/owner/route guards. BLANK remains NEW_WINDOW.

## Verification

Isolated build PASS. **28 focused owner tests PASS**. New full-script cases cover plain/SVG children and varied ignored values (including empty/160characters), with getElementById replaced by a throwing probe. Proof remains UNIQUE_HEADER_POST_LINK and published_at null. Media/control/unknown/hidden/transparent children, another ARIA attribute,161character value, attribute-count limit and BLANK remain zero-action. Attribute mutation after discovery invalidates binding; node/deadline exhaustion remains SCAN_INCOMPLETE. The prior failpoint-equivalence case now uses still-unsupported aria-describedby. Default search/current-post script hashes remain unchanged;46 unchanged reader/verifier tests were not rerun.

**7 focused native scenarios PASS**:

- Passive wrapper with plain text and with real SVG text each1click/1fixed post read; exact original href at click, SVG glyph geometry positive. The runtime isolated-world getElementById probe throws if used, and both complete successfully.
- Passive wrapper containing img remains MEDIA/0click/0read; BLANK remains NEW_WINDOW with SVG_TEXT_ONLY preflight and0actions.
-161character IDREF value remains INCOMPLETE / ATTR_VALUE_LIMIT / ARIA_LABELLEDBY and0actions.
- Changing only aria-labelledby after discovery triggers the native MutationObserver and STALE_TARGET/0actions.
- Deadline reached during CLICK preflight remains SCAN_INCOMPLETE/0click/0read.

All reports have source/external network0, windows0/webContents0 after close and one initial search request (no placeholder reload). IDs/values are absent from summaries. Passive native cases do not claim equivalence with the old classifier, because accepting this one previously rejected attribute is the intended change. No source success or pointer-event cause is inferred from fixtures.

Evidence: `p02-passive-aria-wrapper-{plain,svg,media,blank,limit,stale,time}-2026-10-28.json`. Manifest: `p02-passive-aria-wrapper-files-2026-10-28.json`. Reproduce with the existing build/owner tests and smoke `--search-post-open --search-case=observed-passive-<case>`.

Ready for independent review, then lead activation and a bounded LIVE diagnostic. No automatic pointer activation/hover/scroll/retry was added. Permission UNKNOWN, benchmark OFF, valid0 and source/candidate/identity UNVERIFIED; gates unchanged.
