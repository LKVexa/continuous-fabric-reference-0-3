# Validation — Continuous Fabric Reference 0.3.0

Tested on Windows with Node 24.19.0 and Python 3.12.14. This is a tested reference release, not production certification.

| Check | Result |
|---|---|
| Reference tests | 28 passed, 0 failed, 0 skipped |
| Selected HERMIT regressions | 52 passed, 0 failed, 0 skipped |
| JavaScript syntax | 91 files passed |
| Derived runtime provenance | 94 files checked |
| Bound source doctor | 8 pinned Python files match |
| Browser | Headless Microsoft Edge: desktop and 390px viewport; zero page errors |

[Reference test output](reference-test-results.txt) covers journal integrity, source adapters, idempotency, tenant isolation, reconnect receipts, revocation, native TLS, storage faults, Python startup, quoting, strict command syntax, exit codes, literal payloads, HTTP errors, malformed responses, stale peers, authenticated identity, CLI validation, interruption and malformed browser frames.

[HERMIT test output](hermit-test-results.txt) covers protocol, framing, security, worker lifecycle and browser transport units. Executed against this release:

```text
node --test tests/*.test.js
node --test runtime/hermit/tests/protocol/*.test.js runtime/hermit/tests/gateway/ws-conformance.test.js runtime/hermit/tests/security/*.test.js runtime/hermit/tests/baseline/*.test.js runtime/hermit/tests/worker/*.test.js runtime/hermit/tests/ui/client-units.test.js
node tools/verify.js
node bin/cfp.js doctor
```

The baseline glob contained no additional `.test.js` cases; it does not claim execution of the separate historical probe script. Selected regressions do not include the full inherited load, chaos, Electron GUI or upstream certification suite.

[Browser evidence](browser-validation.json) records sign-in, version, hub badge, updated about output, a literal payload submitted through the real WebSocket and agent, terminal job results, JSON diagnostics, exit status and narrow viewport resize. The resulting screenshots were inspected. All agents ran on this Windows host using actual loopback connections. A narrow viewport is not a physical phone test.

Original donor hashes remain unchanged; the manifest separately records derived hashes and patches. FILES.sha256 and the archive checksum cover the release, but are not publisher signatures.

Not exercised: physical iOS/Android devices, Linux execution, another physical machine/cloud deployment, real WAN/NAT behavior, native DF promotion, arbitrary workload isolation, hardware attestation, multi-hub consensus, full _model mission installation, real power-loss durability, sustained load or an independent security review. No broad source-package production qualification is inferred from these tests.

See [the audit](TERMINAL_AUDIT.md) for findings, command semantics and restart instructions.
