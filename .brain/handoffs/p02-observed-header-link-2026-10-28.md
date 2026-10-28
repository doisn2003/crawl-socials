# Unique observed header post link + bounded SVG text — frozen

28/10/2026 Asia/Bangkok. Implements the [lead dispatch](lead-p02-observed-header-link-dispatch-2026-10-28.md) and latest ADR-016 addition. Worker LIVE/source/UI reads0. Shared dist/runtime/profile/.env/master/README/reviewer files untouched. This does not identify the real Facebook subtree subtype; v22 only established blanket media failure.

## Resulting behavior

Opening schema is **4**; operation envelope remains1 and base search/current-post schemas/hashes remain unchanged. New `UNIQUE_HEADER_POST_LINK` proof is valid only with `href_kind=OBSERVED_POST`. It uses the existing observed Facebook group-post href classifier and exact original DOM target/href binding. No URL construction, navigation substitution or temporal inference. Missing published_at remains null; LABEL/VISIBLE_TEXT/SEMANTIC_TIME are not fabricated.

A structural observed-post fallback must pass the same public-group/body/root/header, author/action/control, rendered/visibility/viewport and binding guards. There must be one eligible target, and exactly one distinct HREF-qualified observed-post target in that public candidate after the existing heading/body/quote exclusions. This is deliberately conservative: a second observed post target cannot be hidden by failing a later media/action check. Duplicate temporal records for one node are deduplicated by node identity. Multiple nodes, even with the same href, remain ambiguous. Existing temporal proofs keep their existing semantics.

The native click still goes to the bound HTMLElement; the existing controller proves the actual main post route in the same owner before one fixed read. Target ABSENT/EMPTY/SELF policy and popup deny remain; BLANK is not permitted. One click/one read,1s/2500steps per script,4s main scan,3shared starts, raw href/stale/subtree observer, owner/route/generation, Stop and barriers remain.

## Subtree guard and facts

The blanket descendant-media query is replaced by a bounded classifier shared by the actual guard and read-only preflight. Shape fields `subtree_kind` (actual guard when reached) and `pf_subtree_kind` (including an earlier target/author/popup rejection) contain only:

`NONE | SVG_TEXT_ONLY | MEDIA | HEADING | CONTROL | SVG_OTHER | UNSUPPORTED | INCOMPLETE | NOT_CHECKED`.

Only NONE/SVG_TEXT_ONLY pass. Actual results are reused by preflight rather than traversed twice. Earlier-rejected HREF-qualified records are classified in preflight using the same remaining budget and no candidate/clip-cache mutation. Existing first decisive stages and≤5 aggregated shapes remain. No raw text/markup/attribute values, URLs/IDs, style values or coordinates are emitted. Unknown/oversized/missing API/cached-clip data is not upgraded to a pass.

Classifier limits:32 descendant nodes, depth8, total text160 characters,12 attributes per element,8 glyph rects; all node/attribute/style/rect operations consume the original shared budget. Overflow/incomplete returns INCOMPLETE and cannot grant an action. R-PF1 final budget guards remain after metadata aggregation and before binding/click.

SVG_TEXT_ONLY is intentionally narrow: one SVG namespace root, only g/text/tspan descendants, optional noninteractive HTML span/br wrappers, and nonempty text directly inside text/tspan. An explicit per-tag attribute allowlist admits bounded class, root namespace/focusable=false, positive dimensions/viewBox, bounded text coordinates/font size and literal safe fills. Unknown namespaces/attributes, event/style attributes, references/use/image/foreignObject, links/controls/roles/tabindex/contenteditable and unknown elements fail closed. Computed URL effects, filters/masks/clips/transforms/background images are rejected across SVG nodes and wrappers/target. Text must have positive finite glyph geometry, lie in viewport and known clip bounds, and have visible fill. SVG without proved visible text is SVG_OTHER, not an image/icon bypass.

## Verification

Isolated build PASS. **22 focused owner tests PASS**, including complete DISCOVER→CLICK scripts for plain/SVG observed post links; wrong proof/href pair; false media/control/heading/unknown SVG/reference/namespace/attribute cases; ambiguity; changed node/href/subtree; viewport/geometry; deadline and full-script2500-step exhaustion; redaction/bounds and existing owner/Stop/barrier lifecycle tests. Some bounds fixtures are rejected by the existing header completeness guard first; the classifier's own bounds are also exercised directly. Default search/current-post accepted hashes stay pinned. The46 unchanged search/current-post/verifier regressions were not rerun.

**20 native scenarios PASS on the final frozen classifier**:

- Plain observed post and actual SVG text each produce UNIQUE_HEADER_POST_LINK and exactly1click/1post read, without a placeholder reload. SVG text has measured positive glyph geometry; href at the click handler equals the original observed href.
- Image, foreignObject, use reference, nested SVG link/control and unknown custom element all0click/0read. BLANK stays NEW_WINDOW/0actions while preflight reports SVG_TEXT_ONLY.
- Two observed links remain ambiguous. Replacing the node, href or only text subtree triggers the native MutationObserver/raw binding fence and yields STALE_TARGET/0actions. Offscreen and18actual client rects remain0actions.
- Pending Stop, challenge added between discovery/click and deadline reached in CLICK preflight all0click/0read. The deadline retains eligibility history but returns SCAN_INCOMPLETE.
- Legacy fragment, irrelevant BLANK with unknown geometry beside a valid timestamp, and combined popup/author/media/action facts keep their prior outcomes; legacy sufficient-budget discovery projection equals frozen v21.

All20 reports: synthetic only, external/source network0, windows0/webContents0 after close, one initial search request. Native observed cases intentionally do not claim equivalence with v21, because the missing structural proof/media whitelist is the behavior being added. No LIVE success or real SVG subtype is claimed.

Evidence: `p02-observed-header-link-{plain,svg,img,foreign,use,control,unknown,ambiguous,stale-node,stale-href,stale-subtree,offscreen,rects,stop,time,blank,barrier,legacy-fragment,legacy-isolation,legacy-facts}-2026-10-28.json`. Manifest: `p02-observed-header-link-files-2026-10-28.json`. Reproduce with the existing isolated build helper, owner test and smoke `--search-post-open --search-case=observed-<case>`; legacy cases retain their existing fixture names.

Ready for independent review, then lead activation and one permitted diagnostic when the observed header is visible. Permission UNKNOWN, benchmark OFF, valid0 and source/candidate/identity UNVERIFIED; no automatic scroll/retry/continuation or gate change.
