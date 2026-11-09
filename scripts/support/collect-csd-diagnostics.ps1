# Read-only support collector. Compatible with Windows PowerShell 5.1; no admin,
# network, model requests, browser databases, cookies or encrypted secrets.
param(
  [string]$DataRoot = (Join-Path $env:APPDATA 'csd-desktop\data'),
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $DataRoot -PathType Container)) {
  throw 'Khong tim thay du lieu CSD. Hay chay tren dung tai khoan Windows da dung CSD.'
}
if (@(Get-Process -Name CSD -ErrorAction SilentlyContinue).Count -gt 0) {
  throw 'Hay dung thu thap, dong CSD, sau do chay lai LAY-LOG-CSD.cmd. Khong can xoa du lieu.'
}
$source = (Resolve-Path -LiteralPath $DataRoot).Path.TrimEnd('\')
$name = 'CSD-logs-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
$bundle = Join-Path $OutputRoot $name
$zip = $bundle + '.zip'
[void](New-Item -ItemType Directory -Path $bundle)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$inventory = New-Object System.Collections.Generic.List[object]
$issues = New-Object System.Collections.Generic.List[object]
$totalBytes = 0L

function Protect-Text([string]$text) {
  $text = [regex]::Replace($text, 'AIza[0-9A-Za-z_-]{20,}', '[REDACTED_API_KEY]')
  $text = [regex]::Replace($text, '(?i)Bearer\s+[0-9A-Za-z._~+/=-]+', 'Bearer [REDACTED]')
  return $text
}
function Protect-Object($value) {
  if ($null -eq $value) { return $null }
  if ($value -is [string]) { return (Protect-Text $value) }
  if ($value -is [System.Management.Automation.PSCustomObject]) {
    $clean = [ordered]@{}
    foreach ($p in $value.PSObject.Properties) {
      if ($p.Name -match '(?i)^(api_?key|authorization|cookie|cookies|set-cookie|password|secret|access_?token|refresh_?token)$') {
        $clean[$p.Name] = '[REDACTED]'
      } elseif ($p.Name -notmatch '^(preview|suitablePreview|notSuitablePreview|raw_response|rawResponse|result)$') {
        $clean[$p.Name] = Protect-Object $p.Value
      }
    }
    return [pscustomobject]$clean
  }
  if ($value -is [array]) {
    $items = @(); foreach ($item in $value) { $items += ,(Protect-Object $item) }
    return ,$items
  }
  return $value
}
function Save-Diagnostic([System.IO.FileInfo]$file) {
  $relative = $file.FullName.Substring($source.Length).TrimStart('\')
  if (-not $file.FullName.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'SOURCE_PATH_INVALID' }
  if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
  if ($file.Length -gt 16MB -or $script:totalBytes -gt 80MB) {
    $issues.Add([pscustomobject]@{ file = $relative; reason = 'SIZE_LIMIT' }); return
  }
  try {
    $truncated = $false
    if ($file.Extension -eq '.jsonl') {
      $lines = @(Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Tail 2000)
      $truncated = $true # Explicit bounded tail, never a claim of complete history.
      $cleanLines = New-Object System.Collections.Generic.List[string]
      foreach ($line in $lines) {
        if (-not $line.Trim()) { continue }
        try { $cleanLines.Add((ConvertTo-Json -InputObject (Protect-Object (ConvertFrom-Json -InputObject $line)) -Depth 80 -Compress)) }
        catch { $issues.Add([pscustomobject]@{ file = $relative; reason = 'INVALID_JSONL_LINE_OMITTED' }) }
      }
      $content = ($cleanLines -join "`n") + "`n"
    } else {
      $content = ConvertTo-Json -InputObject (Protect-Object (ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($file.FullName)))) -Depth 80
    }
    $destination = Join-Path $bundle $relative
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    [IO.File]::WriteAllText($destination, $content, $utf8)
    $script:totalBytes += $utf8.GetByteCount($content)
    $inventory.Add([pscustomobject]@{ file = $relative; sourceBytes = $file.Length; lastWriteUtc = $file.LastWriteTimeUtc.ToString('o'); tailOnly = $truncated })
  } catch { $issues.Add([pscustomobject]@{ file = $relative; reason = 'READ_OR_PARSE_FAILED'; errorType = $_.Exception.GetType().Name }) }
}
function Read-Tree([string]$path) {
  foreach ($entry in (Get-ChildItem -LiteralPath $path -Force)) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    if ($entry.PSIsContainer) { Read-Tree $entry.FullName } else { $entry }
  }
}

