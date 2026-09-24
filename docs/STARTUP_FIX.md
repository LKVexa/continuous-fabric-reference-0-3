# Startup fix — 0.2.1

The original launcher assumed the command python (or python3) was a working interpreter. The adapter parsed stdout without checking the subprocess exit code. When an interpreter exited before producing JSON, the real stderr diagnostic was replaced by Unexpected end of JSON input.

On this host, the user's Desktop package passed all eight donor checks when CFP_PYTHON named the installed bundled Python executable. Bare Python commands were unavailable to the automation environment. This identifies interpreter selection and diagnostic handling as the failure boundary; it does not claim a specific unseen error message from the user's administrator shell.

Changes:
- Probe Python 3.10+ and select its absolute sys.executable path.
- Try configured/PATH interpreters and the existing bundled runtime, without downloads.
- Treat an explicit invalid CFP_PYTHON as an error.
- Honor CFP_PYTHON for start as well as init/doctor; use the same selected interpreter for the local agent.
- Preserve process exit status and stderr; distinguish empty, malformed and unsuccessful output.
- Respect CFP_STATE_DIR in both launch scripts and propagate the PowerShell exit code.
- Add five startup regression tests; all 14 reference tests passed with CFP_PYTHON unset.

Existing credentials, grants, journals and agent receipts do not need replacement. Applying the fix to a folder named Continuous_Fabric_Reference_0.2.0 is supported; package.json reports version 0.2.1.

Launch after applying:
    .\START.ps1

Temporary workaround for an unpatched 0.2.0 copy:
    $env:CFP_PYTHON = 'C:/path/to/python.exe'
    .\START.ps1
