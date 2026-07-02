# 비용v2 시트 생성 스크립트
# 열 구조: 공통 4열 + 페르소나 9열×3 + 가구 5열 = 36열
# 사용법: life\ 폴더에서 .\create_v2_sheet.ps1

$xlsxPath = (Resolve-Path "..\the_architect.xlsx").Path
$sheetName = "비용v2"

# 이미 열려 있는 Excel 인스턴스 재사용
$alreadyOpen = $false
try {
    $excel = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
    $alreadyOpen = $true
} catch {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
}
$excel.DisplayAlerts = $false

# 이미 열려 있는 워크북 찾기, 없으면 열기
$wb = $null
foreach ($w in @($excel.Workbooks | ForEach-Object { $_ })) {
    if ($w.FullName -eq $xlsxPath) { $wb = $w; break }
}
if ($null -eq $wb) { $wb = $excel.Workbooks.Open($xlsxPath) }

# 기존 동명 시트 삭제
foreach ($s in @($wb.Sheets | ForEach-Object { $_ })) {
    if ($s.Name -eq $sheetName) { $s.Delete(); break }
}
$ws = $wb.Sheets.Add([Type]::Missing, $wb.Sheets[$wb.Sheets.Count])
$ws.Name = $sheetName

# ── 컬럼 레이아웃 ────────────────────────────────────────
# 공통   : 1=대분류  2=소분류  3=고유번호  4=비용정의
# 설계자 : 5=approach  6=가격  7=내용연수  8=사용시간  9=사용횟수  10=단가  11=소모품가격  12=소모품연수  13=월비용(계산)
# 소비자 : 14~22  (같은 패턴)
# 노동자 : 23~31  (같은 패턴)
# 가구   : 32=싱글남  33=싱글여  34=커플  35=가족  36=시니어

$P_OFF = @{ 설계자 = 5; 소비자 = 14; 노동자 = 23 }   # 각 페르소나 시작 열 (1-based)
# 페르소나 내 상대 위치:  0=approach 1=가격 2=내용연수 3=사용시간 4=사용횟수 5=단가 6=소모품가격 7=소모품연수 8=월비용

$headers2 = @(
    "대분류", "소분류", "고유번호", "비용정의",
    "설계자_approach","설계자_가격","설계자_내용연수(년)","설계자_사용시간(월h)","설계자_사용횟수(배율)","설계자_단가(원/h)","설계자_소모품가격","설계자_소모품연수(년)","설계자_월비용(계산)",
    "소비자_approach","소비자_가격","소비자_내용연수(년)","소비자_사용시간(월h)","소비자_사용횟수(배율)","소비자_단가(원/h)","소비자_소모품가격","소비자_소모품연수(년)","소비자_월비용(계산)",
    "노동자_approach","노동자_가격","노동자_내용연수(년)","노동자_사용시간(월h)","노동자_사용횟수(배율)","노동자_단가(원/h)","노동자_소모품가격","노동자_소모품연수(년)","노동자_월비용(계산)",
    "싱글남","싱글여","커플","가족","시니어"
)

# ── 색상 ─────────────────────────────────────────────────
$clrHdrBase = 0x1E3048
$clrHdrD    = 0x2D6E5A  ; $clrDataD = 0xDFF2EB
$clrHdrG    = 0x2B5278  ; $clrDataG = 0xDDECF8
$clrHdrW    = 0x7A5A1E  ; $clrDataW = 0xFDF3DC
$clrHdrHH   = 0x3A3A3A
$clrCalc    = 0xE8E8E8  # 계산 열: 연회색

