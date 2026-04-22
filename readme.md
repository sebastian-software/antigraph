# Antigraph

You bought a book on Kindle. You'd like the text — to search it properly, translate it, feed it into your own tools, annotate it in a real editor, or simply archive it in a format that outlasts any one reader app. Antigraph gets you there: it drives Kindle Cloud Reader in a browser you signed into yourself, snapshots every page, runs those images through a local OCR model, and assembles the result into one clean Markdown file per chapter.

**It's not a DRM bypass.** There's no file decryption, no key extraction, no unofficial API. It works with what Kindle already renders to the screen for accounts that legitimately own the book.

**It stays on your machine.** OCR runs locally through Ollama or MLX-VLM — the page screenshots never leave your laptop. Uploading book pages to cloud providers would be convenient, but also legally murky and unnecessary given how good the current crop of local OCR models has gotten.

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
├── content.json                     ← raw OCR output, one entry per page
├── metadata.json                    ← title, author, TOC, Kindle position IDs
├── pages/*.webp                     ← the page screenshots the pipeline captured
└── render/                          ← raw Kindle render TAR contents (positionId ↔ page map)
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

You need Node 20+, [pnpm](https://pnpm.io), a local **Chrome** install (Kindle's reader uses WebGL, which has been flaky in headless VMs — running locally avoids that), a running local OCR model ([Ollama](https://ollama.com) or [MLX-VLM](https://github.com/Blaizzy/mlx-vlm) — see below), and an Amazon account with the book in its Kindle library.

```sh
git clone https://github.com/sebastian-software/antigraph.git
cd antigraph
pnpm install
```

Running the full pipeline is one command. The first run — when you don't know the book's ASIN yet — opens a real Chrome window so you can sign in (passkey, 2FA, whatever your account needs) and click the book you want. After that, everything stays in the terminal:

```sh
pnpm cli                           # picker → extract → OCR → markdown
```

Your Chrome session is saved under `out/.auth/data`, so subsequent runs don't prompt for sign-in. The picker prints the ASIN at the top; once you have it, re-running for the same book is direct:

```sh
pnpm cli --asin B0090RVGW0
```

Idempotent by default: if a stage's output already exists, the stage is skipped. So the above is cheap to re-run — only the fast final steps (assemble + cleanup + export) re-do their work. When you've actually changed something early in the pipeline, there are two escape hatches:

```sh
pnpm cli --asin B0090RVGW0 --force-from transcribe   # redo OCR and everything after
pnpm cli --asin B0090RVGW0 --force                   # redo everything from extract
```

Other useful flags: `--engine ollama|mlx`, `--model <name>`, `--format plain|markdown`, `--max-pages 10` (for quick iteration), `--no-headless` (watch Chrome flip pages during debug), `--out-dir <path>`. Run `pnpm cli --help` for the full list.

## How the pipeline is shaped

Internally the run splits into five stages. Each reads one JSON file and writes another — the contract between stages is deliberately boring, so you can inspect (and re-run) any single step without redoing the ones before it:

| Stage        | Reads                   | Writes                               | What it does                                                                                                                                                            |
| ------------ | ----------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extract`    | Kindle Cloud Reader     | `metadata.json`, `pages/`, `render/` | Playwright drives the reader, captures a WebP per page plus Kindle's own metadata (TOC, position IDs, renders).                                                         |
| `transcribe` | `pages/*.webp`          | `content.json`                       | Runs the configured OCR backend over every page. One entry per page.                                                                                                    |
| `assemble`   | `content.json` + TOC    | `chapters.json`                      | Resolves each page's exact positionId range against the render metadata, groups pages into chapters by TOC.                                                             |
| `cleanup`    | `chapters.json`         | `chapters.cleaned.json`              | Pure text transforms: drop duplicated heading lines, merge paragraphs that a page break cut mid-sentence, normalize whitespace. Twenty-two unit tests keep this honest. |
| `export`     | `chapters.cleaned.json` | `chapters/*.md`, `book.md`           | Per-chapter files and one concatenated book, with sensible heading levels and a linked TOC.                                                                             |

`extract` and `transcribe` can each take twenty minutes on a full novel and skip when their outputs already exist. The last three are near-instant, so the CLI always re-runs them — that way changes you make to cleanup logic show up in the Markdown without extra flags.

The intermediate JSON files aren't an implementation detail you should hide — they're the whole point of this shape. If a chapter came out wrong, you can inspect exactly what OCR read from each page (`content.json`), how the TOC mapped to chunks (`chapters.json`), and what the cleanup changed before the Markdown was written (`chapters.cleaned.json`).

## Picking an OCR backend

Two local backends. Both receive page images over HTTP from a server you run yourself:

| `--engine` | Platform                 | Notes                                                                                                                                   |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ollama`   | cross-platform (default) | Pull `glm-ocr` (0.9B, leads OmniDocBench). Runs anywhere Ollama does.                                                                   |
| `mlx`      | Apple Silicon            | [MLX-VLM](https://github.com/Blaizzy/mlx-vlm) — typically noticeably faster than Ollama on the same weights, native Apple-Silicon path. |

Cloud-hosted backends were considered and explicitly left out: uploading page screenshots of copyrighted books to third-party providers is legally murky, and measurements didn't show them beating OCR-tuned local models like `glm-ocr` or `PaddleOCR-VL` on accuracy. Running notes on what we measured live in [docs/ocr-backends.md](./docs/ocr-backends.md).

If you've never run a local model, start with `ollama`:

```sh
brew install ollama                 # or https://ollama.com/download
ollama serve &
ollama pull glm-ocr
# then:
pnpm cli --asin <ASIN> --engine ollama
```

On Apple Silicon, MLX-VLM is the faster path:

```sh
pip install mlx-vlm
python -m mlx_vlm.server --model mlx-community/PaddleOCR-VL-1.5-bf16 &
# then:
pnpm cli --asin <ASIN> --engine mlx
```

When you want to compare a couple of models head-to-head on the same pages:

```sh
pnpm compare --asin <ASIN> --engines ollama:glm-ocr,mlx --max-pages 5
```

That writes `out/<asin>/compare.md` (side-by-side Markdown) and `compare.json` (raw). Timings and character counts per backend sit at the top so you can eyeball the speed/quality trade-offs quickly.

## Things it doesn't do

Honest list, no sales pitch:

- **The very first page of some chapters can get lost.** Kindle Cloud Reader occasionally skips the page immediately after a TOC anchor when navigating forward programmatically. You'll see this in the output as a chapter starting mid-sentence.
- **Figures, photos, diagrams don't survive.** Pages with images are transcribed as text only.
- **OCR is imperfect.** Italicisation, curly-quote orientation, page numbers leaking into running text, the occasional dropped footnote — all happen. The cleanup stage handles the common cases; the rest slips through.
- **Second-pass LLM correction was tried and dropped.** A local chat model can't reliably distinguish "this is a mechanical OCR defect" from "the author made a stylistic choice I'd have made differently", and reaching for a larger cloud model defeats the point of keeping the pipeline local.
- **WebGL is required.** Headless VMs without GPU tend to render blank pages. Run on your actual machine.

## Legal

Intended for personal and educational use, on content you own. Not endorsed by Amazon. Please don't redistribute exported text — authors and publishers deserve to get paid. The point of this tool is that you can use content you already bought in your own workflows, not that you can leak it.

## Lineage

Antigraph started as a divergent fork of [`transitive-bullshit/kindle-ai-export`](https://github.com/transitive-bullshit/kindle-ai-export), which shipped an AZW3-file-based pipeline producing PDF, EPUB, and AI-narrated audiobooks. After the AZW3 path stopped working against current Kindle builds, the fork was rebuilt around OCR with Markdown as the canonical output. This repository is the clean-slate result of that rewrite — most of what's under `src/` was written here from scratch (chapter assembly, the multi-backend OCR abstraction, the deterministic cleanup, the CLI). The Playwright page-capture code in `src/extract-kindle-book.ts` is structurally derivative of the upstream's approach; the upstream's MIT-license copyright is retained in [`license`](./license) for that reason.

## License

MIT — see [`license`](./license).
