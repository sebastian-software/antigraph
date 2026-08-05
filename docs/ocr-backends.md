# Glyph-labelling backend — notes

Antigraph reconstructs book text deterministically from the Kindle render
glyphs; the only model call is labelling one grid of ~100 isolated glyph
templates per book (see
[ADR 0002](./adr/0002-reconstruct-text-from-render-glyphs.md)). These are living
notes on which vision backend to use for that single call — not a benchmark,
just what we observed so we don't rediscover it next time.

## Backends and the privacy boundary

The glyph grid holds only **isolated, anonymous font shapes** — no book text,
not tied to any title. That is what makes the backend choice a convenience, not a
privacy, decision:

| `--engine`        | What it is                            | What it sees                             |
| ----------------- | ------------------------------------- | ---------------------------------------- |
| `ollama`, `mlx`   | local model servers                   | stays on your machine                    |
| `codex`, `claude` | shells out to an installed coding CLI | sends the glyph grid to that CLI's model |

Because the grid carries no book text, sending it to a frontier model is fine —
and frontier vision reads the grid more reliably than a small local model
(ligatures included), with no local model server to set up. The boundary worth
keeping: the label grid is the _only_ image Antigraph ever sends anywhere, and it
is never a book page. There is no page-OCR path that would upload page images.

## Which backend

- **Least setup:** `codex` or `claude`, if you already have the CLI installed.
  Frontier vision labels the ~100-cell grid in one call and handles ligatures
  (fl/fi/ff/ffl) and curly quotes cleanly.
- **Fully local:** `ollama` (cross-platform) or `mlx` (Apple-Silicon native).
  Pull a vision/OCR model such as `glm-ocr` (Ollama) or
  `mlx-community/PaddleOCR-VL-1.5-bf16` (MLX-VLM). A small local model is enough
  for a grid of clean, well-separated glyphs, though it is more sensitive to
  prompt shape than a frontier model.

### Typography note

Some models normalise straight quotes and hyphens to curly quotes and em-dashes.
For the label grid this is harmless — each cell is a single character — but it is
worth knowing when a backend's output looks subtly different from the raw glyph.

## When this goes stale

Model versions and CLI behaviour move fast. If labelling quality drops, relabel a
book from scratch and eyeball the result:

```sh
pnpm cli --asin <ASIN> --engine <engine> --force-from transcribe --max-pages 3
```

The per-book label cache lives at `out/<asin>/glyph-map.json`; deleting it (or
`--force-from transcribe`) forces a relabel.
