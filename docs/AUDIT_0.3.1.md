# Continuous Fabric Reference 0.3.1 audit

Audit date: 2026-09-23. Status: audited release candidate; HERMIT authorship and Apache 2.0 licensing confirmed. Intended repository: `LKVexa/continuous-fabric-reference-0-3`.

## Scope and source preservation

This candidate derives only from the requested `Continuous_Fabric_Reference_0.3.0`
folder. The separately requested 0.4.2 folder will receive its own repository.
The original folder was not modified. A nested same-name directory contained 134
byte-identical files and no unique files; that redundant internal copy was excluded.
Live `.state` data, local terminal state, caches and Git metadata were excluded.

The implementation is a Node.js hub and outbound agent, a selected HERMIT terminal
runtime, and isolated Python adapters to eight pinned external source files. Those
external source packages are not bundled. Set `CFP_SOURCE_ROOT` to a separately
obtained stockpile with the exact bindings in `catalog/bindings.json`.

## Findings and fixes

| Finding | Change and validation |
|---|---|
| Revoked or replaced terminal tokens could borrow validity from another token with the same principal and capabilities. | Session validity now checks the exact authenticated token digest. Rotation/revocation regression passes. |
| An acknowledgement using an inherited object key could mutate a prototype. | Require valid UUIDs, a completed handshake, an own cache entry and matching lease. Forged `__proto__` acknowledgement regression passes. |
| Malformed persisted receipts could strand the agent's exclusive lock. | Validate record shape, IDs, fingerprints, states and bounds before connecting; release the lock on initialization failure. Invalid-cache regression passes. |
| Failed atomic writes could leave credential-bearing temporary files behind. | Remove the temporary file on serialization, write or rename failure while preserving the original error. Failure-path regressions pass. |
| Duplicate welcomes could create multiple heartbeat timers. | Reject duplicate welcomes. Regression passes. |
| Incoming message limits counted UTF-16 characters instead of UTF-8 bytes. | Apply the 64 KiB message bound to encoded bytes. Multibyte regression passes. |
| Agent credentials, operation grants and enrollment URLs were insufficiently checked before local state changes. | Validate grants and token form; reject credentials, query strings and fragments in enrollment URLs. Configuration regressions pass. |
| Python adapters inherited startup hooks; bound paths were not explicitly contained. | Launch Python with `-I -B`, resolve paths and reject escapes from the source root. Startup-hook and traversal regressions pass. |
| Default paths and version-specific test assertions depended on the originating workstation/release. | Use `CFP_SOURCE_ROOT` or a sibling `stockpiles` directory, update documentation, and derive displayed-version assertions from package metadata. |

The application version is 0.3.1. Original and derived hashes for the 94 bundled
HERMIT files remain recorded separately; the original provenance is preserved.
`FILES.sha256` inventories the candidate files, excluding the manifest itself.

## Validation evidence

Windows, Node.js 24.19.0 and Python 3.12:

- 35 application tests passed together after the first seven added regressions.
- Two additional adapter security regressions passed after their addition.
- 36 selected HERMIT protocol, WebSocket and security tests passed.
- Total: 73 passing tests, with no skipped tests in these runs.
- `node tools/verify.js`: 94 derived runtime files, zero mismatches.
- All 93 JavaScript files passed syntax checks; 16 JSON files and the Python
  adapter parsed successfully. Targeted credential scanning found only the
  documented test TLS key, and no live state or cache directories were present.
- The portable command passed all 45 tests with `CFP_SOURCE_ROOT` unset. This is
  a subset of the 73 tests above, not 45 additional tests. It was invoked directly
  through Node because the local bundled runtime does not include the npm CLI.

The application suite exercised the exact separately supplied source bindings using
`CFP_SOURCE_ROOT`. It is not reproducible from this repository alone without those
donor files. The portable CI workflow runs the self-contained security/protocol
subset on Windows and Linux. It is prepared locally; no GitHub CI result is claimed
for this unpublished candidate. Its actions are pinned to immutable commits and
receive read-only repository permissions.

`docs/validation.json`, `docs/browser-validation.json`, the other pre-existing audit
documents and the three browser screenshots are historical evidence from earlier versions. They
have not been relabeled as new 0.3.1 browser or deployment validation.

## Dependencies and limits

The root application has no npm package dependencies and needs no `npm install`.
Unused Electron build scripts and obsolete desktop-only development dependency
ranges have been removed from the hosted runtime manifest. Desktop packaging is
outside this reference release; no npm dependency installation is needed.

This work does not certify arbitrary workload isolation, hardware attestation,
multi-hub consensus, native mobile builds, real WAN deployment or production
readiness. External donor code is trusted code despite its integrity pins. Use TLS
off loopback, protect state/enrollment files, and use only trusted source roots.
The bundled test TLS key is intentionally public test material, never a deployment
credential. Hash manifests establish reproducibility, not independent authenticity.

## Publication rights

RUSSELL PHILIP SMITHSON confirmed HERMIT authorship and requested Apache 2.0
licensing for these deliveries. The application and runtime LICENSE and NOTICE
now name RUSSELL PHILIP SMITHSON. Historical source hashes remain unchanged in
the provenance manifest; derived hashes reflect the corrected licensing metadata
and runtime changes. No separately bound donor code is redistributed.
