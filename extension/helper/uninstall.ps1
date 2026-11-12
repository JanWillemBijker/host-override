# Verwijdert de Host Override helper op Windows.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*.host-override*proxy.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) "HostOverride.vbs") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:USERPROFILE ".host-override") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Helper verwijderd. Verwijder daarna de extensie zelf via chrome://extensions."
