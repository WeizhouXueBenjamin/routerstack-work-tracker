$ErrorActionPreference = 'Stop'
$artifactFolder = Join-Path ([System.IO.Path]::GetTempPath()) ('routerstack-excel-v4-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $artifactFolder)
$excelV4 = $null
$bookV4 = $null
function Assert-V4($condition, [string]$label) { if (-not $condition) { throw $label } }
try {
  & node (Join-Path $PSScriptRoot 'excel-v4-fixtures.mjs') prepare $artifactFolder
  if ($LASTEXITCODE -ne 0) { throw 'Preparing v4 Excel fixture failed' }
  $expectedV4 = Get-Content -LiteralPath (Join-Path $artifactFolder 'v4-expected.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $excelV4 = New-Object -ComObject Excel.Application
  $excelV4.Visible = $false
  $excelV4.DisplayAlerts = $false
  $excelV4.EnableEvents = $false
  $excelV4.AutomationSecurity = 3
  $bookV4 = $excelV4.Workbooks.Open((Join-Path $artifactFolder 'v4-source.xlsx'),0,$false)
  Assert-V4 (-not $bookV4.RepairMode) 'Excel repaired the v4 workbook'
  Assert-V4 ($bookV4.Worksheets.Count -eq 6) 'Expected six v4 Sheets'
  $tableCountV4 = 0
  foreach ($sheetV4 in $bookV4.Worksheets) { $tableCountV4 += $sheetV4.ListObjects.Count }
  Assert-V4 ($tableCountV4 -eq 20) 'Expected twenty transparent v4 Tables'
  Assert-V4 ($bookV4.Worksheets.Item('Config').Range('B10').Value2 -ceq $expectedV4.schemaVersion) 'Workbook schema version'
  $recordTableV4 = $bookV4.Worksheets.Item('Entries').ListObjects.Item('RS_records')
  Assert-V4 ($recordTableV4.ListColumns.Item($recordTableV4.ListColumns.Count).Name -ceq 'reminderKinds') 'Appended reminder scope column'
  $issueTableV4 = $bookV4.Worksheets.Item('Reconciliation').ListObjects.Item('RS_issues')
  Assert-V4 ($issueTableV4.ListColumns.Item($issueTableV4.ListColumns.Count).Name -ceq 'amountCents') 'Appended nullable reference amount column'
  $logV4 = $bookV4.Worksheets.Item('Work Log')
  Assert-V4 ($logV4.Range('U6').Value2 -ceq $expectedV4.targetId) 'First stable Record ID'
  Assert-V4 ($logV4.Range('J6').Value2 -ceq $expectedV4.note) 'Note whitespace/newline preserved'
  Assert-V4 ($logV4.Range('U:V').EntireColumn.Hidden) 'ID/Site columns remain hidden'
  $excelV4.CalculateFullRebuild()
  Assert-V4 ($logV4.Range('G6').Value2 -eq 180) 'First expected income'
  Assert-V4 ($logV4.Range('G7').Value2 -eq 120) 'Second expected income'
  Assert-V4 ($bookV4.Worksheets.Item('Tool').Range('B10').Value2 -eq 107.35) 'Opening and confirmed remaining balance stay separate from new income'
  $bookV4.SaveAs((Join-Path $artifactFolder 'v4-excel-resaved.xlsx'),51)
  $workTableV4 = $logV4.ListObjects.Item('RS_WorkLog')
  $workTableV4.Sort.SortFields.Clear()
  [void]$workTableV4.Sort.SortFields.Add($workTableV4.ListColumns.Item('Invoice ID').Range,0,2)
  $workTableV4.Sort.Header = 1
  $workTableV4.Sort.Apply()
  Assert-V4 ($logV4.Range('U6').Value2 -ceq $expectedV4.secondId) 'Sorting carries stable ID with the second Invoice'
  Assert-V4 ($logV4.Range('U7').Value2 -ceq $expectedV4.targetId) 'Sorting carries stable ID with the first Invoice'
  $bookV4.SaveAs((Join-Path $artifactFolder 'v4-excel-sorted.xlsx'),51)
  $logV4.Range('H7').Value2 = 170.0
  $logV4.Range('E7').Value2 = 65.0
  $bookV4.Worksheets.Item('Config').Range('B6').Value2 = 18.5/24
  $excelV4.CalculateFullRebuild()
  $bookV4.SaveAs((Join-Path $artifactFolder 'v4-excel-edited.xlsx'),51)
  $bookV4.Close($false); $bookV4=$null
  & node (Join-Path $PSScriptRoot 'excel-v4-fixtures.mjs') verify $artifactFolder
  if ($LASTEXITCODE -ne 0) { throw 'Verifying v4 Excel round trip failed' }
  $bookV4=$excelV4.Workbooks.Open((Join-Path $artifactFolder 'v4-tool-resaved.xlsx'),0,$true)
  Assert-V4 (-not $bookV4.RepairMode) 'Excel repaired the Tool re-export'
  $excelV4.CalculateFullRebuild()
  $logV4=$bookV4.Worksheets.Item('Work Log')
  Assert-V4 ($logV4.Range('U6').Value2 -ceq $expectedV4.targetId) 'Re-export uses persistent IDs rather than row order'
  Assert-V4 ($logV4.Range('H6').Value2 -eq 170) 'App edit accepted after review'
  Assert-V4 ($logV4.Range('E6').Value2 -eq 65) 'Rate edit accepted after review'
  Assert-V4 ($logV4.Range('G6').Value2 -eq 195) 'Recomputed income is 2 AH hours * 1.5 * 65'
  Assert-V4 ($logV4.Range('J6').Value2 -ceq $expectedV4.note) 'Re-export preserves note whitespace/newline'
  $bookV4.Close($false); $bookV4=$null
  foreach ($cycleFileV4 in @('v4-cycle-one','v4-cycle-two')) {
    $bookV4=$excelV4.Workbooks.Open((Join-Path $artifactFolder ($cycleFileV4 + '.xlsx')),0,$false)
    Assert-V4 (-not $bookV4.RepairMode) 'Excel repaired a carried workbook'
    $excelV4.CalculateFullRebuild()
    Assert-V4 ($null -eq $bookV4.Worksheets.Item('Work Log').Range('U6').Value2) 'New-cycle Work Log must be empty'
    Assert-V4 ($bookV4.Worksheets.Item('Tool').Range('B10').Value2 -eq 107.35) 'Carry balance must not be deducted twice'
    $bookV4.SaveAs((Join-Path $artifactFolder ($cycleFileV4 + '-excel.xlsx')),51)
    $bookV4.Close($false); $bookV4=$null
  }
  & node (Join-Path $PSScriptRoot 'excel-v4-fixtures.mjs') verify-carry $artifactFolder
  if ($LASTEXITCODE -ne 0) { throw 'Verifying carried v4 Excel fixtures failed' }
  [PSCustomObject]@{Result='PASS';Schema=$expectedV4.schemaVersion;ExcelVersion=$excelV4.Version;Tables=$tableCountV4;Jobs=2;Opening=1;Pending=1;Payments=2;Batches=2;Allocations=1;CarryCycles=2;Artifacts=$artifactFolder} | ConvertTo-Json -Compress
} finally {
  if ($null -ne $bookV4) { $bookV4.Close($false) }
  if ($null -ne $excelV4) { $excelV4.Quit(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelV4) }
}
