# Architecture decision records

Architecture decision records (ADRs) capture decisions that should remain
understandable after the surrounding experiments and repositories have been
archived.

Accepted ADRs are historical records. Do not rewrite one when the decision
changes; add a new ADR that supersedes it. Small factual corrections may be
made in place when they do not alter the decision.

## Status values

- **Proposed** — under discussion
- **Accepted** — current decision
- **Superseded** — replaced by a later ADR
- **Rejected** — considered but not adopted

## Records

| ADR                                                       | Status             | Decision                                                         |
| --------------------------------------------------------- | ------------------ | ---------------------------------------------------------------- |
| [0001](./0001-use-rendered-page-capture-and-local-ocr.md) | Superseded by 0002 | Use authenticated Cloud Reader page capture and local OCR        |
| [0002](./0002-reconstruct-text-from-render-glyphs.md)     | Accepted           | Reconstruct book text from render glyph data instead of page OCR |
