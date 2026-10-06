# Windows notification-area icon for a running playtest session. Started by
# playtest-tray.mjs; talks over stdio, one line per message:
#   stdout: ready | show | hide | stop
#   stdin:  tooltip <text> | visible true|false | exit
# The icon disappears when stdin closes, so a crashed MCP server never leaves it behind.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$stdout = [Console]::Out

function Send([string]$line) {
    $stdout.WriteLine($line)
    $stdout.Flush()
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Text = 'CurviosClash-Test'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$toggle = $menu.Items.Add('Testfenster anzeigen')
$stopItem = $menu.Items.Add('Test beenden')
$script:windowsVisible = $false

$toggle.add_Click({
    if ($script:windowsVisible) { Send 'hide' } else { Send 'show' }
})
$stopItem.add_Click({ Send 'stop' })
$icon.ContextMenuStrip = $menu
$icon.add_DoubleClick({
    if ($script:windowsVisible) { Send 'hide' } else { Send 'show' }
})

# Console.In.ReadLineAsync is synchronous in Windows PowerShell 5.1; a StreamReader is not.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$script:pending = $stdin.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({
    while ($script:pending.IsCompleted) {
        $line = $script:pending.Result
        if ($null -eq $line -or $line -eq 'exit') {
            $timer.Stop()
            $icon.Visible = $false
            $icon.Dispose()
            [System.Windows.Forms.Application]::Exit()
            return
        }
        if ($line.StartsWith('tooltip ')) {
            $text = $line.Substring(8)
            if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
            $icon.Text = $text
        } elseif ($line -eq 'visible true') {
            $script:windowsVisible = $true
            $toggle.Text = 'Testfenster verbergen'
        } elseif ($line -eq 'visible false') {
            $script:windowsVisible = $false
            $toggle.Text = 'Testfenster anzeigen'
        }
        $script:pending = $stdin.ReadLineAsync()
    }
})
$timer.Start()
Send 'ready'
[System.Windows.Forms.Application]::Run()
