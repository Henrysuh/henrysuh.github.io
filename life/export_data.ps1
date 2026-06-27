# the_architect.xlsx → data.json 변환 스크립트
# 사용법: 이 파일이 있는 폴더에서 PowerShell 실행 후 .\export_data.ps1

$xlsxPath = "..\the_architect.xlsx"
$outPath  = ".\data.json"

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open((Resolve-Path $xlsxPath).Path)
$ws = $wb.Sheets[7]  # 비용분析2

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
function CellOX($ws, $r, $c) {
    $v = $ws.Cells($r, $c).Text.Trim()
    if ($v -eq "○") { return "O" }
    return "X"
}

$items = [System.Collections.Generic.List[object]]::new()
$lastRow = $ws.UsedRange.Rows.Count
$id = 1

for ($r = 2; $r -le $lastRow; $r++) {
    # 대분류·소분류 둘 다 비어 있으면 스킵
    if ($ws.Cells($r, 2).Text.Trim() -eq "" -and $ws.Cells($r, 3).Text.Trim() -eq "") { continue }

    # 가구구성 O/X (Col 70~74)
    $gauMap = [ordered]@{
        "싱글남"   = CellOX $ws $r 70
        "싱글여"   = CellOX $ws $r 71
        "커플"     = CellOX $ws $r 72
        "가족"     = CellOX $ws $r 73
        "시니어"   = CellOX $ws $r 74
    }

    # 페르소나 정의 (approach·실행방법·유형·비용 컬럼)
    # 설계자: approach=4, 실행방법=5, 유형=10, 가격=11..소모품연수=17
    # 소비자: approach=6, 실행방법=7, 유형=19, 가격=20..소모품연수=26
    # 노동자: approach=8, 실행방법=9, 유형=28, 가격=29..소모품연수=35
    $pDef = @(
        @{ key="설계자"; appr=4;  exec=5;  유형=10; 가격=11; 내용연수=12; 사용시간=13; 사용횟수=14; 단가=15; 소모품가격=16; 소모품연수=17 },
        @{ key="소비자"; appr=6;  exec=7;  유형=19; 가격=20; 내용연수=21; 사용시간=22; 사용횟수=23; 단가=24; 소모품가격=25; 소모품연수=26 },
        @{ key="노동자"; appr=8;  exec=9;  유형=28; 가격=29; 내용연수=30; 사용시간=31; 사용횟수=32; 단가=33; 소모품가격=34; 소모품연수=35 }
    )

    $personas = [ordered]@{}
    foreach ($p in $pDef) {
        $유형Val = $ws.Cells($r, $p.유형).Value2
        $유형Int = if ($null -ne $유형Val -and $유형Val -ne "") { [int][double]$유형Val } else { 0 }
        $personas[$p.key] = [ordered]@{
            approach      = CellStr $ws $r $p.appr
            실행방법      = CellStr $ws $r $p.exec
            유형          = $유형Int
            가격          = CellNum $ws $r $p.가격
            내용연수      = CellNum $ws $r $p.내용연수
            사용시간      = CellNum $ws $r $p.사용시간
            사용횟수      = CellNum $ws $r $p.사용횟수
            단가          = CellNum $ws $r $p.단가
            소모품가격    = CellNum $ws $r $p.소모품가격
            소모품내용연수 = CellNum $ws $r $p.소모품연수
        }
    }

    $item = [ordered]@{
        id     = $id++
        대분류 = CellStr $ws $r 2
        소분류 = CellStr $ws $r 3
        가구   = $gauMap
        설계자 = $personas["설계자"]
        소비자 = $personas["소비자"]
        노동자 = $personas["노동자"]
    }
    $items.Add($item)
}

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null

$json = $items | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Resolve-Path ".\").Path + "\data.json", $json, [System.Text.Encoding]::UTF8)
Write-Host "완료: $($items.Count)개 항목 → data.json"
