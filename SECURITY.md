# Security and release scope

This reference implements one authoritative hub with trusted fixed operations. It
does not provide hardware attestation, tenant workload sandboxing, or production
WAN certification. Use native HTTPS/WSS and a trusted certificate for remote access.

Keep `.state`, enrollment configurations, live tokens, production TLS keys, and job
journals private. Test certificates under tests/fixtures are public fixtures and
must never be deployed. Do not put live credentials in GitHub issues.

The 0.3.1 audit fixes exact-token revocation, acknowledgement validation, receipt
store validation, initialization cleanup, and isolated adapter execution. The full
source integrations require separately obtained donor packages with matching pins.

The application and bundled HERMIT runtime are Apache-2.0 under the confirmed
authorship of RUSSELL PHILIP SMITHSON. External bindings retain their own terms.
