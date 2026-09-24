$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$stateDirectory = if ($env:CFP_STATE_DIR) { $env:CFP_STATE_DIR } else { Join-Path $PSScriptRoot '.state' }
if (-not (Test-Path -LiteralPath (Join-Path $stateDirectory 'hub.json'))) {
  & node bin/cfp.js init
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& node bin/cfp.js start
exit $LASTEXITCODE
