# Runs Claude Code once, with nobody at the keyboard, to follow
# WEEKLY_ARTICLE.md: research and write one article, then open it as a
# pull request for review. Task Scheduler runs this every Monday (see
# register-weekly-article-task.ps1); you can also run it yourself:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\weekly-article.ps1
#
# Needs on this computer: Claude Code (signed in), Git for Windows,
# Node.js 20 or newer, and the GitHub CLI (signed in with `gh auth login`).
# Each run writes a log to %LOCALAPPDATA%\MindInterpreter\logs.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA "MindInterpreter\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("weekly-article-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmm"))

function Write-Log($message) {
  "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message | Out-File -FilePath $log -Append -Encoding utf8
}

Set-Location $repo
Write-Log "Starting the weekly article in $repo"

$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
  Write-Log "Claude Code was not found. Install it and make sure 'claude' works in a new PowerShell window."
  exit 1
}

$prompt = "Follow the instructions in WEEKLY_ARTICLE.md in this repository from start to finish: research and write this week's article, then open its pull request. Do not merge it, and do not push to main."

# The only things Claude may do without asking. Anything else is refused
# automatically (permission mode dontAsk), since nobody is there to approve it.
$allowedTools = @(
  "Read", "Glob", "Grep", "Write", "Edit",
  "WebSearch", "WebFetch",
  "Bash(git status*)", "Bash(git checkout*)", "Bash(git pull*)", "Bash(git fetch*)",
  "Bash(git branch*)", "Bash(git ls-remote*)", "Bash(git log*)", "Bash(git diff*)",
  "Bash(git add content/articles/*)", "Bash(git commit *)", "Bash(git push -u origin article/*)",
  "Bash(gh pr create *)", "Bash(gh pr list*)",
  "Bash(npm install*)", "Bash(npm run build*)", "Bash(wc *)", "Bash(ls *)", "Bash(date*)"
) -join ","

# Claude prints progress on stderr; don't let PowerShell treat that as a failure.
$ErrorActionPreference = "Continue"
& $claude -p $prompt --permission-mode dontAsk --output-format text --allowedTools $allowedTools 2>&1 |
  Out-File -FilePath $log -Append -Encoding utf8
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"

Write-Log "Claude Code finished with exit code $code"
exit $code
