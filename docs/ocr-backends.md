# OCR backend comparison — findings

Living notes from head-to-head runs of our two local OCR backends
(Ollama + MLX-VLM). Not a benchmark — just what we observed so that we
don't have to rediscover it the next time we're picking a default.

Cloud backends (OpenAI, Anthropic, Gemini, Mistral) used to live here
too. They were removed because uploading page screenshots of
copyrighted books to third-party providers is legally murky, and none
of them meaningfully beat the OCR-tuned local models on accuracy.

## Current measured leaders (local, Apple Silicon)

Sample: 10 pages of "On Writing Well" (`out/B0090RVGW0/`), markdown
format, sequential dispatch.

| Backend                                   | Ø ms/page | Chars / 10 pages | Fails |    Disk |
| ----------------------------------------- | --------: | ---------------: | ----: | ------: |
| `mlx:mlx-community/PaddleOCR-VL-1.5-bf16` |  **3818** |           12 850 |  0/10 | ~1.8 GB |
| `ollama:glm-ocr`                          |      4784 |           12 953 |  0/10 |    2 GB |

99.2 % character match, no content-level differences. See
[_same text, different wrappers_](#same-text-different-wrappers) for
where the 103-char gap actually sits.

## Same text, different wrappers

The character counts almost perfectly match, and where they diverge the
difference is **structural markup glm-ocr invents**, not content
PaddleOCR drops. Two concrete examples from the April 2026 sample:

### Page idx 3 — glm-ocr wraps in `<table>`, PaddleOCR doesn't

```diff
-<table><tr><td>considerable precipitation wouldn't think...</td></tr>
-<tr><td>But the secret of good writing is to strip every sentence...</td></tr>
-<tr><td>During the 1960s the president of my university...</td></tr></table>
+considerable precipitation wouldn't think…
+But the secret of good writing is to strip every sentence…
+During the 1960s the president of my university…
```

The book page has three prose paragraphs with no table anywhere.
glm-ocr interprets the paragraph block as a one-column table and emits
HTML for it. PaddleOCR stays bare.

### Page idx 6 — glm-ocr adds ` ```markdown ` code fences

````diff
-```markdown
-ancient rune, making guesses and moving on…
-…
-```
+ancient rune, making guesses and moving on…
+…
````

Our prompt literally says "Do not wrap the output in code fences."
glm-ocr ignores it. PaddleOCR respects it.

### Typography

glm-ocr normalises to curly quotes and em-dashes (`"` → `"`, `'` → `'`,
`-` → `—`). PaddleOCR hands back whatever's in the scan — typically
ASCII straights. Character counts stay the same either way (both are
single codepoints).

## Opinionated take: OCR should do less

A book page is just text in a rectangle. Pressing the model to
"preserve structure" ends up with an overeager glm-ocr hallucinating
tables and code fences that aren't on the page. PaddleOCR's minimalism
is arguably more correct for this use case.

**Proposed separation of concerns:**

| Stage           | Responsibility                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR backend     | Faithful transcription. Preserve words, line breaks, paragraphs. No invented structure. No typography upgrades.                                                   |
| Post-processing | Smart quotes, em-dashes, ligatures — a [SmartyPants](https://daringfireball.net/projects/smartypants/) pass or similar. Deterministic, reversible, easy to audit. |
| Export          | Markdown / EPUB / PDF specifics.                                                                                                                                  |

Under this split, PaddleOCR-VL-1.5 fits the OCR stage as-is and glm-ocr
needs a scrub step to strip invented wrappers before the
post-processing pass would do anything useful. That's not a
dealbreaker but it's an extra chance to get it wrong.

**Caveat:** this stance holds for prose books. For documents with real
tables, forms, or code snippets in the source, glm-ocr's structure
inference would flip from liability to feature. We haven't measured
that case.

## Current leaning

- **Default local backend:** `mlx:mlx-community/PaddleOCR-VL-1.5-bf16`
  (minimal, fast, faithful).
- **Fallback without Python/MLX:** `ollama:glm-ocr` — accept the
  markup wrappers and plan for a post-transcribe scrub if they're a
  problem downstream.

Not yet decided, likely to evolve as we:

- run against a book with actual tables or mixed layout,
- add a SmartyPants-style post-processing step,
- see upstream fixes land (mlx-community GLM-OCR port, qwen3-vl
  prompt sensitivity).

## Other backends tested

| Backend / model                        | Finding                                                                                                                                        | Recommendation                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `mlx:DeepSeek-OCR-8bit`                | 1.5× faster on 9/10 pages but loops into garbage on ~1/10. Safety-rail caps the damage but one page of 10 needs a manual retry. Large (~6 GB). | Only if you need absolute throughput and can tolerate the 10 % hit. |
| `mlx:Qwen2.5-VL-3B-Instruct-4bit`      | Stable but slower (~7s/page). General-purpose VL, not OCR-specialised.                                                                         | Backup when OCR-specific models misbehave on your content.          |
| `mlx-community/GLM-OCR-*` (all quants) | Loads fine, emits 1 token and stops in mlx-vlm 0.4.4.                                                                                          | Avoid until upstream fix.                                           |
| `qwen3-vl:2b-instruct` (Ollama)        | Loops into 20× output on elaborate markdown prompts. Fine with terse prompts.                                                                  | Sensitive to prompt shape, not a convenient drop-in.                |

## When this goes stale

Model versions, mlx-vlm support, and HF ports move fast. This document
snapshots findings from April 2026 against mlx-vlm 0.4.4,
`ollama:glm-ocr` F16 0.9 B, and the listed `mlx-community` ports. Before
acting on anything here in a new session, re-run a small compare:

```sh
ASIN=<some-already-extracted-asin> MAX_PAGES=3 OCR_FORMAT=markdown \
  COMPARE_ENGINES='ollama:glm-ocr,mlx:mlx-community/PaddleOCR-VL-1.5-bf16' \
  pnpm compare
```
