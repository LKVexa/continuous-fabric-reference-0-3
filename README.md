# Continuous Fabric Reference 0.3.1

A source-grounded platform synthesis and working local hub for Windows/Linux, browser/mobile terminal clients, and outbound cloud agents.

**Delivered status:** a tested reference implementation, not a production-certified replacement for Kubernetes. The original source folders and sealed DF members are unchanged.

Start with [the architecture](docs/ARCHITECTURE.md), [the deployment guide](docs/DEPLOYMENT.md), and [the evidence report](docs/VALIDATION.md). The [integration matrix](catalog/INTEGRATION_MATRIX.md) accounts for all 115 supplied packages; [sources.json](catalog/sources.json) records 448 inspected metadata documents and their hashes.

## What runs

- The actual supplied **HERMIT RAMWS** gateway, SPIRAL virtual shell, VT renderer and `hermit.vws.v2` session protocol.
- A new `cfp` virtual command connected to a single durable job coordinator.
- Outbound agents with operator-enrolled identities, fixed operation grants, heartbeat, reconnect and persisted result receipts.
- The actual **SCH-01 core** for placement, with a source digest check before import.
- The supplied **_model offline evaluator** and **GAP-05 causal merge core** as bounded callable operations.
- Idempotent submission keys, tenant-scoped lookup, single-slot placement, journal integrity checks, uncertain-outcome handling and live agent revocation.

The reference agent runs `echo`, `sha256`, `model.evaluate` and `state.merge`. It does not run arbitrary shell commands or accept uploaded executable code. Cloud enrollment enables only the first two by default. There is no automatic claim that every catalogued atom is connected.

## Terminal corrections in 0.3.0

The hosted banner, about/help, version and status now describe this platform. Quoting preserves literal payloads; malformed commands fail before submission; errors and exit status distinguish acceptance from execution. `fabric` is an alias for `cfp`. Narrow browser windows resize the terminal correctly. See [the audit and upgrade instructions](docs/TERMINAL_AUDIT.md).

## Included startup fix from 0.2.1

The launcher probes installed Python runtimes and records the working interpreter as an absolute path. Windows aliases that cannot execute Python are skipped. The existing bundled runtime is used as a fallback when available; nothing is downloaded. An explicit CFP_PYTHON override must pass the probe. Adapter failures preserve exit status and stderr instead of reporting a misleading JSON parsing error.

See [startup fix evidence](docs/STARTUP_FIX.md).

## Start on this Windows machine

Requirements: Node 24.19.0 (tested; other Node releases unqualified) and Python 3.10+. Verification used Node 24.19.0 and Python 3.12.14.

In PowerShell, from this directory, run .\START.ps1. Python is detected automatically. To explicitly select the already installed interpreter on this machine, the following also works:

```powershell
$env:CFP_PYTHON = 'C:\Python312\python.exe'
$env:CFP_SOURCE_ROOT = 'C:\path\to\stockpiles'
node bin/cfp.js doctor
.\START.ps1
```

Install a supported Node.js 24 runtime and make node available on PATH. The Python path above is an example; use the actual installed interpreter.

Open **http://127.0.0.1:8740**. Paste the token from `.state/operator-login.json` into HERMIT's sign-in form. Tokens are generated locally; none are distributed in the ZIP. Do not share the state directory.

In the virtual terminal:

```text
cfp help
cfp nodes
cfp submit first-hash local-1 sha256 "hello fabric"
cfp jobs
cfp submit first-model local-1 model.evaluate '{"metric":"numeric","rows":[{"response":"1/2","gt":"50%"}]}'
cfp jobs
```

A submission returns a job ID. Use `cfp job JOB_ID` to retrieve its result. Repeating `submit` with the same key and content returns the same job; changed content is refused. `run` always creates a new request key.

The **CFP hub** badge reports the terminal connection. Use `cfp status` and `cfp nodes` for fresh agent observations. A successful submit command confirms acceptance; inspect the job state and result for execution success.

## Linux and another source location

```sh
export CFP_PYTHON=python3
export CFP_SOURCE_ROOT=/srv/post-kubernetes-world
sh start.sh
```

The source root must contain the same relative package paths and exact pinned Python files listed in `catalog/bindings.json`. The local hub needs those bindings; the minimal remote echo/hash agent does not.

## Mobile and cloud

Enable the hub's native HTTPS listener with a certificate trusted by the clients, then open its HTTPS address on a phone. Enroll a cloud agent with:

```text
node bin/cfp.js enroll cloud-1 cloud wss://YOUR-HUB:8740/ws/agent
node bin/cfp.js agent /path/to/cloud-1-agent.json
```

The second command runs on the cloud machine with the private enrollment configuration and this package. A cloud VM must be able to reach the hub; an outbound agent does not make an unreachable home hub publicly routable. See [deployment](docs/DEPLOYMENT.md) for TLS, networking, source bindings, shutdown and recovery.

## Verification

```text
node tools/verify.js
node --test tests/*.test.js
node --test runtime/hermit/tests/protocol/*.test.js runtime/hermit/tests/gateway/ws-conformance.test.js runtime/hermit/tests/security/*.test.js
```

Set `CFP_PYTHON` first if Python is not on PATH.

## Claim boundaries

Terminal sessions and their virtual files are **LOCAL_VOLATILE**. Explicitly submitted job payloads, request keys and results are stored in the separate durable job journal. Reconnect creates a fresh terminal; query the existing job instead of assuming its input failed.

This release has one authoritative hub, trusted fixed operations and no hardware attestation, multi-hub consensus, arbitrary workload isolation, native iOS/Android build, native DF promotion, physical QPU, or verified real WAN deployment. The broader architecture and package-by-package promotion path are delivered as specifications.

The full `_model` mission engine cannot run from this source snapshot alone: its expected adjacent configuration/mission installation is absent. The working integration is its pinned offline evaluator, which remains advisory.

## Ownership and provenance

The application and bundled HERMIT runtime are Apache-2.0, with authorship confirmed by RUSSELL PHILIP SMITHSON. `catalog/hermit-provenance.json` records original and derived hashes for 94 copied runtime/test files and identifies the bridge, parser and presentation patches. The other source packages are bound in place or catalogued, not flattened into an untraceable bundle.



## 0.3.1 security patch and portable configuration

Set `CFP_SOURCE_ROOT` to the separately obtained stockpile directory before running
`init`, `doctor`, or the integration tests. The default is `../stockpiles` relative
to this checkout; it no longer depends on a particular Windows account.

```sh
node --test tests/hardening.test.js
node tools/verify.js
```

The source folders remain unchanged. Live `.state` data and a nested byte-identical
copy of the complete package (134 files) were excluded from this release candidate.
See [CHANGELOG.md](CHANGELOG.md) and [docs/AUDIT_0.3.1.md](docs/AUDIT_0.3.1.md).

## License

Copyright 2026 RUSSELL PHILIP SMITHSON. The application, integration changes and
bundled HERMIT runtime are licensed under the Apache License, Version 2.0;
see [LICENSE](LICENSE) and [NOTICE](NOTICE). External donor packages are not included
and retain their own terms and provenance records.
