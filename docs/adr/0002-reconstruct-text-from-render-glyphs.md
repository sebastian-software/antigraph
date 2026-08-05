# ADR 0002: Reconstruct book text from render glyph data instead of page OCR

- **Status:** Accepted — supersedes [ADR 0001](./0001-use-rendered-page-capture-and-local-ocr.md)
- **Date:** 2026-08-05
- **Deciders:** Antigraph maintainers

## Context

[ADR 0001](./0001-use-rendered-page-capture-and-local-ocr.md) chose to capture
each rendered Cloud Reader page as an image and run local OCR over it. That
worked, but inherited OCR's costs: lossy typography, per-page model inference on
the whole book, a local model server (or CLI) to set up, and defects that a
cleanup pass could only partly repair.

While extending the extractor we confirmed that the reader already downloads a
render TAR to `<bookDir>/render/` containing, per chunk: the glyph outlines
(`glyphs.json`), the text runs referencing them by id with x-positions and
font/style (`page_data_*.json`), and a word/paragraph layout skeleton with
position-id ranges (`layout.json`). The characters are therefore already present
as vector shapes plus exact positions — OCR was re-deriving, lossily, data the
reader had handed us.

ADR 0001 had rejected "decode Cloud Reader vector glyphs" because a naive
font-matcher (matching each glyph against reference letterforms) was too coupled
to font, orientation, spacing, and style. A different technique removes that
coupling: instead of matching against an external font, self-calibrate against
the book's _own_ glyphs. Amazon re-randomizes glyph ids and outline coordinates
per render chunk as an anti-scraping measure, so identity cannot be shared across
chunks — but within the book we can rasterize every glyph, cluster the
near-identical shapes into ~100 denoised templates, and label those templates
once. That makes identification a single, cheap, per-book vision call rather than
fragile per-glyph matching, and it validated to near-lossless text on real data.

## Decision

Antigraph reconstructs book text deterministically from the render TAR's glyph
and layout data, and removes the page-OCR transcriber.

For each book, the `transcribe` stage will:

1. rasterize every glyph and cluster the near-identical shapes into ~100
   denoised templates (self-calibration; no external font);
2. label those templates with a **single** vision call over one numbered grid of
   isolated, anonymous glyph shapes — never a book page — and cache the result in
   `<bookDir>/glyph-map.json`;
3. assign every glyph its cluster's character and reconstruct words and
   paragraphs from the `layout.json` position-id ranges (spaces come from
   position gaps, not geometry guessing);
4. write the same `content.json` shape as before, so `assemble → cleanup →
export` run unchanged.

The page-OCR transcriber, the `--transcriber ocr` path, and the OCR-backend A/B
`compare` tooling are removed. Page screenshots are still captured, but as a
visual reference/inspection artifact, not the text source. A vision backend is
retained solely for the grid-labelling call; permitting the `codex`/`claude` CLI
engines there is acceptable because the grid carries no book text (see
[the backend notes](../ocr-backends.md)).

## Decision drivers

- Near-lossless, deterministic text: characters come from the reader's own
  glyph data rather than a lossy OCR re-read.
- One vision call per book instead of per-page inference across the whole book.
- Preserves ADR 0001's boundary — no book-page image is ever sent off-machine;
  the only image sent (if a CLI engine is chosen) is the anonymous glyph grid.
- Keeps the stage contract and JSON intermediates identical, so downstream
  assembly/cleanup/export and the auditable-intermediates design are unchanged.

## Considered options

### Reconstruct from render glyphs with per-book self-calibration — chosen

Deterministic and near-lossless on validation. Overcomes the fragility that got
glyph decoding rejected in ADR 0001 by calibrating against the book's own glyphs
and reducing the model's role to labelling ~100 clustered templates once.

### Keep page capture plus local OCR (ADR 0001) — superseded

Still functional, but lossy where the glyph data is exact, and heavier (per-page
inference, a model server or CLI on the critical path for every page). No longer
the primary path.

### Naive per-glyph font matching — rejected (unchanged from ADR 0001)

Matching each glyph against an external reference font stays too coupled to font,
orientation, spacing, and renderer details. Self-calibration replaces it.

## Consequences

### Positive

- Higher-fidelity text than OCR, produced deterministically.
- The single model dependency shrinks to one anonymous grid-labelling call.
- `codex`/`claude` CLI engines become viable for that call with no local model
  server, because no book text is involved.

### Negative

- New coupling to the render-TAR glyph/layout format; if Amazon changes it, the
  collectors must follow.
- A mislabelled template mislabels every glyph in its cluster (surfaces as a
  wrong character or `�`); the labelling call is the one non-deterministic step.
- Figures and non-text page regions remain out of scope, as before.

## References

- [ADR 0001: Use rendered page capture and local OCR](./0001-use-rendered-page-capture-and-local-ocr.md) (superseded)
- [Content access approaches](../content-access-approaches.md)
- [Glyph-labelling backend notes](../ocr-backends.md)
- [`src/transcribe-glyphs.ts`](../../src/transcribe-glyphs.ts)
- [`src/glyph/`](../../src/glyph/)
