# Changelog

All notable changes to this project will be documented in this file.

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
for release notes and SemVer version bumps.

## 0.1.0 (2026-04-22)

### Features

- Prepare the package for npm publication with a tsdown-built CLI and typed
  public API.
- Add release-quality gates for formatting, ESLint, TypeScript, unit tests,
  coverage, publint, and package smoke testing.
- Harden the Kindle/OCR pipeline by failing closed on partial OCR output unless
  `--allow-partial` is explicitly enabled.
