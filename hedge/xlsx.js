/* ===========================================================================
   xlsx.js — 의존성 없는 최소 XLSX 작성기

   xlsx는 XML 몇 장을 담은 zip이다. 여기서는 압축 없이(stored) zip을 만들고
   SpreadsheetML을 직접 써서 수식이 살아 있는 워크북을 생성한다.
   외부 라이브러리 0, 오프라인 동작 원칙을 유지하기 위한 구현.

   사용법
     const wb = new Workbook();
     const sh = wb.sheet('거래조건', [22, 16]);   // 이름, 열 너비
     sh.set('B2', { v: '제목', s: S.title });
     sh.set('C5', { v: 100,   s: S.inputNum });
     sh.set('C14', { f: 'C6+C7+C8', s: S.num });
     wb.download('nickel_hedge.xlsx');
   =========================================================================== */

/* 스타일 인덱스 — styles.xml 의 cellXfs 순서와 1:1 대응 */
const S = {
  base: 0,        // 기본
  bold: 1,        // 굵게
  num: 2,         // #,##0
  num2: 3,        // #,##0.00
  inputNum: 4,    // 입력값 (파란 글씨 + 연한 파란 배경) #,##0
  inputText: 5,   // 입력값 (문자)
  title: 6,       // 제목
  section: 7,     // 섹션 머리
  signed: 8,      // #,##0;[Red]-#,##0
  percent: 9,     // 0.0%
  wrap: 10,       // 줄바꿈
  inputNum2: 11,  // 입력값 #,##0.00
  header: 12,     // 표 머리
  totalSigned: 13,// 합계 행 (부호 표시)
  totalNum: 14,   // 합계 행 (정수)
  muted: 15,      // 회색 보조 문구
  inputPct: 16,   // 입력값 (백분율)
  numTrim: 17,    // #,##0.## — 딱 떨어지면 소수점 없이
  /* 가운데 정렬판 — 조치 내용처럼 칸이 짧아 좌·우로 흩어지면 읽기 나쁜 표에 쓴다 */
  inputNumC: 18,  // 입력값 (숫자) · 가운데
  inputTextC: 19, // 입력값 (문자) · 가운데
  wrapC: 20       // 줄바꿈 · 가운데
};

const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5">
<numFmt numFmtId="164" formatCode="#,##0"/>
<numFmt numFmtId="165" formatCode="#,##0.00"/>
<numFmt numFmtId="166" formatCode="#,##0;[Red]\\-#,##0"/>
<numFmt numFmtId="167" formatCode="0.0%"/>
<numFmt numFmtId="168" formatCode="#,##0.##;[Red]\\-#,##0.##"/>
</numFmts>
<fonts count="5">
<font><sz val="11"/><color theme="1"/><name val="맑은 고딕"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="맑은 고딕"/></font>
<font><sz val="11"/><color rgb="FF0070C0"/><name val="맑은 고딕"/></font>
<font><b/><sz val="14"/><color theme="1"/><name val="맑은 고딕"/></font>
<font><sz val="10"/><color rgb="FF808080"/><name val="맑은 고딕"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="21">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="165" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="166" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="167" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ------------------------------ 주소 유틸 -------------------------------- */
function colName(n) {                       // 1 -> A, 27 -> AA
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}
function parseAddr(a) {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { col: c, row: Number(m[2]) };
}
const xmlEsc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/* -------------------------------- Sheet ---------------------------------- */
class Sheet {
  constructor(name, widths) {
    this.name = name;
    this.widths = widths || [];
    this.cells = new Map();       // "A1" -> { v, f, s }
    this.merges = [];
  }
  set(addr, cell) { this.cells.set(addr, cell); return this; }
  /* 한 행을 좌→우로 채운다. items: [{v|f, s}] */
  row(startAddr, items) {
    const { col, row } = parseAddr(startAddr);
    items.forEach((it, i) => { if (it != null) this.set(colName(col + i) + row, it); });
    return this;
  }
  merge(a, b) { this.merges.push(`${a}:${b}`); return this; }

  toXML() {
    const byRow = new Map();
    let maxCol = 1, maxRow = 1;
    this.cells.forEach((cell, addr) => {
      const { col, row } = parseAddr(addr);
      maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row);
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push({ col, addr, cell });
    });

    const rows = [...byRow.keys()].sort((a, b) => a - b).map(r => {
      const cs = byRow.get(r).sort((a, b) => a.col - b.col).map(({ addr, cell }) => {
        const s = cell.s ? ` s="${cell.s}"` : '';
        if (cell.f != null) return `<c r="${addr}"${s}><f>${xmlEsc(cell.f)}</f></c>`;
        if (cell.v == null || cell.v === '') return `<c r="${addr}"${s}/>`;
        if (typeof cell.v === 'number') {
          return Number.isFinite(cell.v)
            ? `<c r="${addr}"${s}><v>${cell.v}</v></c>`
            : `<c r="${addr}"${s}/>`;
        }
        return `<c r="${addr}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(cell.v)}</t></is></c>`;
      }).join('');
      return `<row r="${r}">${cs}</row>`;
    }).join('');

    const cols = this.widths.length
      ? `<cols>${this.widths.map((w, i) =>
          `<col min="${i + 2}" max="${i + 2}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const merges = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${this.merges.map(m =>
          `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${colName(maxCol)}${maxRow}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="16.5"/>
${cols}<sheetData>${rows}</sheetData>${merges}</worksheet>`;
  }
}

/* ------------------------------- Workbook -------------------------------- */
class Workbook {
  constructor() { this.sheets = []; }
  sheet(name, widths) {
    const s = new Sheet(name.slice(0, 31), widths);
    this.sheets.push(s);
    return s;
  }
  toBlob() {
    const files = [];
    const sheetTags = this.sheets.map((s, i) =>
      `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const relTags = this.sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
    const styleRelId = this.sheets.length + 1;

    files.push({
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${this.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    });
    files.push({
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    });
    files.push({
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetTags}</sheets>
<calcPr calcId="124519" fullCalcOnLoad="1"/>
</workbook>`
    });
    files.push({
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relTags}<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    });
    files.push({ name: 'xl/styles.xml', data: XLSX_STYLES });
    this.sheets.forEach((s, i) =>
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.toXML() }));

    return zipStore(files);
  }
  download(filename) {
    const url = URL.createObjectURL(this.toBlob());
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/* ------------------------------ zip (stored) ----------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  /* DOS 시각 — 재현 가능하도록 고정값 사용 */
  const dosTime = 0, dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;

  const u8 = n => [n & 0xFF];
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  files.forEach(f => {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),   // UTF-8 플래그
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0)
    ]);
    parts.push(local, nameBytes, data);

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset)
    ]), nameBytes);

    offset += local.length + nameBytes.length + data.length;
    void u8;
  });

  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0)
  ]);

  return new Blob([...parts, ...central, eocd],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
