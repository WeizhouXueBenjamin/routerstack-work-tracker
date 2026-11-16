$ErrorActionPreference = 'Stop'
$artifactFolder = Join-Path ([System.IO.Path]::GetTempPath()) ('routerstack-excel-v5-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $artifactFolder)
$excelTest = $null
$bookTest = $null
function Run-Fixture([string]$mode) {
  & node (Join-Path $PSScriptRoot 'excel-fixtures.mjs') $mode $artifactFolder
  if ($LASTEXITCODE -ne 0) { throw "Schema 5 fixture stage failed: $mode" }
}
function Assert-Value($actual, $expected, [string]$label) {
  if ($null -eq $expected) {
    if ($null -ne $actual -and $actual -ne '') { throw "$label expected blank, received $actual" }
  } elseif ($expected -is [string]) {
    if ($actual -cne $expected) { throw "$label expected $expected, received $actual" }
  } elseif ($null -eq $actual -or [math]::Abs([double]$actual - [double]$expected) -gt 0.0000001) {
    throw "$label expected $expected, received $actual"
  }
}
function Check-Structure($book) {
  Assert-Value $book.Worksheets.Count 4 'Sheet count'
  $tableCount=0
  foreach ($sheet in $book.Worksheets) { $tableCount += $sheet.ListObjects.Count }
  Assert-Value $tableCount 8 'Table count'
}
function Sort-Filter-Save($book, [string]$filename) {
  $log=$book.Worksheets.Item('Work Log')
  $table=$log.ListObjects.Item('RS_WorkLog')
  $table.Sort.SortFields.Clear()
  [void]$table.Sort.SortFields.Add($table.ListColumns.Item('Date').Range,0,2)
  $table.Sort.Header=1
  $table.Sort.Apply()
  [void]$table.Range.AutoFilter(14,'Historical')
  if ($table.AutoFilter.FilterMode) { $table.AutoFilter.ShowAllData() }
  [void]$table.Range.AutoFilter(14,'Historical')
  $excelTest.CalculateFullRebuild()
  for ($i=1; $i -le $table.ListRows.Count; $i++) {
    $type=$table.DataBodyRange.Cells.Item($i,14).Value2
    if ($type -eq 'Historical') {
      for ($c=1; $c -le 8; $c++) {
        $cell=$table.DataBodyRange.Cells.Item($i,$c)
        if ($cell.DisplayFormat.Interior.Color -ne 15790320) {
          foreach ($condition in $cell.FormatConditions) {
            Write-Output ('CF diagnostic: cell={0}; formula={1}; appliesTo={2}; color={3}; pattern={4}' -f $cell.Address(),$condition.Formula1,$condition.AppliesTo.Address(),$condition.Interior.Color,$condition.Interior.Pattern)
          }
          $book.SaveAs((Join-Path $artifactFolder 'excel-color-failure.xlsx'),51)
        }
        Assert-Value $cell.DisplayFormat.Interior.Color 15790320 ('Historical fill '+$i+':'+$c)
      }
    } elseif ($table.DataBodyRange.Cells.Item($i,1).DisplayFormat.Interior.Color -eq 15790320) {
      throw 'Current row incorrectly uses Historical gray fill'
    }
  }
  $book.SaveAs((Join-Path $artifactFolder $filename),51)
}
try {
  Run-Fixture 'prepare'
  try { $excelTest=New-Object -ComObject Excel.Application }
  catch { Write-Output ('UNVERIFIED: Excel COM unavailable. HRESULT=0x{0:X8}; artifacts={1}' -f ($_.Exception.HResult -band 0xffffffffL),$artifactFolder); throw }
  $excelTest.Visible=$false
  $excelTest.DisplayAlerts=$false
  $excelTest.EnableEvents=$false
  $excelTest.AutomationSecurity=3
  $expected=Get-Content -LiteralPath (Join-Path $artifactFolder 'expected.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  $bookTest=$excelTest.Workbooks.Open((Join-Path $artifactFolder 'source.xlsx'),0,$false)
  Check-Structure $bookTest
  $excelTest.CalculateFullRebuild()
  $log=$bookTest.Worksheets.Item('Work Log')
  for ($i=0; $i -lt $expected.records.Count; $i++) {
    $row=$expected.top+1+$i
    $record=$expected.records[$i]
    foreach ($pair in @(@('D','lengthHours'),@('F','total'),@('L','diff'),@('U','raw'),@('V','bill'),@('W','ah'),@('X','rawAH'),@('Y','base'))) {
      Assert-Value $log.Range($pair[0]+$row).Value2 $record.($pair[1]) ($pair[0]+$row)
    }
  }
  for ($i=0; $i -lt $expected.summary.Count; $i++) {
    $row=$i+3
    Assert-Value $log.Range('B'+$row).Value2 $expected.summary[$i].estimated ('Summary B'+$row)
    Assert-Value $log.Range('C'+$row).Value2 $expected.summary[$i].app ('Summary C'+$row)
    Assert-Value $log.Range('D'+$row).Value2 $expected.summary[$i].difference ('Summary D'+$row)
  }
  Sort-Filter-Save $bookTest 'excel-resaved.xlsx'
  $bookTest.Close($false);$bookTest=$null
  Run-Fixture 'verify-first'
  $bookTest=$excelTest.Workbooks.Open((Join-Path $artifactFolder 'tool-resaved.xlsx'),0,$true)
  Check-Structure $bookTest
  $excelTest.CalculateFullRebuild()
  $bookTest.Close($false);$bookTest=$null
  foreach ($cycle in @(1,2)) {
    $bookTest=$excelTest.Workbooks.Open((Join-Path $artifactFolder ('next'+$cycle+'.xlsx')),0,$false)
    Check-Structure $bookTest
    Sort-Filter-Save $bookTest ('next'+$cycle+'-resaved.xlsx')
    $bookTest.Close($false);$bookTest=$null
    if ($cycle -eq 1) { Run-Fixture 'verify-next1' } else { Run-Fixture 'verify-final' }
  }
  [PSCustomObject]@{Result='PASS';Schema='5.0';ExcelVersion=$excelTest.Version;Cycles=2;Artifacts=$artifactFolder} | ConvertTo-Json -Compress
} finally {
  if ($null -ne $bookTest) { $bookTest.Close($false) }
  if ($null -ne $excelTest) { $excelTest.Quit();[void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelTest) }
}