# 헤더 행당 색상 (36열)
$hdrColors = @(
    $clrHdrBase,$clrHdrBase,$clrHdrBase,$clrHdrBase,
    $clrHdrD,$clrHdrD,$clrHdrD,$clrHdrD,$clrHdrD,$clrHdrD,$clrHdrD,$clrHdrD,$clrHdrD,
    $clrHdrG,$clrHdrG,$clrHdrG,$clrHdrG,$clrHdrG,$clrHdrG,$clrHdrG,$clrHdrG,$clrHdrG,
    $clrHdrW,$clrHdrW,$clrHdrW,$clrHdrW,$clrHdrW,$clrHdrW,$clrHdrW,$clrHdrW,$clrHdrW,
    $clrHdrHH,$clrHdrHH,$clrHdrHH,$clrHdrHH,$clrHdrHH
)
# 데이터 행 열별 배경
$dataColors = @(
    $null,$null,$null,$null,
    $clrDataD,$clrDataD,$clrDataD,$clrDataD,$clrDataD,$clrDataD,$clrDataD,$clrDataD,$clrCalc,
    $clrDataG,$clrDataG,$clrDataG,$clrDataG,$clrDataG,$clrDataG,$clrDataG,$clrDataG,$clrCalc,
    $clrDataW,$clrDataW,$clrDataW,$clrDataW,$clrDataW,$clrDataW,$clrDataW,$clrDataW,$clrCalc,
    $null,$null,$null,$null,$null
)

# ── 행1: 그룹 레이블 (병합 셀) ───────────────────────────
function Merge-Label($ws, $r, $c1, $c2, $text, $bgColor) {
    $range = $ws.Range($ws.Cells($r,$c1), $ws.Cells($r,$c2))
    $range.Merge()
    $range.Cells(1,1).Value2 = $text
    $range.Cells(1,1).Font.Bold = $true
    $range.Cells(1,1).Font.Color = 0xFFFFFF
    $range.Cells(1,1).Interior.Color = $bgColor
    $range.Cells(1,1).HorizontalAlignment = -4108
}
Merge-Label $ws 1  1  4  "공통 정보"         $clrHdrBase
Merge-Label $ws 1  5 13  "설계자 (아치)"      $clrHdrD
Merge-Label $ws 1 14 22  "소비자 (샤이니)"    $clrHdrG
Merge-Label $ws 1 23 31  "노동자 (토일)"      $clrHdrW
Merge-Label $ws 1 32 36  "가구 적용"          $clrHdrHH

# ── 행2: 세부 컬럼 헤더 ──────────────────────────────────
for ($c = 0; $c -lt $headers2.Count; $c++) {
    $cell = $ws.Cells(2, $c+1)
    $cell.Value2 = $headers2[$c]
    $cell.Font.Bold = $true
    $cell.Font.Color = 0xFFFFFF
    $cell.Interior.Color = $hdrColors[$c]
    $cell.HorizontalAlignment = -4108
    $cell.WrapText = $true
}
# 계산 열 헤더는 어두운 글자
foreach ($calcCol in @(13,22,31)) {
    $ws.Cells(2,$calcCol).Font.Color = 0x333333
    $ws.Cells(2,$calcCol).Font.Italic = $true
}

# ── 샘플 데이터: 겨울 난방 ───────────────────────────────
# 고유번호 = 목적(purpose) 단위
#   겨울 난방에 속하는 모든 행 → 고유번호 1
#   웹 앱에서 사용자가 체크한 행들을 고유번호로 합산 → 목적별 월비용
#
# 열 순서 (0-based index):
#   0=대분류 1=소분류 2=고유번호 3=비용정의
#   4=설D_approach 5=설D_가격 6=설D_내용연수 7=설D_사용시간 8=설D_사용횟수 9=설D_단가 10=설D_소모품가격 11=설D_소모품연수  (12=계산)
#   13=소G_approach 14=소G_가격 15=소G_내용연수 16=소G_사용시간 17=소G_사용횟수 18=소G_단가 19=소G_소모품가격 20=소G_소모품연수  (21=계산)
#   22=노W_approach 23=노W_가격 24=노W_내용연수 25=노W_사용시간 26=노W_사용횟수 27=노W_단가 28=노W_소모품가격 29=노W_소모품연수  (30=계산)
#   31=싱글남 32=싱글여 33=커플 34=가족 35=시니어