Write-Host 'Dang gom trang thai va log. Khong thay doi du lieu CSD...'
foreach ($item in @('latest-run.json', 'active-campaign-draft.json', 'browser-profiles.json', 'user-config.json')) {
  $path = Join-Path $source $item
  if (Test-Path -LiteralPath $path -PathType Leaf) { Save-Diagnostic (Get-Item -LiteralPath $path) }
}
$allowed = @('run-state.json', 'opportunity-config.json', 'manifest.json', 'query-tasks.json', 'checkpoint.json',
  'status.json', 'receipt.json', 'events.jsonl', 'discovery-attempt.json', 'draft.json', 'draft-allocation.json',
  'draft-cost.json', 'draft-failure.json', 'intent-generation.json', 'model-routing.json', 'model-ledger.jsonl',
  'campaign.json', 'filter-recipe.json', 'planner-recipe.json')
$collections = Join-Path $source 'collections'
if (Test-Path -LiteralPath $collections -PathType Container) {
  # Include failed preparations as well as completed runs, plus both active pointers.
  $runs = @(Get-ChildItem -LiteralPath $collections -Directory | Where-Object { $_.Name -match '^crawl-[0-9a-f-]{36}$' -and ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 } | Sort-Object LastWriteTimeUtc -Descending)
  $chosen = @($runs | Select-Object -First 12)
  foreach ($pointer in @('latest-run.json', 'active-campaign-draft.json')) {
    try {
      $state = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText((Join-Path $source $pointer)))
      $id = if ($pointer -eq 'latest-run.json') { $state.id } else { $state.runId }
      $chosen += @($runs | Where-Object { $_.Name -eq $id })
    } catch { }
  }
  foreach ($run in ($chosen | Sort-Object FullName -Unique)) {
    foreach ($file in (Read-Tree $run.FullName)) {
      if ($allowed -contains $file.Name) { Save-Diagnostic $file }
    }
  }
  $runIndex = @($runs | Select-Object Name, LastWriteTimeUtc)
} else { $runIndex = @() }
$rateDirectory = Join-Path $source 'rate-limits'
if (Test-Path -LiteralPath $rateDirectory -PathType Container) {
  Get-ChildItem -LiteralPath $rateDirectory -File -Filter '*.json' | ForEach-Object { Save-Diagnostic $_ }
}
$markers = @()
$markerDirectory = Join-Path $source 'session-snapshots'
if (Test-Path -LiteralPath $markerDirectory -PathType Container) {
  $markers = @(Get-ChildItem -LiteralPath $markerDirectory -File | Where-Object { $_.Name -match '^csd-[0-9a-f-]{36}\.(dirty|restoring)$' } | Select-Object Name, LastWriteTimeUtc)
}
$report = [ordered]@{
  format = 'CSD_SUPPORT_V1'; capturedAt = (Get-Date).ToString('o'); powershell = $PSVersionTable.PSVersion.ToString()
  windows = [Environment]::OSVersion.VersionString; is64BitOS = [Environment]::Is64BitOperatingSystem
  logicalProcessors = [Environment]::ProcessorCount; runs = $runIndex; sessionMarkers = $markers
  files = @($inventory.ToArray()); omissions = @($issues.ToArray())
  notes = @('Last 12 runs plus latest/active draft; each JSONL contains at most last 2000 lines.',
    'No browser sessions, encrypted secrets, environment variables, post datasets, or AI response bodies collected.',
    'Prompt, keywords, settings, account labels, timing, cost events and local paths may appear.',
    'Original data is unchanged. Bundle does not include the separate machine-wide spending database.')
}
[IO.File]::WriteAllText((Join-Path $bundle 'diagnostic-manifest.json'), (ConvertTo-Json -InputObject $report -Depth 20), $utf8)
Compress-Archive -LiteralPath $bundle -DestinationPath $zip -CompressionLevel Optimal
Write-Host ''
Write-Host ('DA TAO: ' + $zip) -ForegroundColor Green
Write-Host ('So file chan doan: ' + $inventory.Count + '. Muc khong doc duoc/luoc bot: ' + $issues.Count)
Write-Host 'Gui file ZIP nay vao cuoc tro chuyen. Khong can gui thu muc browser hay secrets.'
Write-Output $zip
