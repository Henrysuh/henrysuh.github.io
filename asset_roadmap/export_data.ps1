# the_architect.xlsx (비용v2 (수정) 시트) → data.json 변환 스크립트
# 사용법: life\ 폴더에서 .\export_data.ps1

$xlsxPath = (Resolve-Path "..\the_architect.xlsx").Path
$sheetName = "비용v2 (수정)"

# 이미 열려 있는 Excel 인스턴스 재사용 (사용자가 엑셀 작업 중이어도 안전)
$alreadyOpen = $false
try {
    $excel = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
    $alreadyOpen = $true
} catch {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
}
$excel.DisplayAlerts = $false

$wb = $null
foreach ($w in @($excel.Workbooks | ForEach-Object { $_ })) {
    if ($w.FullName -eq $xlsxPath) { $wb = $w; break }
}
if ($null -eq $wb) { $wb = $excel.Workbooks.Open($xlsxPath) }

$ws = $wb.Sheets($sheetName)

function CellNum($ws, $r, $c) {
    $v = $ws.Cells($r, $c).Value2
    if ($null -eq $v -or $v -eq "") { return $null }
    try { return [double]$v } catch { return $null }
}
function CellStr($ws, $r, $c) {
    $v = $ws.Cells($r, $c).Text.Trim()
    if ($v -eq "") { return $null }
    return $v
}
function CellInt($ws, $r, $c) {
    $n = CellNum $ws $r $c
    if ($null -eq $n) { return $null }
    return [int]$n
}
function CellOX($ws, $r, $c) {
    $v = $ws.Cells($r, $c).Text.Trim()
    if ($v -eq "O" -or $v -eq "X") { return $v }
    return "X"
}

# 페르소나 블록 시작 열 (1-based): approach, 실행, code, 개수, 가격, 내용연수, 사용시간/횟수, 사용빈도, 단가, 소모품가격, 소모품연수 (계산열은 skip)
function BuildPersona($ws, $r, $startCol) {
    return [ordered]@{
        approach = CellStr $ws $r $startCol
        실행     = CellStr $ws $r ($startCol + 1)
        code     = CellInt $ws $r ($startCol + 2)
        qty      = CellNum $ws $r ($startCol + 3)
        price    = CellNum $ws $r ($startCol + 4)
        life     = CellNum $ws $r ($startCol + 5)
        freq     = CellNum $ws $r ($startCol + 6)
        period   = CellNum $ws $r ($startCol + 7)
        unit     = CellNum $ws $r ($startCol + 8)
        conP     = CellNum $ws $r ($startCol + 9)
        conL     = CellNum $ws $r ($startCol + 10)
    }
}

$items = [System.Collections.Generic.List[object]]::new()
$lastRow = $ws.UsedRange.Rows.Count

for ($r = 3; $r -le $lastRow; $r++) {
    $cat = $ws.Cells($r, 1).Text.Trim()
    $sub = $ws.Cells($r, 2).Text.Trim()
    if ($cat -eq "" -and $sub -eq "") { continue }

    $item = [ordered]@{
        uid     = CellInt $ws $r 3
        대분류  = CellStr $ws $r 1
        소분류  = CellStr $ws $r 2
        아이템  = CellStr $ws $r 4
        설계자  = BuildPersona $ws $r 5
        소비자  = BuildPersona $ws $r 17
        노동자  = BuildPersona $ws $r 29
        가구    = [ordered]@{
            싱글남 = CellOX $ws $r 41
            싱글여 = CellOX $ws $r 42
            커플   = CellOX $ws $r 43
            가족   = CellOX $ws $r 44
            시니어 = CellOX $ws $r 45
        }
    }
    $items.Add($item)
}

if (-not $alreadyOpen) {
    $wb.Close($false)
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}

$json = @($items) | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$outPath = Join-Path (Resolve-Path ".\").Path "data.json"
[System.IO.File]::WriteAllText($outPath, $json, $utf8NoBom)

Write-Host "완료: $($items.Count)개 항목 → data.json"
