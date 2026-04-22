# Contributing

Thanks for looking! This is a small personal fork, but contributions are welcome.

## Setup

```sh
git clone https://github.com/sebastian-software/antigraph.git
cd antigraph
pnpm install
```

You need **Node 20+**, [pnpm](https://pnpm.io), and a working local **Chrome** install. To actually exercise the pipeline end-to-end you also need a Kindle library with something in it and a local OCR model running — either [Ollama](https://ollama.com) or [MLX-VLM](https://github.com/Blaizzy/mlx-vlm). See the [readme](./readme.md#picking-an-ocr-backend) for setup details.

## Development loop

```sh
pnpm test            # format + lint + typecheck + unit tests
pnpm test:unit       # only the Vitest suite (fastest)
pnpm test:lint       # eslint .
pnpm test:typecheck  # tsc --noEmit

pnpm cli --help      # run the CLI from source via tsx
pnpm cli --asin B0090RVGW0 --max-pages 3   # smoke-run a previously-extracted book
```

The pre-commit hook (via `simple-git-hooks` + `lint-staged`) runs Prettier and ESLint on staged files automatically — `pnpm install` sets it up.

## Project layout

```
src/
├── cli.ts                    # single entry point (citty-based); the only file that reads CLI flags
├── extract-kindle-book.ts    # Playwright + Kindle Cloud Reader — exports runExtract(options)
├── transcribe-book-content.ts# OCR loop — exports runTranscribe(options)
├── assemble-chapters.ts      # TOC positionId → chapter boundaries — exports runAssemble(options)
├── chapter-cleanup.ts        # pure text-transform functions (unit-tested)
├── cleanup-chapters.ts       # chapter-cleanup runner — exports runCleanup(options)
├── export-book-markdown.ts   # per-chapter + concatenated markdown — exports runExport(options)
├── compare-ocr-backends.ts   # A/B evaluator — exports runCompare(options)
├── ocr/                      # pluggable local OCR backends (ollama, mlx) + prompts
├── types.ts                  # shared Kindle & Chapter types
├── utils.ts                  # small helpers, all unit-tested
└── *.test.ts                 # vitest suites next to the code they cover
```

Every pipeline stage exports a `run<Stage>(options)` function that accepts a typed options object. The CLI is the only layer that knows about flags and defaults; the stages themselves never read `process.env`. That keeps them easy to invoke from tests or other tools.

The contract between stages is the JSON file one writes and the next reads (see [`## How the pipeline is shaped`](./readme.md#how-the-pipeline-is-shaped) in the readme).

## Submitting changes

1. **Open an issue first** for anything bigger than a small bug fix, especially anything that changes the pipeline contract (the JSON shapes between stages), the OCR backend protocol, or the default model choices.
2. **Write tests for pure functions.** Anything in `chapter-cleanup.ts`, `utils.ts`, or comparable spots. Network-backed stages (extract, transcribe) aren't unit-tested — changes there need manual end-to-end validation on a real book.
3. **Keep commits focused and buildable.** `pnpm test` must pass on every commit. Follow the existing commit-message style (Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, etc.).
4. **One concern per PR.** A backend addition, a bug fix, and a doc cleanup are three PRs, not one.

## Adding an OCR backend

Follow the pattern in `src/ocr/ollama.ts` or `src/ocr/mlx.ts`:

1. Add a new file under `src/ocr/` exporting a `create<Name>Backend(options)` factory that returns an `OcrBackend`. Options shape: `{ baseUrl?, model?, prompt? }`, plus whatever else the backend needs. Export a `<NAME>_DEFAULTS` constant alongside so the CLI can surface defaults in `--help`.
2. Wire it into `src/ocr/index.ts`: extend the `OcrEngine` union, add a `case` in the switch, and include the name in `OCR_ENGINES`.
3. Add a test case in `src/ocr/index.test.ts` covering the backend name and any model override.
4. Document it in the [OCR backends section of the readme](./readme.md#picking-an-ocr-backend) and thread any new CLI flags through `src/cli.ts`.

## Legal note

This project only processes content rendered by Kindle Cloud Reader for accounts that already own the book. Please do not submit changes that aim to bypass DRM, scrape content outside your own library, upload page images to third-party services without explicit opt-in, or otherwise circumvent Amazon's access controls.
