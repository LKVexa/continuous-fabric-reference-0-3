# Changelog

## 0.3.1 - 2026-09-23

- Bind live terminal revocation to the exact token used for authentication.
- Validate agent acknowledgements, welcome messages, UUIDs, configuration and persisted receipt records.
- Prevent prototype mutation through forged receipt acknowledgements.
- Count agent message limits in UTF-8 bytes and reject duplicate welcomes.
- Remove temporary files after failed atomic writes and release locks after failed initialization.
- Run Python adapters in isolated mode and contain bound source paths.
- Remove workstation-specific source defaults; use CFP_SOURCE_ROOT or sibling stockpiles.
- Exclude live state and the byte-identical nested source copy from release staging.
- Add security regressions, Apache 2.0 application licensing and copyright attribution.

- Confirm HERMIT authorship and apply Apache 2.0 licensing under RUSSELL PHILIP SMITHSON.
- Remove unused Electron build scripts and obsolete desktop-only dependency ranges from the hosted runtime manifest.
