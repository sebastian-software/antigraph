# Changelog

## [1.0.0](https://github.com/sebastian-software/antigraph/compare/v0.1.2...v1.0.0) (2026-11-23)


### ⚠ BREAKING CHANGES

* **deps:** lint-staged v17 requires Node >= 22.22.1 and Git >= 2.32.0.
* **deps:** npm-run-all2 v9 is ESM-only and requires Node ^22.22.2 || ^24.15.0 || >=26 for the dev toolchain.
* **deps:** @types/node v26 tracks Node.js 26 API typings.
* the compare subcommand and the --transcriber, --format, --prompt, and --allow-partial flags are removed; the library no longer exports runTranscribe, TranscribeOptions, runCompare, the compare constants, or OcrFormat. Use runGlyphTranscribe.

### Features

* reconstruct book text from render glyphs instead of page OCR ([#23](https://github.com/sebastian-software/antigraph/issues/23)) ([fa20cd3](https://github.com/sebastian-software/antigraph/commit/fa20cd3166d5ea0dbef112bf26964b8492e0d27b))


### Bug Fixes

* update deps ([0e38003](https://github.com/sebastian-software/antigraph/commit/0e38003382041866e98b1a4061d9123d450b1363))


### Miscellaneous Chores

* **deps:** update @types/node to 26.1.2 ([4f9cf04](https://github.com/sebastian-software/antigraph/commit/4f9cf0445d1aad21803f30b33e921b2be47dd87a))
* **deps:** update lint-staged to 17.3.0 ([096d841](https://github.com/sebastian-software/antigraph/commit/096d84113f9589b0a47344b752f90f3fcb80af2c))
* **deps:** update npm-run-all2 to 9.0.3 ([709ebc4](https://github.com/sebastian-software/antigraph/commit/709ebc47228c7247b6688fd0bbf6c2216fd7acb1))

## [0.1.2](https://github.com/sebastian-software/antigraph/compare/v0.1.1...v0.1.2) (2026-04-28)


### Bug Fixes

* run cli through npm bin symlinks ([8ceccf0](https://github.com/sebastian-software/antigraph/commit/8ceccf0978d7386135b2d0dffaecefdee1f2bc5a))

## [0.1.1](https://github.com/sebastian-software/antigraph/compare/v0.1.0...v0.1.1) (2026-04-28)


### Bug Fixes

* trigger release preparation ([f9044de](https://github.com/sebastian-software/antigraph/commit/f9044de40bf5a0e4a229249fc67f377e4ef5b396))

## [0.1.0](https://github.com/sebastian-software/antigraph/compare/v0.0.1...v0.1.0) (2026-04-28)


### Features

* **assemble+cleanup:** pages → chapters → normalized text ([ad6edbf](https://github.com/sebastian-software/antigraph/commit/ad6edbfeec225e8d9cbd10574cfcb851d2ee6ed3))
* **cli:** single `antigraph` entry point orchestrating the pipeline ([95dc627](https://github.com/sebastian-software/antigraph/commit/95dc62766c8090bb8aebe0c4f80cd5f179934bd1))
* **compare:** head-to-head OCR backend evaluator ([fe25681](https://github.com/sebastian-software/antigraph/commit/fe256813ad18933c4b08cdd87c3378682bb0b69d))
* **export:** per-chapter markdown + concatenated book.md ([4a9d8a2](https://github.com/sebastian-software/antigraph/commit/4a9d8a27eb73898983b025354afb9906304bd1a9))
* **extract:** capture Kindle Cloud Reader pages via Playwright ([5a8e24c](https://github.com/sebastian-software/antigraph/commit/5a8e24c11e338e8eed8d9beb5c4bbf08b0fd8d6b))
* **ocr:** local OCR backends — Ollama + MLX-VLM ([b90a7ff](https://github.com/sebastian-software/antigraph/commit/b90a7ff8618f852b043d21f5135a0600e9c81eb7))
* playwright reader selectors + page-nav parsing ([c2ec72f](https://github.com/sebastian-software/antigraph/commit/c2ec72f9c87d6415084f2fd2f1236768b0ce8cbd))
* prepare npm package publishing ([47ac0c8](https://github.com/sebastian-software/antigraph/commit/47ac0c8d59e575960790bb8584f7e7a2db96f88b))
* shared types + utility helpers ([97ea6e6](https://github.com/sebastian-software/antigraph/commit/97ea6e62bc1320f82037d59e4cf6e3599fd0759b))
* **transcribe:** OCR every captured page into content.json ([24689f0](https://github.com/sebastian-software/antigraph/commit/24689f062622a63ff33e63506c60064185eef97e))

## Changelog

All notable changes to this project will be documented in this file.

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
for release notes and SemVer version bumps.
