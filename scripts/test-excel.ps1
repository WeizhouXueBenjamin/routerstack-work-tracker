$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$artifactFolder = Join-Path ([System.IO.Path]::GetTempPath()) ('routerstack-excel-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $artifactFolder)
$excelTest = $null
$bookTest = $null
function Assert-Value($actual, $expected, [string]$label) {
  if ($null -eq $expected) {
    if ($null -ne $actual -and $actual -ne '') { throw "$label expected blank, received $actual" }
  } elseif ($expected -is [string]) {
    if ($actual -cne $expected) { throw "$label expected $expected, received $actual" }
  } elseif ($null -eq $actual -or [math]::Abs([double]$actual - [double]$expected) -gt 0.0000001) {
    throw "$label expected $expected, received $actual"
  }
}
function Assert-Workbook($book, $expected) {
  $log = $book.Worksheets.Item('Work Log')
  $tool = $book.Worksheets.Item('Tool')
  for ($i=0; $i -lt $expected.calculations.Count; $i++) {
    $row = $i + 6
    $calc = $expected.calculations[$i]
    foreach ($pair in @(@('G','total'),@('I','diff'),@('P','raw'),@('Q','bill'),@('R','ah'),@('S','rawAH'))) {
      Assert-Value $log.Range($pair[0]+$row).Value2 $calc.($pair[1]) ($pair[0]+$row)
    }
    if ($expected.records[$i].kind -eq 'Job') {
      Assert-Value $log.Range('T'+$row).Value2 $calc.base ('T'+$row)
      Assert-Value $log.Range('F'+$row).Value2 ('{0:0.00} ({1:0.00})' -f $calc.bill,$calc.ah) ('F'+$row)
    }
  }
  $jobs = @($expected.records | Where-Object { $_.kind -eq 'Job' }).Count
  $total = ($expected.calculations | Measure-Object -Property total -Sum).Sum
  $app = ($expected.records | ForEach-Object { if ($_.app -ne '') { [double]$_.app } } | Measure-Object -Sum).Sum
  $diff = ($expected.calculations | Measure-Object -Property diff -Sum).Sum
  Assert-Value $tool.Range('B6').Value2 $jobs 'Tool!B6'
  Assert-Value $tool.Range('B7').Value2 $total 'Tool!B7'
  Assert-Value $tool.Range('B8').Value2 $app 'Tool!B8'
  Assert-Value $tool.Range('B9').Value2 $diff 'Tool!B9'
  Assert-Value $tool.Range('B10').Value2 22.5 'Tool!B10'
}
try {
  & node (Join-Path $PSScriptRoot 'excel-fixtures.mjs') prepare $artifactFolder
  if ($LASTEXITCODE -ne 0) { throw 'Preparing Excel fixtures failed' }
  $expectations = Get-Content -LiteralPath (Join-Path $artifactFolder 'expected.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $excelTest = New-Object -ComObject Excel.Application
  $excelTest.Visible = $false
  $excelTest.DisplayAlerts = $false
  $excelTest.EnableEvents = $false
  $excelTest.AutomationSecurity = 3
  $excelVersion = $excelTest.Version
  $bookTest = $excelTest.Workbooks.Open((Join-Path $artifactFolder 'source.xlsx'),0,$false)
  $excelTest.CalculateFullRebuild()
  Assert-Workbook $bookTest $expectations.original
  $bookTest.SaveAs((Join-Path $artifactFolder 'excel-resaved.xlsx'),51)
  $logTest = $bookTest.Worksheets.Item('Work Log')
  $configTest = $bookTest.Worksheets.Item('Config')
  $logTest.Range('D6').Value2 = 0.25
  $logTest.Range('E6').Value2 = 65.0
  $logTest.Range('N6').Value2 = 30.0
  $logTest.Range('H6').Value2 = 0.0
  $logTest.Range('J6').Value2 = 'Synthetic edited in Excel'
  $configTest.Range('B6').Value2 = 18.5/24
  $excelTest.CalculateFullRebuild()
  Assert-Workbook $bookTest $expectations.edited
  $configTest.Move($bookTest.Worksheets.Item(1))
  $bookTest.SaveAs((Join-Path $artifactFolder 'excel-edited-reordered.xlsx'),51)
  $bookTest.Close($false); $bookTest=$null
  $bookTest=$excelTest.Workbooks.Open((Join-Path $artifactFolder 'legacy.xlsx'),0,$false)
  $excelTest.CalculateFullRebuild()
  Assert-Value $bookTest.Worksheets.Item('Work Log').Range('G6').Value2 150 'Legacy!G6'
  $bookTest.SaveAs((Join-Path $artifactFolder 'legacy-resaved.xlsx'),51)
  $bookTest.Close($false); $bookTest=$null
  & node (Join-Path $PSScriptRoot 'excel-fixtures.mjs') verify $artifactFolder
  if ($LASTEXITCODE -ne 0) { throw 'Verifying Excel round trip failed' }
  $bookTest=$excelTest.Workbooks.Open((Join-Path $artifactFolder 'tool-resaved.xlsx'),0,$true)
  $excelTest.CalculateFullRebuild()
  Assert-Workbook $bookTest $expectations.edited
  [PSCustomObject]@{ Result='PASS'; ExcelVersion=$excelVersion; Records=$expectations.original.records.Count; Artifacts=$artifactFolder } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $bookTest) { $bookTest.Close($false) }
  if ($null -ne $excelTest) { $excelTest.Quit(); [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelTest) }
}
