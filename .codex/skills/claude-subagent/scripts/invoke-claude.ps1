[CmdletBinding()]
param(
    [ValidateSet('Review', 'Implement')]
    [string]$Mode = 'Review',

    [string]$Prompt,

    [string]$WorkingDirectory = (Get-Location).Path,

    [string]$WorktreeName,

    [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
    [string]$ResumeSessionId,

    [ValidateSet('low', 'medium', 'high', 'xhigh', 'max')]
    [string]$Effort = 'medium',

    [string]$Model,

    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$claudeCommand = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeCommand) {
    throw 'Claude Code is not installed or is not available on PATH.'
}

$authOutput = & $claudeCommand.Source auth status 2>&1
$authExitCode = $LASTEXITCODE
try {
    $authStatus = $authOutput | ConvertFrom-Json
} catch {
    throw "Claude authentication status was not valid JSON: $authOutput"
}

$preflight = [ordered]@{
    command = $claudeCommand.Source
    version = (& $claudeCommand.Source --version 2>&1 | Out-String).Trim()
    loggedIn = [bool]$authStatus.loggedIn
    authMethod = $authStatus.authMethod
    apiProvider = $authStatus.apiProvider
}

if ($CheckOnly) {
    $preflight | ConvertTo-Json -Depth 4
    if ($authExitCode -ne 0 -or -not $authStatus.loggedIn) { exit 2 }
    exit 0
}

if ($authExitCode -ne 0 -or -not $authStatus.loggedIn) {
    throw 'Claude Code is not authenticated. Run "claude auth login" interactively, then retry.'
}

if ([string]::IsNullOrWhiteSpace($Prompt)) {
    throw 'Prompt is required unless -CheckOnly is used.'
}

$resolvedWorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$claudeArgs = @(
    '-p',
    '--output-format', 'json',
    '--effort', $Effort,
    '--append-system-prompt',
    'You are an external subagent. Obey repository instructions, including AGENTS.md. Other agents may be working concurrently. Never revert, stage, commit, stash, reset, push, or broadly format their work. Return concise conclusions, changed files, tests, and unresolved risks.'
)

if ($Model) {
    $claudeArgs += @('--model', $Model)
}

if ($ResumeSessionId) {
    if ($Mode -ne 'Implement' -or $WorktreeName) {
        throw 'Resume requires Implement mode and cannot create a new worktree.'
    }
    if (-not $Model -or -not $PSBoundParameters.ContainsKey('Effort')) {
        throw 'Resume requires explicit -Model and -Effort matching the original session.'
    }
    $worktreeRoot = (& git -C $resolvedWorkingDirectory rev-parse --show-toplevel 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $worktreeRoot -or
        $resolvedWorkingDirectory -ne (Resolve-Path -LiteralPath $worktreeRoot).Path -or
        -not (Test-Path -LiteralPath (Join-Path $worktreeRoot '.git') -PathType Leaf)) {
        throw 'Resume requires -WorkingDirectory to be the root of a registered Git worktree.'
    }
    $claudeArgs += @(
        '--resume', $ResumeSessionId,
        '--permission-mode', 'acceptEdits',
        '--disallowedTools', 'Bash(git commit *),Bash(git push *),Bash(git stash *),Bash(git reset *)'
    )
} elseif ($Mode -eq 'Review') {
    $claudeArgs += @(
        '--permission-mode', 'plan',
        '--allowedTools', 'Read,Glob,Grep',
        '--no-session-persistence'
    )
} else {
    if ([string]::IsNullOrWhiteSpace($WorktreeName)) {
        throw 'Implement mode requires -WorktreeName.'
    }
    if ($WorktreeName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$') {
        throw 'WorktreeName must be 1-63 characters using letters, digits, dot, underscore, or hyphen.'
    }

    & git -C $resolvedWorkingDirectory rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Implement mode requires a Git repository.'
    }

    $claudeArgs += @(
        '--worktree', $WorktreeName,
        '--permission-mode', 'acceptEdits',
        '--disallowedTools', 'Bash(git commit *),Bash(git push *),Bash(git stash *),Bash(git reset *)'
    )
}

$claudeArgs += @('--', $Prompt)

Push-Location -LiteralPath $resolvedWorkingDirectory
try {
    & $claudeCommand.Source @claudeArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
