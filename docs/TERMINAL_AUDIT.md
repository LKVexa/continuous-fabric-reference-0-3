# Terminal audit and release 0.3.0

The screenshot exposed inherited desktop HERMIT descriptions in the hosted continuous-fabric terminal. This release aligns the hosted command surface, parsing, result semantics and browser display with the actual implementation. It retains the 0.2.1 Python startup fix.

| Finding | Correction |
|---|---|
| `about` and the banner advertised Electron IPC, VB-JA21, Photon and four native DF nodes | Hosted descriptions now explain the WebSocket shell, durable job hub, fixed operations and current integration limits |
| Footer showed a hardcoded v1.0.0 and unrelated DF status | Public, non-secret build metadata supplies CFP v0.3.0; the badge reports the terminal's hub connection; `cfp nodes` reports agents |
| Generic option parsing discarded leading-dash CFP payloads | CFP consumes the original argument vector; negative numbers and literal dashes survive |
| Single-quoted and escaped dollar signs were expanded | Tokens retain quote/escape provenance; single quotes preserve JSON and literal text |
| Unterminated quotes, trailing operators and incomplete redirects could execute partially | The entire line is syntax-checked before execution; invalid syntax returns status 2 |
| `$?` was expanded before earlier commands on the same line finished | Expansion occurs when a command runs; conditional execution and reported status agree |
| Invalid operations/JSON produced confusing parser errors; extra arguments were ignored | Shared command grammar checks arity, operation, JSON shape, bounds and payloads before journaling |
| Bridge HTTP errors were written to stdout | Structured errors use stderr and nonzero status; malformed/empty/oversized responses have explicit diagnostics |
| Accepted submissions could be mistaken for completed work | Job views always include nullable `result`/`completed`, `terminal` and `outcomeKnown`; help defines acceptance versus execution |
| Agent counts included stale peers | Freshness is checked consistently, including after asynchronous placement; status separates registered and fresh agents |
| `whoami` could reflect a user-editable variable; `uname` invented host architecture | Hosted identity comes from authenticated scope; system information identifies the virtual shell |
| Host CLI typos and extra arguments could succeed silently | Strict host command arity, explicit errors, version command, and failing doctor status on mismatched bindings |
| Malformed binary output could crash the browser error handler | Protocol-error handling is initialized before binary decoding and closes with code 1002 |
| A narrow viewport retained the canvas's previous desktop width | Grid sizing permits terminal resize; compact header/footer keep connection and version visible |

The platform version is **0.3.0**. The underlying donor version remains **HERMIT 2.0.0-ramws.1**; this is a documented derivative, not a new upstream HERMIT release. Original supplied source directories are unchanged. Original and derived runtime hashes are recorded separately.

## Commands and returns

Inside the browser's virtual terminal:

```text
about
help cfp
cfp help
cfp status
cfp nodes
cfp submit my-first-hash local-1 sha256 'hello $USER --literal'
cfp jobs
cfp job JOB_ID
```

Replace `JOB_ID` with the returned ID. `fabric` is a compatibility alias for `cfp`; native DF bundle commands remain disabled. The virtual terminal does not execute PowerShell, Bash or arbitrary host executables.

`cfp run` creates a new request key every time. `cfp submit` with the same key and content returns the existing job. After an interrupted submission, query jobs or repeat the same `submit` key; do not assume nothing happened. `cfp abandon` stops tracking a queued/uncertain job and does not undo remote effects.

| Value | Meaning |
|---|---|
| Command status 0 | Command accepted or read completed; a submitted job may still be queued or executing |
| Command status 1 | Authorization, lookup, conflict or service/transport failure |
| Command status 2 | Invalid command syntax or arguments |
| Command status 130 | Interrupted command; submission outcome may still require lookup |
| QUEUED / ASSIGNED | Accepted, without a terminal execution result |
| SUCCEEDED / FAILED | Executor returned a terminal result; inspect `result` |
| UNKNOWN | Execution outcome is uncertain; no automatic redispatch |
| ABANDONED | Operator stopped tracking; remote effects remain unknown |

Single quotes preserve literal dollars and JSON. Double quotes permit variable expansion. Text arguments are joined by one space; quote a payload to preserve repeated spaces. Empty text must be supplied as `''`. Unquoted `|`, `>`, `&&`, `||` and `;` remain shell operators. Command substitution is unsupported.

Payloads are limited to 16 KiB, nested JSON to 32 levels, command requests to 32 arguments/24 KiB, bridge responses to 2 MiB and interactive lines to 4096 characters. The shorter interactive limit applies when typing into the terminal.

## Activate the update

For the existing Desktop installation, the folder name may still end in `0.2.0`; the installed package and displayed version identify the release.

1. In the host PowerShell window running the hub, press **Ctrl+C** and wait for its prompt. A new release requires a hub restart; refreshing the browser alone does not replace existing workers.
2. From that installation directory, run:

```powershell
node bin/cfp.js --version
node bin/cfp.js doctor
.\START.ps1
```

3. Reload the browser and sign in with the existing credential. Run `about`; it should show **Continuous Fabric Reference v0.3.0**.

The upgrade preserves `.state`, enrolled credentials and durable jobs. Terminal files and history are volatile by design and do not survive a restart. A ZIP contains code and evidence only, never live credentials. Do not replace your state directory with test state or run two hubs against it.

See [VALIDATION.md](VALIDATION.md) for the test results and limits, and [browser-about.png](browser-about.png) / [browser-narrow.png](browser-narrow.png) for the inspected browser views. This audit targets command correctness and the associated trust boundaries; it is not a complete production security certification of the 115 source packages.
