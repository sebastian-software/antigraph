# Content access approaches

This document records what the Kindle/e-book experiments actually tried, what
they established, and which parts carried forward into Antigraph. It is a
living research inventory; the durable architecture choice is recorded in
[ADR 0001](./adr/0001-use-rendered-page-capture-and-local-ocr.md).

The scope is deliberately narrow: personal processing of books already
available to the signed-in user. This is a technical project record, not legal
advice or a set of instructions for circumventing access controls. Historical
worktrees contain account-specific and copyrighted artifacts; none of those
values or files belong in this repository.

## Current approach in one sentence

Antigraph drives the authenticated Kindle Cloud Reader, captures each
already-rendered page as an image, performs OCR locally, and combines the result
with Kindle's table-of-contents and position metadata to produce chapter-scoped
Markdown.

## Comparison

| Approach | Useful result | Observed limitation | Disposition |
| --- | --- | --- | --- |
| Downloaded KFX/DRMION containers | Catalog, voucher, container metadata, encrypted chunk layout, and a proof-of-concept per-book enrollment path were established. | End-to-end content extraction required protected key access; the demonstrated path required SIP to be disabled. The content parser and exporters were not completed. | Closed research path; no Antigraph dependency. |
| macOS Accessibility text | Some reflowable books expose fast, local `AXValue` text; page turning and stability polling worked through native APIs. | Output could be a flattened stream with weak paragraph, heading, emphasis, and fixed-layout fidelity. macOS/Kindle-app specific. | Not a canonical source; possible future validation signal. |
| Accessibility text plus hosted multimodal formatting | A work-in-progress design combined canonical AX text with page screenshots to recover page structure and Markdown. | Requires network credentials and sends book pages to a third party; adds cost, nondeterminism, and failure handling. | Rejected for Antigraph's local-first pipeline. |
| Native-app screenshots plus Apple Vision OCR | Research found a plausible all-local fallback using window capture, native OCR, bounding boxes, and UI automation. | Needs visible-window orchestration plus Accessibility and Screen Recording permissions; fine typography and complex layouts remain lossy. | Viable macOS fallback idea, not implemented in Antigraph. |
| Cloud Reader semantic DOM scraping | Promised real text and HTML structure without local container access. | The tested current reader exposes page content through a custom/image renderer, not a stable semantic text DOM. | Earlier recommendation invalidated by implementation evidence. |
| Cloud Reader render interception plus glyph reconstruction | A browser extension intercepted renderer responses, unpacked render assets, and attempted to match vector glyph shapes back to characters. | Character recovery was tightly coupled to font rendering, glyph orientation, spacing, style, and renderer details. | Prototype superseded by image capture plus OCR. |
| Cloud Reader rendered-page capture plus local OCR | Page images, TOC, position IDs, and page maps are available in the authenticated reader. Local OCR produces useful text without uploading pages. | OCR is lossy and browser automation is brittle; images, tables, formulas, footnotes, and typography need further work. | **Chosen Antigraph architecture.** |
| Downloaded AZW3 file pipeline from the upstream project | Previously supported direct file-based PDF, EPUB, and audiobook generation. | The acquisition path stopped working with current Kindle builds. | Historical lineage only. |

## What each legacy project contributed

### `kindle-reader`

The local-container research answered a useful question even though it did not
become the product:

- local catalog discovery and inventory can work without special privileges;
- KFX/DRMION voucher and container structures can be parsed independently of
  content access;
- the tested client keeps the usable per-book key behind operating-system and
  application security boundaries;
- the only demonstrated enrollment route depended on debugger access available
  with SIP disabled;
- because that prerequisite failed the stock-macOS constraint, the downstream
  content parser and Markdown/ePub exporters were intentionally not built.

The repo's final recommendation favored Cloud Reader or UI OCR. Its Cloud
Reader DOM assumption was later corrected by the Antigraph and extension
experiments.

Reviewed source state: `swernerx/kindle-reader` at commit `4302bcd`.

### `kindle-extract`

This project explored the Kindle for macOS Accessibility surface:

- a native addon discovered books, read page-level Accessibility values, sent
  page-turn events, and waited for stable content;
- the fast mode was local, but its formatter had to infer headings, whitespace,
  footnotes, and hyphenation from a semantically weak text stream;
