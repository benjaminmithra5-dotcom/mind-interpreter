# Creates (or updates) the Windows Task Scheduler task that writes a new
# article every Monday at 10:00 India time. Run it once, in PowerShell,
# from the repository folder:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-weekly-article-task.ps1
#
# The task runs as you, while you are signed in to Windows. If the
# computer was off or asleep at that time, it runs as soon as it can.
#
#   Run it now:     Start-ScheduledTask -TaskName "Mind Interpreter weekly article"
#   Pause it:       Disable-ScheduledTask -TaskName "Mind Interpreter weekly article"
#   Resume it:      Enable-ScheduledTask -TaskName "Mind Interpreter weekly article"
#   Remove it:      Unregister-ScheduledTask -TaskName "Mind Interpreter weekly article" -Confirm:$false

$ErrorActionPreference = "Stop"
$taskName = "Mind Interpreter weekly article"
$runner = Join-Path $PSScriptRoot "weekly-article.ps1"
$repo = Split-Path -Parent $PSScriptRoot

# Monday 10:00 in India (IST), converted to this computer's own time zone,
# so it is right even if Windows isn't set to India time.
$ist = [TimeZoneInfo]::FindSystemTimeZoneById("India Standard Time")
$nowIst = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $ist)
$daysAhead = (([int][DayOfWeek]::Monday - [int]$nowIst.DayOfWeek) + 7) % 7
$mondayIst = [DateTime]::SpecifyKind($nowIst.Date.AddDays($daysAhead).AddHours(10), [DateTimeKind]::Unspecified)
if ($mondayIst -le $nowIst) { $mondayIst = $mondayIst.AddDays(7) }  # today's 10:00 has passed: start next week
$startLocal = [TimeZoneInfo]::ConvertTime($mondayIst, $ist, [TimeZoneInfo]::Local)

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $startLocal.DayOfWeek -At $startLocal
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Runs Claude Code to follow WEEKLY_ARTICLE.md and open a pull request with a new article." -Force | Out-Null

Write-Host "Scheduled '$taskName': every $($startLocal.DayOfWeek) at $($startLocal.ToString('HH:mm')) on this computer (Monday 10:00 IST)."
Write-Host "Logs: $(Join-Path $env:LOCALAPPDATA 'MindInterpreter\logs')"
