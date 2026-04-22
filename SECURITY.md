# Security Policy

## Supported Versions

Antigraph is a small source-first project. Security fixes target the current `main` branch.

## Reporting a Vulnerability

Please report security issues privately by emailing Sebastian Werner at <s.werner@sebastian-software.de>.

Include:

- A short description of the issue.
- Reproduction steps or a minimal proof of concept.
- The affected Antigraph commit or version.

Do not include copyrighted book text, page screenshots, Kindle credentials, auth profile contents, or other personal account data.

## Scope

In scope:

- Handling of local auth/session data under `out/.auth/data`.
- Unsafe local file writes or path traversal.
- Accidental network disclosure of page screenshots or OCR input.
- Dependency vulnerabilities that affect Antigraph runtime behavior.

Out of scope:

- Kindle Cloud Reader behavior controlled by Amazon.
- Issues that require redistributing exported copyrighted text.
- OCR accuracy problems without a security impact.
