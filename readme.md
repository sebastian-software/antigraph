# Antigraph

You bought a book on Kindle. You'd like the text — to search it properly, translate it, feed it into your own tools, annotate it in a real editor, or simply archive it in a format that outlasts any one reader app. Antigraph gets you there: it drives Kindle Cloud Reader in a browser you signed into yourself and reconstructs the exact text from the glyph and layout data Kindle's own renderer produces, then assembles it into one clean Markdown file per chapter. No page OCR — the characters come straight from the render data; a vision model is consulted just once per book, only to label the font.

**It's not a DRM bypass.** There's no file decryption, no key extraction, no unofficial API. It works with what Kindle already renders to the screen for accounts that legitimately own the book.

**It stays on your machine.** The book's text and page images never leave your laptop. Reconstruction is deterministic and fully local; the single model call per book reads an anonymous grid of font glyph shapes — no book text, not tied to any title — so it can run on a local model (Ollama or MLX-VLM) or an installed coding CLI (Codex or Claude Code). Uploading book pages to cloud providers would be legally murky and, here, unnecessary.

The name is the Ancient Greek _antigraphon_ (ἀντίγραφον) — "a transcript, a copy".

<p>
  <a href="https://github.com/sebastian-software/antigraph/actions/workflows/main.yml"><img alt="CI" src="https://github.com/sebastian-software/antigraph/actions/workflows/main.yml/badge.svg" /></a>
  <a href="./license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

## What you get