$O = "○"; $X = "✕"; $N = $null
$samples = @(
# 대분류  소분류       ID  비용정의              설D_appr     설D_가격  연수  시간   횟수   단가  소모품가  소모품연    소G_appr     소G_가격  연수  시간   횟수   단가   소모품가  소모품연    노W_appr     노W_가격 연수  시간   횟수   단가  소모품가  소모품연     싱남 싱여 커플 가족 시니어
  @("주거","겨울 난방",1,"온수매트 구입",         "CAPEX 효율",250000,  7,    $N,    $N,    $N,   $N,       $N,          $N,          $N,     $N,   $N,    $N,    $N,    $N,       $N,          "CAPEX 절약",80000, 3,    $N,    $N,    $N,   $N,       $N,          $O,$O,$O,$O,$O),
  @("주거","겨울 난방",1,"온수매트 전기세",        "OPEX 효율", $N,      $N,   210,   0.25,  120,  $N,       $N,          $N,          $N,     $N,   $N,    $N,    $N,    $N,       $N,          "OPEX 절약", $N,    $N,   180,   0.25,  120,  $N,       $N,          $O,$O,$O,$O,$O),
  @("주거","겨울 난방",1,"가스보일러 가동",        $N,          $N,      $N,   $N,    $N,    $N,   $N,       $N,          "OPEX 편의",  $N,     $N,   240,   2.2,   900,   $N,       $N,          "OPEX 관습", $N,    $N,   240,   1.5,   900,  $N,       $N,          $O,$O,$O,$O,$O),
  @("주거","겨울 난방",1,"뽁뽁이 에어캡",          "소모품 효율",$N,     $N,   $N,    $N,    $N,   10000,    1,           $N,          $N,     $N,   $N,    $N,    $N,    $N,       $N,          "소모품 절약",$N,   $N,   $N,    $N,    $N,   10000,    1,           $O,$O,$O,$O,$O),
  @("주거","겨울 난방",1,"수면양말",               $N,          $N,      $N,   $N,    $N,    $N,   $N,       $N,          $N,          $N,     $N,   $N,    $N,    $N,    $N,       $N,          "소모품 절약",$N,   $N,   $N,    $N,    $N,   15000,    1,           $O,$O,$O,$O,$O),
  @("주거","겨울 난방",1,"난방텐트 구입",          "CAPEX 효율",50000,   3,    $N,    $N,    $N,   $N,       $N,          $N,          $N,     $N,   $N,    $N,    $N,    $N,       $N,          $N,          $N,    $N,   $N,    $N,    $N,   $N,       $N,          $O,$O,$X,$X,$O),
  @("주거","겨울 난방",1,"지인 찬스 (온수매트)",   "지인 찬스", 0,       1,    $N,    $N,    $N,   $N,       $N,          $N,          $N,     $N,   $N,    $N,    $N,    $N,       $N,          $N,          $N,    $N,   $N,    $N,    $N,   $N,       $N,          $O,$O,$O,$O,$O)
)

