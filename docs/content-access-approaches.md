# Content access approaches

This document records what the Kindle/e-book experiments actually tried, what
they established, and which parts carried forward into Antigraph. It is a
living research inventory; the durable architecture choice is recorded in
[ADR 0002](./adr/0002-reconstruct-text-from-render-glyphs.md), which supersedes
[ADR 0001](./adr/0001-use-rendered-page-capture-and-local-ocr.md).

The scope is deliberately narrow: personal processing of books already
available to the signed-in user. This is a technical project record, not legal
advice or a set of instructions for circumventing access controls. Historical
worktrees contain account-specific and copyrighted artifacts; none of those
values or files belong in this repository.

## Current approach in one sentence

Antigraph drives the authenticated Kindle Cloud Reader, reconstructs the exact
text from the render TAR's glyph and layout data (labelling the font once with a
single vision call), and combines the result with Kindle's table-of-contents and
position metadata to produce chapter-scoped Markdown.

## Comparison

| Approach                                                   | Useful result                                                                                                                                    | Observed limitation                                                                                                                                                  | Disposition                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downloaded KFX/DRMION containers                           | Catalog, voucher, container metadata, encrypted chunk layout, and a proof-of-concept per-book enrollment path were established.                  | End-to-end content extraction required protected key access; the demonstrated path required SIP to be disabled. The content parser and exporters were not completed. | Closed research path; no Antigraph dependency.                                                                                                                                                                                                        |
| macOS Accessibility text                                   | Some reflowable books expose fast, local `AXValue` text; page turning and stability polling worked through native APIs.                          | Output could be a flattened stream with weak paragraph, heading, emphasis, and fixed-layout fidelity. macOS/Kindle-app specific.                                     | Not a canonical source; possible future validation signal.                                                                                                                                                                                            |
| Accessibility text plus hosted multimodal formatting       | A work-in-progress design combined canonical AX text with page screenshots to recover page structure and Markdown.                               | Requires network credentials and sends book pages to a third party; adds cost, nondeterminism, and failure handling.                                                 | Rejected for Antigraph's local-first pipeline.                                                                                                                                                                                                        |
| Native-app screenshots plus Apple Vision OCR               | Research found a plausible all-local fallback using window capture, native OCR, bounding boxes, and UI automation.                               | Needs visible-window orchestration plus Accessibility and Screen Recording permissions; fine typography and complex layouts remain lossy.                            | Viable macOS fallback idea, not implemented in Antigraph.                                                                                                                                                                                             |
| Cloud Reader semantic DOM scraping                         | Promised real text and HTML structure without local container access.                                                                            | The tested current reader exposes page content through a custom/image renderer, not a stable semantic text DOM.                                                      | Earlier recommendation invalidated by implementation evidence.                                                                                                                                                                                        |
| Cloud Reader render interception plus glyph reconstruction | The render TAR exposes glyph outlines, text runs, and a position-id layout. Reconstructing text needs only a glyph-id → character map.           | A naive per-glyph font-matcher is tightly coupled to font, orientation, spacing, and style — the failure mode the extension prototype hit.                           | Naive matching set aside; a **self-calibrating** variant (cluster the book's own glyphs, label ~100 templates in one vision call) later became the **chosen Antigraph architecture** — [ADR 0002](./adr/0002-reconstruct-text-from-render-glyphs.md). |
| Cloud Reader rendered-page capture plus local OCR          | Page images, TOC, position IDs, and page maps are available in the authenticated reader. Local OCR produces useful text without uploading pages. | OCR is lossy where the render glyph data is exact; per-page inference is heavier.                                                                                    | Chosen first ([ADR 0001](./adr/0001-use-rendered-page-capture-and-local-ocr.md)), then superseded by glyph reconstruction ([ADR 0002](./adr/0002-reconstruct-text-from-render-glyphs.md)).                                                            |
| Downloaded AZW3 file pipeline from the upstream project    | Previously supported direct file-based PDF, EPUB, and audiobook generation.                                                                      | The acquisition path stopped working with current Kindle builds.                                                                                                     | Historical lineage only.                                                                                                                                                                                                                              |

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
render metadata, and the render glyph assets—and ultimately revived glyph
decoding itself, but with a self-calibrating technique (cluster the book's own
glyphs, label ~100 templates in a single vision call) that sidesteps the
per-glyph font-matching fragility this prototype hit. Local page OCR was the
intermediate step between the two (see
[ADR 0001](./adr/0001-use-rendered-page-capture-and-local-ocr.md) →
[ADR 0002](./adr/0002-reconstruct-text-from-render-glyphs.md)).

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

- **Render glyph data is the text source.** Antigraph reconstructs text from the
  render TAR's glyph outlines and position layout; the captured page image is
  kept only as a visual reference.
- **Renderer metadata is structural evidence.** TOC entries, position IDs,
  page maps, and render metadata drive deterministic chapter assembly, and the
  same position layout segments the glyph stream into words and paragraphs.
- **Identification is one small model call.** Glyphs cluster into ~100 templates
  labelled in a single vision pass; that pass runs on a local model (Ollama,
  MLX-VLM) or an installed CLI (Codex, Claude), all behind the same backend
  contract.
- **Intermediate files are part of the design.** The `glyph-map.json` label
  cache and the JSON stage outputs make mapping errors and mislabels observable.
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
- The only model call labels an anonymous glyph grid (no book text) and may run
  locally or via an installed CLI. Adding any backend that processes book
  _pages_ would require a new decision because it changes the privacy model.
- Archived research may contain material that is inappropriate for publication.
  Preserve the archive, but document conclusions rather than secrets,
  credentials, keys, identifiers, or copyrighted book output.

## Open questions and review points

- Can Accessibility text become a secondary cross-check for the reconstructed
  text on macOS without becoming a required dependency?
- Can figures and non-text page regions be retained as linked/cropped assets?
- Can glyph-labelling confidence, and automatic re-labelling of low-confidence
  templates, become more observable?
- Does the Cloud Reader ever expose stable semantic structure that would justify
  bypassing glyph reconstruction for some content types?
- Which real-book smoke tests should guard browser/render changes while keeping
  copyrighted fixtures out of the repository?

## Related documents

- [ADR 0002: Reconstruct book text from render glyph data](./adr/0002-reconstruct-text-from-render-glyphs.md)
- [ADR 0001: Use rendered page capture and local OCR](./adr/0001-use-rendered-page-capture-and-local-ocr.md) (superseded)
- [Glyph-labelling backend notes](./ocr-backends.md)
- [Contributing and project boundaries](../CONTRIBUTING.md)
- [Security and privacy](../SECURITY.md)