After a full run for a book with ASIN `B0090RVGW0` (William Zinsser's _On Writing Well_), `out/B0090RVGW0/` looks roughly like this:

```
out/B0090RVGW0/
├── book.md                          ← 540 kB, single file, full TOC, proper heading hierarchy
├── chapters/
│   ├── 005-1-the-transaction.md     ← self-contained H1 files, one per chapter
│   ├── 006-2-simplicity.md
│   ├── 007-3-clutter.md
│   └── …
├── chapters.json                    ← structured intermediates, in case you want to
├── chapters.cleaned.json              build your own export on top
├── content.json                     ← reconstructed page text, one entry per page
├── glyph-map.json                   ← per-book glyph → character table (cached labelling)
├── metadata.json                    ← title, author, TOC, Kindle position IDs
├── pages/*.webp                     ← page screenshots (visual reference; not the text source)
└── render/                          ← raw Kindle render TAR (glyph outlines, layout, positionId ↔ page map)
```

A chapter file is as plain as you'd hope:

```markdown
# 2. Simplicity

Clutter is the disease of American writing. We are a society
strangling in unnecessary words, circular constructions, pompous
frills and meaningless jargon.
…
```

## Try it

You need Node 22+, a local **Chrome** install (Kindle's reader uses WebGL, which has been flaky in headless VMs — running locally avoids that), a **glyph-labelling backend** (a local vision model — [Ollama](https://ollama.com) or [MLX-VLM](https://github.com/Blaizzy/mlx-vlm) — or an installed Codex/Claude Code CLI; see below), and an Amazon account with the book in its Kindle library.

Antigraph drives Chrome through [`patchright`](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), a Playwright-compatible browser driver. That dependency is intentional: Kindle Cloud Reader is a moving browser app, and reducing obvious automation fingerprinting makes the extract stage less brittle over time. It is still only automating the reader you are signed into yourself; it does not decrypt files or bypass Amazon access controls.

After the package is published, install the CLI from npm:

```sh
npm install -g antigraph
antigraph --help
```

For local development, run it from a checkout:

```sh
git clone https://github.com/sebastian-software/antigraph.git
cd antigraph
pnpm install
```

Running the full pipeline is one command. The first run — when you don't know the book's ASIN yet — opens a real Chrome window so you can sign in (passkey, 2FA, whatever your account needs) and click the book you want. After that, everything stays in the terminal:

```sh
pnpm cli                           # picker → extract → transcribe → markdown
```

Your Chrome session is saved under `out/.auth/data`, so subsequent runs don't prompt for sign-in. The picker prints the ASIN at the top; once you have it, re-running for the same book is direct:

```sh
pnpm cli --asin B0090RVGW0
```

Idempotent by default: if a stage's output already exists, the stage is skipped. So the above is cheap to re-run — only the fast final steps (assemble + cleanup + export) re-do their work. When you've actually changed something early in the pipeline, there are two escape hatches:

```sh
pnpm cli --asin B0090RVGW0 --force-from transcribe   # redo transcription and everything after
pnpm cli --asin B0090RVGW0 --force                   # redo everything from extract
```

Other useful flags: `--engine ollama|mlx|codex|claude` (the glyph-labelling backend), `--model <name>`, `--max-pages 10` (for quick iteration), `--no-headless` (watch Chrome flip pages during debug), `--out-dir <path>`. Run `pnpm cli --help` for the full list.

## How the pipeline is shaped

Internally the run splits into five stages. Each reads one JSON file and writes another — the contract between stages is deliberately boring, so you can inspect (and re-run) any single step without redoing the ones before it:

| Stage        | Reads                   | Writes                               | What it does                                                                                                                                                            |
| ------------ | ----------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extract`    | Kindle Cloud Reader     | `metadata.json`, `pages/`, `render/` | Patchright drives the reader, captures a WebP per page plus Kindle's own metadata (TOC, position IDs, renders).                                                         |
| `transcribe` | `render/` glyph data    | `content.json`, `glyph-map.json`     | Reconstructs each page's text from the render glyphs; a single vision call labels the font. One entry per page.                                                         |
| `assemble`   | `content.json` + TOC    | `chapters.json`                      | Resolves each page's exact positionId range against the render metadata, groups pages into chapters by TOC.                                                             |
| `cleanup`    | `chapters.json`         | `chapters.cleaned.json`              | Pure text transforms: drop duplicated heading lines, merge paragraphs that a page break cut mid-sentence, normalize whitespace. Twenty-two unit tests keep this honest. |
| `export`     | `chapters.cleaned.json` | `chapters/*.md`, `book.md`           | Per-chapter files and one concatenated book, with sensible heading levels and a linked TOC.                                                                             |

`extract` can take twenty minutes on a full novel and skips when its output already exists; `transcribe` is deterministic reconstruction plus one vision call per book, and likewise skips. The last three stages are near-instant, so the CLI always re-runs them — that way changes you make to cleanup logic show up in the Markdown without extra flags.

The intermediate JSON files aren't an implementation detail you should hide — they're the whole point of this shape. If a chapter came out wrong, you can inspect exactly what text was reconstructed for each page (`content.json`), which glyph mapped to which character (`glyph-map.json`), how the TOC mapped to chunks (`chapters.json`), and what the cleanup changed before the Markdown was written (`chapters.cleaned.json`).

## Design and research notes

Antigraph is the result of several access experiments rather than an assumption
that OCR was the only possible route. The living
[content-access comparison](./docs/content-access-approaches.md) records the
results from local KFX/DRMION parsing, macOS Accessibility extraction, native
window OCR, Cloud Reader DOM research, and glyph reconstruction. The durable
choice—reconstructing text from the reader's own render glyphs—is recorded in
[ADR 0002](./docs/adr/0002-reconstruct-text-from-render-glyphs.md), superseding
the earlier page-OCR decision in
[ADR 0001](./docs/adr/0001-use-rendered-page-capture-and-local-ocr.md). Notes on
the glyph-labelling backend live in
[the backend findings](./docs/ocr-backends.md).

## The glyph-labelling backend

Reconstruction is deterministic, but it has to learn which shape is which
character once per book. Antigraph clusters the book's glyphs into ~100 unique
templates, lays them out in a numbered grid, and asks a vision model to read the
grid in a single call. That grid holds only isolated font shapes — no book text,
not tied to any title — so where it runs is a convenience choice, not a privacy
one.

| `--engine`         | What it is                        | Notes                                                                                    |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------- |
| `ollama` (default) | local vision model                | cross-platform; pull a vision model (e.g. `glm-ocr`), runs anywhere Ollama does.         |
| `mlx`              | local vision model, Apple Silicon | [MLX-VLM](https://github.com/Blaizzy/mlx-vlm) native Apple-Silicon path.                 |
| `codex`, `claude`  | an installed coding CLI           | no local model server; frontier vision reads the grid very reliably, ligatures included. |

If you already have the Codex or Claude Code CLI, that's the least setup:

```sh
pnpm cli --asin <ASIN> --engine codex
```

To run a local model instead, start with Ollama:

```sh
brew install ollama                 # or https://ollama.com/download
ollama serve &
ollama pull glm-ocr
pnpm cli --asin <ASIN> --engine ollama
```

On Apple Silicon, MLX-VLM is the native path:

```sh
pip install mlx-vlm
python -m mlx_vlm.server --model mlx-community/PaddleOCR-VL-1.5-bf16 &
pnpm cli --asin <ASIN> --engine mlx
```

Comparative notes on the backends live in [docs/ocr-backends.md](./docs/ocr-backends.md).

## Things it doesn't do

Honest list, no sales pitch:

- **The very first page of some chapters can get lost.** Kindle Cloud Reader occasionally skips the page immediately after a TOC anchor when navigating forward programmatically. You'll see this in the output as a chapter starting mid-sentence.
- **Figures, photos, diagrams don't survive.** Pages with images are reconstructed as text only.
- **Glyph labelling can mislabel.** Reconstruction is exact once the font is labelled, but the single labelling pass can occasionally get a rare glyph wrong — it shows up as a wrong character, or `�` when a template goes unlabelled. Amazon re-randomizes glyph IDs per render chunk, so the font is re-learned a few times per book.
- **WebGL is required.** Headless VMs without GPU tend to render blank pages. Run on your actual machine.
- **Browser automation is intentionally conservative.** The extract stage uses `patchright`, not upstream Playwright. If that dependency looks unusual, it is deliberate: Kindle Cloud Reader can change or become more sensitive to automation. Swapping it requires a real-book extraction check, not just unit tests.

## Project health

The npm package is built with [tsdown](https://tsdown.dev/) into `dist/`. The published CLI entry is `antigraph`, backed by `dist/cli.js`; the library entry exports the stage runners from `dist/public-api.js`.

Quality gates:

- `pnpm test` runs formatting, ESLint with zero warnings, TypeScript, and unit tests.
- `pnpm test:coverage` runs Vitest coverage with an initial 70% threshold over deterministic modules.
- `pnpm build` bundles the CLI and typed library entry with tsdown.
- `pnpm pack:smoke` packs and unpacks the tarball, checks `antigraph --help`, and verifies selected public API exports through the packaged entry points.
- GitHub Actions runs the same checks on pushes and pull requests for Node 22 and 24.
- Dependabot watches npm and GitHub Actions dependencies.

Releases are automated through `.github/workflows/publish.yml`:

1. Merge Conventional Commits to `main`.
2. Release Please opens or updates a release PR with the version bump and `CHANGELOG.md`.
3. Merge the release PR.
4. The same workflow publishes from GitHub Actions on Node 24 using npm Trusted Publishing. No `NPM_TOKEN` is required.

## Legal

Intended for personal and educational use, on content you own. Not endorsed by Amazon. Please don't redistribute exported text — authors and publishers deserve to get paid. The point of this tool is that you can use content you already bought in your own workflows, not that you can leak it.

## Lineage

Antigraph started as a divergent fork of [`transitive-bullshit/kindle-ai-export`](https://github.com/transitive-bullshit/kindle-ai-export), which shipped an AZW3-file-based pipeline producing PDF, EPUB, and AI-narrated audiobooks. After the AZW3 path stopped working against current Kindle builds, the fork was rebuilt with Markdown as the canonical output — first around page OCR, then around deterministic glyph reconstruction from the reader's own render data. This repository is the clean-slate result of that rewrite — most of what's under `src/` was written here from scratch (glyph reconstruction, chapter assembly, the deterministic cleanup, the CLI). The Playwright-style page-capture code in `src/extract-kindle-book.ts` is structurally derivative of the upstream's approach; the upstream's MIT-license copyright is retained in [`license`](./license) for that reason.

## License

MIT — see [`license`](./license).
