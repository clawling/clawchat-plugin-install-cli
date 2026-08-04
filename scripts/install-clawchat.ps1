#Requires -Version 5.1
<#
.SYNOPSIS
    Installs, updates, or repairs ClawChat plugin support for the selected target.

.DESCRIPTION
    Windows twin of scripts/install-clawchat.sh. Same contract: one positional
    target (openclaw|hermes), same exit codes (0 ok / help, 1 bad usage or
    missing prerequisite), same install-or-update-then-force flow.

    Targets Windows PowerShell 5.1 (the version that ships with Windows), so it
    avoids PowerShell 7 syntax such as ternaries and null-coalescing.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-clawchat.ps1 openclaw
#>

# NOTE: there is deliberately no param() block. With one, PowerShell binds
# leading-dash tokens as parameter names, so `--help` would die with "A
# parameter cannot be found that matches parameter name 'help'" instead of
# printing usage. A script without param() receives every token verbatim in
# $args, which is what a bash-style CLI contract needs.

# NOTE: $ErrorActionPreference is deliberately NOT set to 'Stop'. Native
# commands (npx, openclaw, hermes) report failure through $LASTEXITCODE, not
# through PowerShell's error stream, and under 'Stop' a native command that
# merely writes to stderr can abort the script. Every external call below
# checks $LASTEXITCODE explicitly instead — the equivalent of `set -e` here.

$PackageSpec        = '@clawling/clawchat-plugin-install-cli@latest'
$OpenClawPluginSpec = '@clawling/clawchat-plugin-openclaw'
$HermesPluginName   = 'clawchat'

# Usage and progress go to stderr, matching the bash script so callers can
# capture stdout cleanly. Write-Host would go to the host, not stderr.
function Write-Err([string] $Message) {
    [Console]::Error.WriteLine($Message)
}

function Write-Usage {
    Write-Err 'Usage: install-clawchat.ps1 <openclaw|hermes>'
    Write-Err ''
    Write-Err 'Installs, updates, or repairs ClawChat plugin support for the selected target.'
    Write-Err ''
    Write-Err 'The script does not install a global clawchat CLI. It runs the latest CLI with npx.'
}

function Test-CommandExists([string] $Name) {
    return [bool] (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

<#
Put the Hermes venv on PATH when `hermes` is not already resolvable.

The POSIX script sources the venv's activate script under its bin directory; on
Windows the venv layout is `.venv\Scripts\` instead. Prefer the venv's own
Activate.ps1, but fall back to putting Scripts\ on PATH directly — Activate.ps1
is absent from some venvs and can be blocked by execution policy, while the
PATH edit always works.
#>
function Enable-HermesVenv {
    $roots = New-Object System.Collections.ArrayList
    if ($env:HERMES_DIR)  { [void] $roots.Add($env:HERMES_DIR) }
    if ($env:HERMES_HOME) { [void] $roots.Add((Join-Path $env:HERMES_HOME 'hermes-agent')) }
    if ($env:USERPROFILE) { [void] $roots.Add((Join-Path $env:USERPROFILE '.hermes\hermes-agent')) }

    foreach ($root in $roots) {
        $scripts = Join-Path $root '.venv\Scripts'
        if (-not (Test-Path -LiteralPath $scripts)) { continue }

        $activate = Join-Path $scripts 'Activate.ps1'
        if (Test-Path -LiteralPath $activate) {
            # Activate.ps1 edits $env:PATH, which is process-scoped and so
            # survives this function returning.
            . $activate
        } else {
            $env:PATH = "$scripts;$env:PATH"
        }
        if (Test-CommandExists 'hermes') { return $true }
    }
    return $false
}

function Test-PluginInstalled {
    if ($Target -eq 'openclaw') {
        $list = & openclaw plugins list --json 2>$null | Out-String
        if ($LASTEXITCODE -ne 0) { return $false }
        return ($list -like "*$OpenClawPluginSpec*") -or
               ($list -like '*clawchat-plugin-openclaw*') -or
               ($list -like '*"clawchat"*')
    }

    $list = & hermes plugins list 2>$null | Out-String
    if ($LASTEXITCODE -ne 0) { return $false }
    return ($list -like "*$HermesPluginName*")
}

# Deliberately returns nothing: a PowerShell function returns its whole success
# stream, so `return $LASTEXITCODE` would hand back npx's stdout AND the code as
# one array, and `(Invoke-Clawchat ...) -eq 0` would compare against that array.
# Letting npx's output flow through untouched also matches the bash script,
# where the CLI streams straight to the terminal. Callers read the global
# $LASTEXITCODE immediately after the call.
function Invoke-Clawchat {
    param(
        [Parameter(Mandatory = $true)] [string] $Action,
        [string[]] $ExtraArgs = @()
    )

    $display = "npx -y $PackageSpec $Action --target $Target"
    if ($ExtraArgs.Count -gt 0) { $display += ' ' + ($ExtraArgs -join ' ') }
    Write-Err "==> Running $display"

    & npx -y $PackageSpec $Action --target $Target @ExtraArgs
}

# --- argument handling ------------------------------------------------------

$first = if ($args.Count -gt 0) { [string] $args[0] } else { '' }

if ($first -eq '-h' -or $first -eq '--help' -or $first -eq '-Help') {
    Write-Usage
    exit 0
}

# Mirrors the bash script's `[[ "$#" -ne 1 ]]`: exactly one argument.
if ($args.Count -ne 1) {
    Write-Usage
    exit 1
}

$Target = $first

if ($Target -ne 'openclaw' -and $Target -ne 'hermes') {
    Write-Err '--target must be one of: openclaw, hermes'
    Write-Usage
    exit 1
}

# --- prerequisites ----------------------------------------------------------

if ($Target -eq 'hermes' -and -not (Test-CommandExists 'hermes')) {
    [void] (Enable-HermesVenv)
}

if (-not (Test-CommandExists $Target)) {
    Write-Err "$Target CLI not found in PATH"
    exit 1
}

if (-not (Test-CommandExists 'npx')) {
    Write-Err 'npx is required to run @clawling/clawchat-plugin-install-cli'
    exit 1
}

# --- install or update ------------------------------------------------------

if (Test-PluginInstalled) {
    Invoke-Clawchat -Action 'update'
    if ($LASTEXITCODE -eq 0) {
        Write-Output 'Update completed.'
        exit 0
    }

    Write-Err 'Update failed; retrying with --force.'
    Invoke-Clawchat -Action 'update' -ExtraArgs @('--force')
    if ($LASTEXITCODE -ne 0) {
        exit 1
    }
    Write-Output 'Forced update completed.'
    exit 0
}

Invoke-Clawchat -Action 'install'
if ($LASTEXITCODE -ne 0) {
    exit 1
}
Write-Output 'Install completed.'
exit 0