# ── 데이터 쓰기 + 계산 열 수식 삽입 ─────────────────────
# 계산 열 수식 생성 함수
# 페르소나 시작 열 s (1-based): 가격=s+1, 연수=s+2, 시간=s+3, 횟수=s+4, 단가=s+5, 소모=s+6, 소모연=s+7, 계산=s+8
function Get-Formula($row, $startCol) {
    $p  = $startCol   # approach
    $pr = $startCol+1 # 가격
    $li = $startCol+2 # 내용연수
    $h  = $startCol+3 # 사용시간
    $f  = $startCol+4 # 사용횟수
    $u  = $startCol+5 # 단가
    $cp = $startCol+6 # 소모품가격
    $cl = $startCol+7 # 소모품연수
    # 열 문자 변환 (1→A, 27→AA ...)
    function ToCol($n) {
        $r = ""
        while ($n -gt 0) { $n--; $r = [char](65 + $n % 26) + $r; $n = [int]($n / 26) }
        $r
    }
    $cPr = ToCol $pr; $cLi = ToCol $li
    $cH  = ToCol $h;  $cF  = ToCol $f; $cU = ToCol $u
    $cCp = ToCol $cp; $cCl = ToCol $cl
    "=IFERROR(IF($cPr$row<>"""","+"$cPr$row/$cLi$row/12,0)+IF(AND($cH$row<>"""",$cF$row<>"""",$cU$row<>""""),$cH$row*$cF$row*$cU$row,0)+IF($cCp$row<>"""",$cCp$row/$cCl$row/12,0),0)"
}

$startRow = 3
for ($ri = 0; $ri -lt $samples.Count; $ri++) {
    $row = $samples[$ri]
    $r   = $startRow + $ri

    # 데이터 열 (계산 열 제외, 0-based 배열 인덱스 → 1-based 열)
    # 배열: 0~3 = 공통, 4~11 = 설D, 12~19 = 소G, 20~27 = 노W, 28~32 = 가구
    # 실제 Excel 열: 공통 1~4, 설D 5~12, 계산 13, 소G 14~21, 계산 22, 노W 23~30, 계산 31, 가구 32~36
    $arrToCol = @(1,2,3,4, 5,6,7,8,9,10,11,12, 14,15,16,17,18,19,20,21, 23,24,25,26,27,28,29,30, 32,33,34,35,36)

    for ($ci = 0; $ci -lt $row.Count; $ci++) {
        $col  = $arrToCol[$ci]
        $cell = $ws.Cells($r, $col)
        $v    = $row[$ci]
        if ($null -ne $v) {
            if ($v -is [string]) { $cell.Value2 = $v }
            else                 { $cell.Value2 = [double]$v }
        }
        if ($null -ne $dataColors[$col-1]) {
            $cell.Interior.Color = $dataColors[$col-1]
        }
        if ($col -ge 32) { $cell.HorizontalAlignment = -4108 }
    }

    # 계산 열 수식 (열 13, 22, 31)
    foreach ($startCol in @(5, 14, 23)) {
        $calcCol = $startCol + 8
        $cell = $ws.Cells($r, $calcCol)
        $cell.Formula = Get-Formula $r $startCol
        $cell.Interior.Color = $clrCalc
        $cell.NumberFormat = "#,##0"
        $cell.Font.Italic = $true
        $cell.Font.Color = 0x555555
    }

    # 행 테두리
    $ws.Range($ws.Cells($r,1), $ws.Cells($r,36)).Borders.LineStyle = 1
}

# ── 열 고정: A~D (대분류~비용정의) + 행 1~2 (헤더) ──────
$ws.Activate()
$ws.Application.ActiveWindow.SplitColumn = 4
$ws.Application.ActiveWindow.SplitRow    = 2
$ws.Application.ActiveWindow.FreezePanes = $true

# ── 열 너비 ──────────────────────────────────────────────
$ws.Columns("A:B").ColumnWidth = 10
$ws.Columns("C:C").ColumnWidth = 8
$ws.Columns("D:D").ColumnWidth = 16
# approach 열 (E, N, W)
foreach ($c in @(5,14,23)) { $ws.Columns($c).ColumnWidth = 12 }
# 숫자 열
$ws.Range($ws.Columns(6), $ws.Columns(31)).ColumnWidth = 9
# 계산 열 강조
foreach ($c in @(13,22,31)) { $ws.Columns($c).ColumnWidth = 11 }
# 가구 열
$ws.Range($ws.Columns(32), $ws.Columns(36)).ColumnWidth = 6
# 행 높이
$ws.Rows(1).RowHeight = 20
$ws.Rows(2).RowHeight = 44

$wb.Save()
if (-not $alreadyOpen) {
    $wb.Close($false)
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
} else {
    # 이미 열려 있던 경우: 시트 활성화만 하고 종료하지 않음
    $wb.Sheets[$sheetName].Activate()
}

Write-Host "완료: '$sheetName' 시트 생성"
Write-Host "열 구조: 공통 4열 + (approach+비용7열+월비용계산)×3페르소나 + 가구 5열 = 36열"
Write-Host "샘플: 겨울 난방 6개 행 (고유번호 1~6)"