- unfinished rich-mode work combined AX text with captured page images and a
  configurable multimodal API, including confidence and fallback handling;
- the architectural lesson was that Accessibility is a valuable text signal,
  but not a sufficiently portable or structure-preserving primary source.

Reviewed source state: local archival branch `archive/final-working-tree` at
`4fd9c8c`. It contains the unfinished working tree and is based on local `main`
at `61e3211` (three commits ahead of the archived remote `main`).

### `ebook-reader-extension`

The browser-extension prototype attached to the Cloud Reader renderer, observed
render responses, unpacked their assets, and tried to recover characters from
custom vector glyph paths by rendering and comparing reference characters.
This proved that render assets and metadata could be observed, but also exposed
the maintenance cost of treating private glyph encodings as a text API. Small
font, orientation, whitespace, and style differences materially affected the
decoder.

Antigraph retained the useful side of this experiment—browser automation,
render metadata, and already-rendered page imagery—while replacing custom glyph
decoding with local OCR.

Reviewed source state: local archival branch `archive/final-working-tree` at
`1dd360a`, based on `a1bf50b` plus the final glyph-matching experiment.

### `ebook-reader-drm`

This was an uncommitted reverse-engineering workspace around the current Kindle
application, existing DeDRM tools, local containers, keychain behavior, and
small decoding experiments. It established that the current format/client did
not fit the older tooling directly and that the required protected material was
not available through an acceptable stock-system workflow.

The workspace also contains sensitive and account-specific research artifacts.
It remains a local-only archive and must not be pushed, copied into issues, or
used as documentation source material beyond the high-level conclusions above.

### Upstream `kindle-ai-export`

Antigraph began as a divergent fork of the upstream TypeScript project. The
original file-based AZW3 acquisition path no longer worked against current
Kindle builds, but its browser/page-capture lineage informed the clean-slate
rewrite. Antigraph retains the applicable upstream MIT notice.

## What carried forward into Antigraph

The legacy projects were not merged wholesale. Their durable lessons became a
smaller set of boundaries and pipeline contracts:

- **Rendered page image is the text source.** Antigraph currently captures the
  browser-created image blob, with an element screenshot available as a
  fallback implementation.
- **Renderer metadata is structural evidence.** TOC entries, position IDs,
  page maps, and render metadata drive deterministic chapter assembly even
  though the page text comes from OCR.
- **OCR is local and replaceable.** Ollama and MLX-VLM implement the same stage
  contract; backend comparisons can reuse the exact captured pages.
- **Intermediate files are part of the design.** Saved WebP pages and JSON
  stage outputs make missing pages, mapping errors, and OCR defects observable.
- **Markdown is canonical.** The goal is useful, inspectable text rather than a
  recreation of Kindle's internal container or rendering engine.
- **Cleanup is deterministic.** Page-boundary joins, duplicate headings, and
  whitespace normalization stay in tested code rather than an opaque second
  LLM pass.

## Boundaries that should remain explicit

- Antigraph operates on books already rendered for the authenticated user.
- It does not decrypt downloaded Kindle files or extract content keys.
- Authentication data, captured pages, and exported text stay out of version
  control.
- OCR backends are local by default; adding a hosted page-processing backend
  would require a new decision because it changes the privacy model.
- Archived research may contain material that is inappropriate for publication.
  Preserve the archive, but document conclusions rather than secrets,
  credentials, keys, identifiers, or copyrighted book output.

## Open questions and review points

- Can Accessibility text become a secondary cross-check for OCR on macOS
  without becoming a required dependency?
- Can figures and non-text page regions be retained as linked/cropped assets?
- Can OCR confidence and page-level retry policy become more observable without
  introducing a generative correction pass?
- Does the Cloud Reader ever expose stable semantic structure that would justify
  replacing OCR for some content types?
- Which real-book smoke tests should guard browser/render changes while keeping
  copyrighted fixtures out of the repository?

## Related documents

- [ADR 0001: Use rendered page capture and local OCR](./adr/0001-use-rendered-page-capture-and-local-ocr.md)
- [OCR backend comparison](./ocr-backends.md)
- [Contributing and project boundaries](../CONTRIBUTING.md)
- [Security and privacy](../SECURITY.md)
