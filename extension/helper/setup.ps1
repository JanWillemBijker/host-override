# Host Override helper voor Windows: zet de lokale proxy klaar en start hem bij inloggen (Opstarten-map).
# Mag vaker uitgevoerd worden; dat werkt de helper bij en herstart hem.
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".host-override"
$proxy = Join-Path $dir "proxy.js"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

if ($PSCommandPath) {
  $local = Join-Path (Split-Path -Parent $PSCommandPath) "proxy.js"
  if (Test-Path $local) {
    Copy-Item $local $proxy -Force
    Copy-Item (Join-Path (Split-Path -Parent $PSCommandPath) "dnstools.js") (Join-Path $dir "dnstools.js") -Force
  }
}
if (-not (Test-Path $proxy)) { Write-Host "proxy.js ontbreekt in $dir"; exit 1 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "Node.js niet gevonden. Installeer het van https://nodejs.org en voer dit daarna opnieuw uit."
  exit 1
}

# Onzichtbare starter (geen consolevenster).
$vbs = Join-Path $dir "run.vbs"
$line = 'CreateObject("WScript.Shell").Run """' + $node + '"" ""' + $proxy + '""", 0, False'
Set-Content -Path $vbs -Value $line -Encoding ASCII

# Automatisch starten bij inloggen.
$startup = [Environment]::GetFolderPath("Startup")
Copy-Item $vbs (Join-Path $startup "HostOverride.vbs") -Force

# Oude versie stoppen en nieuwe starten.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*.host-override*proxy.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')

Write-Host "Klaar. De helper draait en start voortaan automatisch bij inloggen."
Write-Host "Ga terug naar de extensie en klik op 'Opnieuw controleren'."
