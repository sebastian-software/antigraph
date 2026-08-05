# ADR 0001: Use rendered page capture and local OCR

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Antigraph maintainers

## Context

The project needs a dependable way to turn books available in a user's Kindle
library into text for personal workflows. Earlier experiments covered local
Kindle containers, macOS Accessibility text, native-app screenshots, Cloud
Reader render data, and custom glyph reconstruction. They established that no
single source provides portable, structured text on current clients without a
significant trade-off.

In particular:

- local KFX/DRMION parsing reached catalog and container-level results, but a
  complete extraction path depended on per-book key access that was not viable
  on a normal, protected macOS installation;
- macOS Accessibility exposed useful text in some books, but frequently lost
  paragraph boundaries, hierarchy, and typographic semantics;
- the Cloud Reader did not expose a stable, ordinary text DOM suitable for the
  previously proposed DOM-scraping approach;
- reconstructing text by matching custom vector glyphs from Cloud Reader render
  responses proved highly coupled to fonts and renderer implementation details;
- sending page images to a hosted multimodal model conflicted with the project's
  local-processing and privacy goals.

The evidence and the precise status of those experiments are maintained in
[Content access approaches](../content-access-approaches.md).

## Decision

Antigraph will automate a real browser session authenticated by the user and
operate only on book pages the Kindle Cloud Reader renders for that session.

For each page, Antigraph will:

1. capture the already-rendered page image, preferring the browser-created image
   blob and retaining an element-screenshot fallback;
2. retain non-text render metadata such as the table of contents, position IDs,
   and page mappings for navigation and chapter assembly;
3. run OCR through a local backend;
4. treat Markdown and inspectable JSON intermediates as the canonical outputs.

Antigraph will not add file decryption, content-key extraction, or a cloud OCR
backend as part of this architecture. Authentication remains in the user's
browser profile; it is not replaced by a custom or unofficial authentication
flow.

## Decision drivers

- Works on a stock machine without changing operating-system security settings.
- Uses the same authenticated, user-visible reading surface as the normal
  reader.
- Keeps page images and extracted text on the user's machine by default.
- Supports current reflowable Kindle books even when semantic text is not
  exposed to the browser DOM or macOS Accessibility APIs.
- Preserves Kindle navigation metadata so OCR pages can still be assembled into
  chapters deterministically.
- Keeps the pipeline auditable through saved images and stage-by-stage JSON
  files.

## Considered options

### Capture rendered Cloud Reader pages and OCR locally — chosen

This is the current Antigraph pipeline. It has lower semantic fidelity than a
true document model, but it is the best combination of availability, privacy,
portability, and operational simplicity found in the experiments.

### Extract and decrypt downloaded Kindle containers — rejected

The research produced working catalog, voucher, and container parsers, but the
end-to-end path depended on protected key material. The demonstrated enrollment
route required disabling macOS System Integrity Protection. That is not an
acceptable product prerequisite, and the remaining parser/export stages were
therefore not completed.

### Read text through macOS Accessibility — rejected as the primary source

This can be fast and fully local when a Kindle book exposes `AXValue`, but the
observed output is often a flattened text stream. It also restricts the product
to one native client and operating system. Accessibility text may still be
useful in a future optional validation or fallback path.

### Combine Accessibility text with hosted multimodal formatting — rejected

The prototype kept Accessibility text as its canonical text source and used
page screenshots to recover formatting. It introduced credentials, cost,
network reliability, model variability, and third-party processing of book
pages. Those costs contradict Antigraph's local-first boundary.

### Decode Cloud Reader vector glyphs — rejected

The extension prototype could observe renderer responses and parse their
bundled assets, but converting font-specific vector paths back to characters
required fragile glyph matching. Font substitutions, orientation details,
spaces, styles, and renderer changes made this a poor maintenance boundary.

### Scrape a semantic Cloud Reader DOM — rejected for the current renderer

This was the preferred recommendation at the end of the local-container
research because it promised real text and HTML structure. Subsequent browser
work showed that current content pages are image/custom-renderer based rather
than a stable semantic text DOM. The assumption did not hold for the tested
reader.

### Capture native-app windows and use platform OCR — retained as a fallback idea

Native window capture plus Apple Vision can stay local and avoids protected key
access, but it requires macOS-only Accessibility and Screen Recording
permissions, visible-window orchestration, and more UI error recovery. The
Cloud Reader route is less platform-specific and exposes better navigation
metadata.

## Consequences

### Positive

- No decryption or key-management subsystem is part of Antigraph.
- No SIP changes, debugger attachment, or modified Kindle client is required.
- Page images remain local and can be inspected when OCR output is questionable.
- TOC and position metadata survive independently of OCR quality.
- Multiple local OCR engines can be evaluated without changing extraction.

### Negative

- OCR errors and lost typography are unavoidable; figures, tables, formulas,
  footnotes, and complex layouts remain weak spots.
- Browser automation and Cloud Reader selectors can break when the reader
  changes.
- A real browser, GPU-backed rendering, and local model capacity are required.
- Extraction is page-oriented and slower than direct access to a semantic
  document model.
- The authenticated browser profile and extracted output require careful local
  handling by the user.

## Validation and review triggers

Keep this decision while real-book smoke tests confirm that page capture,
position mapping, OCR, and chapter assembly remain usable. Revisit it if any of
the following becomes true:

- Amazon provides an authorized export or API with suitable fidelity;
- the Cloud Reader exposes stable semantic text and document structure;
- the rendered-page contract or authentication flow changes substantially;
- local OCR no longer meets the quality or hardware requirements of the target
  use cases;
- complex-layout books become a primary product requirement;
- an Accessibility-based secondary signal can measurably improve accuracy
  without compromising portability or privacy.

## References

- [Content access approaches](../content-access-approaches.md)
- [OCR backend findings](../ocr-backends.md)
- [Project readme](../../readme.md)
- [`src/extract-render.ts`](../../src/extract-render.ts)
- [`src/extract-network.ts`](../../src/extract-network.ts)
- [`src/assemble-chapters.ts`](../../src/assemble-chapters.ts)
