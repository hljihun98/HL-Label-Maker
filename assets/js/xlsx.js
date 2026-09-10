/* ---------- 엑셀(.xlsx) 파일 읽기 ----------
   .xlsx 는 ZIP 안에 XML 이 든 형식이다. 파서 라이브러리를 vendor 로 들이면 그것만 1MB 에 가까운데,
   이 도구는 파일 몇 개를 그대로 열어 쓰는 것이 전제라(README) 필요한 만큼만 직접 읽는다.
     ZIP 중앙 디렉터리 → 첫 번째 시트 XML → 셀 값(공유 문자열 포함) → 탭으로 이어 붙인 글자표
   압축 해제는 브라우저가 가진 DecompressionStream('deflate-raw') 을 쓴다 — 별도 라이브러리가 없다.

   읽지 않는 것: 숫자 서식과 날짜 serial. 관리대장에서 라벨로 가는 열은 모두 글자와 정수라
   <v> 를 그대로 쓰면 되고, 서식까지 풀면 styles.xml 해석이 통째로 따라붙는다.
   날짜 열을 라벨에 쓰게 되면 그때 서식을 읽어야 한다(지금 넣으면 쓰이지 않는 코드가 된다). */

const ZIP_EOCD = 0x06054b50;         // 끝 레코드(End Of Central Directory)
const ZIP_CEN  = 0x02014b50;         // 중앙 디렉터리 항목

const zipU16 = (bytes, at) => bytes[at] | (bytes[at+1] << 8);
const zipU32 = (bytes, at) => (bytes[at] | (bytes[at+1] << 8) | (bytes[at+2] << 16) | (bytes[at+3] << 24)) >>> 0;

/* 파일 목록 — 이름 → {압축방식, 압축크기, 로컬헤더 위치} */
function zipEntries(bytes){
  /* EOCD 는 파일 맨 뒤에 있지만 주석이 붙을 수 있어(최대 64KB) 뒤에서부터 찾는다 */
  const limit = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for(let at = bytes.length - 22; at >= limit; at--){
    if(zipU32(bytes, at) === ZIP_EOCD){ eocd = at; break; }
  }
  if(eocd < 0) throw new Error('엑셀 파일(.xlsx)이 아닙니다.');
  const decoder = new TextDecoder('utf-8');
  const count = zipU16(bytes, eocd + 10);
  const entries = new Map();
  let at = zipU32(bytes, eocd + 16);
  for(let i = 0; i < count; i++){
    if(zipU32(bytes, at) !== ZIP_CEN) break;
    const nameLen = zipU16(bytes, at + 28), extraLen = zipU16(bytes, at + 30), commentLen = zipU16(bytes, at + 32);
    entries.set(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen)), {
      method: zipU16(bytes, at + 10),
      compressed: zipU32(bytes, at + 20),
      localAt: zipU32(bytes, at + 42)
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function zipRead(bytes, entry){
  if(!entry) return '';
  /* 로컬 헤더의 이름·extra 길이는 중앙 디렉터리와 다를 수 있으므로 여기서 다시 읽는다 */
  const at = entry.localAt;
  const start = at + 30 + zipU16(bytes, at + 26) + zipU16(bytes, at + 28);
  const data = bytes.subarray(start, start + entry.compressed);
  if(entry.method === 0) return new TextDecoder('utf-8').decode(data);      // 압축 없이 저장된 항목
  if(entry.method !== 8) throw new Error('지원하지 않는 방식으로 압축된 엑셀입니다.');
  if(typeof DecompressionStream !== 'function')
    throw new Error('이 브라우저는 엑셀 파일을 직접 열지 못합니다 — 엑셀에서 복사해 아래 칸에 붙여넣어 주세요.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder('utf-8').decode(await new Response(stream).arrayBuffer());
}

/* ── XML ── 엑셀이 기계로 써 내는 XML 이라 필요한 태그만 훑는다 */
/* prototype 없는 표를 쓴다 — 셀에 "&constructor;" 같은 글자가 들어오면 일반 객체에서는
   Object.prototype 의 값이 튀어나와 라벨에 함수 소스가 찍힌다. */
const XML_NAMED = Object.assign(Object.create(null), { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" });
const xmlText = value => String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code) => {
  if(code[0] !== '#') return XML_NAMED[code.toLowerCase()] ?? whole;
  const number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  /* 범위를 넘는 코드(&#x110000;)는 String.fromCodePoint 가 던진다 — 원문을 그대로 둔다 */
  if(!Number.isFinite(number) || number < 0 || number > 0x10FFFF) return whole;
  return String.fromCodePoint(number);
});
const xmlAttr = (tag, name) => {
  const found = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag);
  return found ? found[1] : '';
};
/* 태그 이름 앞에 이름공간 접두어가 붙은 파일도 있다(<x:row>, <x:c>) — 엑셀은 안 붙이지만
   다른 시스템이 내보낸 파일에서는 흔하다. 접두어를 못 읽으면 시트가 통째로 빈 것으로 보인다.
   matchAll 은 정규식을 복제해 쓰므로 전역 정규식을 이렇게 공유해도 lastIndex 가 엉키지 않는다. */
const NS = '(?:[A-Za-z0-9]+:)?';
const RE_TEXT  = new RegExp(`<${NS}t\\b[^>]*>([\\s\\S]*?)</${NS}t>`, 'g');
const RE_ITEM  = new RegExp(`<${NS}si>([\\s\\S]*?)</${NS}si>|<${NS}si\\s*/>`, 'g');
const RE_PHON  = new RegExp(`<${NS}rPh[\\s\\S]*?</${NS}rPh>`, 'g');
const RE_ROW   = new RegExp(`<${NS}row\\b[^>]*>([\\s\\S]*?)</${NS}row>`, 'g');
const RE_CELL  = new RegExp(`<${NS}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, 'g');
const RE_VALUE = new RegExp(`<${NS}v>([\\s\\S]*?)</${NS}v>`);
const RE_SHEETS = new RegExp(`<${NS}sheet\\b[^>]*>`, 'g');
const RE_SHARED_CELL = new RegExp(`<${NS}c\\b[^>]*t="s"`);
const xmlTexts = fragment => [...fragment.matchAll(RE_TEXT)].map(match => xmlText(match[1])).join('');
/* "AB12" → 27 (0부터). 빈 칸은 <c> 자체가 없으므로 이 번호로 자리를 맞춘다 */
function colIndex(ref){
  let index = 0;
  for(const ch of String(ref).replace(/[^A-Za-z]/g, '').toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/* 공유 문자열 — 셀에 t="s" 로 들어오는 값의 실제 글자.
   후리가나(rPh)도 <t> 를 갖고 있어 먼저 걷어낸다. 서식이 섞인 글자는 <r><t> 여러 개로 쪼개져 있다. */
function sharedStrings(xml){
  if(!xml) return [];
  return [...xml.replace(RE_PHON, '').matchAll(RE_ITEM)]
    .map(match => match[1] ? xmlTexts(match[1]) : '');
}

function sheetRows(xml, strings){
  const rows = [];
  for(const row of xml.matchAll(RE_ROW)){
    const cells = [];
    for(const cell of row[1].matchAll(RE_CELL)){
      const tag = cell[1], inner = cell[2] || '', type = xmlAttr(tag, 't');
      let value = '';
      if(type === 'inlineStr'){
        value = xmlTexts(inner);
      } else {
        const raw = RE_VALUE.exec(inner);
        const text = raw ? xmlText(raw[1]) : '';
        value = type === 's' ? (strings[Number(text)] ?? '') : text;
      }
      const at = colIndex(xmlAttr(tag, 'r'));
      if(at >= 0) cells[at] = value; else cells.push(value);
    }
    rows.push(Array.from(cells, value => value ?? ''));      // 구멍(빈 칸)을 빈 글자로 메운다
  }
  return rows;
}

/* 첫 번째 시트 — 워크북에 적힌 순서가 곧 엑셀 탭 순서다. 파일 이름(sheet1.xml)은 순서와
   무관할 수 있으므로 관계 파일(rels)을 따라간다. */
function firstSheetPath(entries, workbookXml, relsXml){
  /* 엑셀 탭 순서대로 보되 숨긴 시트는 건너뛴다 — 첫 탭이 숨겨진 설정·집계 시트인 파일이 있고,
     그걸 읽으면 "첫 번째 시트"라고 안내하면서 엉뚱한 표를 가져온다. */
  const sheets = [...String(workbookXml || '').matchAll(RE_SHEETS)].map(match => match[0]);
  const sheet = sheets.find(tag => !/state="(?:very)?hidden"/i.test(tag)) || sheets[0] || '';
  const id = sheet ? xmlAttr(sheet, 'r:id') : '';
  if(id && relsXml){
    /* id 는 파일에서 온 값이라 정규식 기호가 섞여 있으면 패턴이 깨진다 */
    const safeId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rel = new RegExp(`<${NS}Relationship\\b[^>]*\\sId="${safeId}"[^>]*>`).exec(relsXml);
    let target = rel ? xmlAttr(rel[0], 'Target') : '';
    if(target){
      target = target.replace(/^\//, '').replace(/^\.\.\//, '');
      const path = target.startsWith('xl/') ? target : 'xl/' + target;
      if(entries.has(path)) return path;
    }
  }
  /* 폴백은 숫자로 정렬한다 — 글자순이면 sheet10 이 sheet2 보다 앞에 온다 */
  return [...entries.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0))[0] || '';
}

/* ZIP 안의 파일 이름은 대소문자를 가린다 — 도구마다 표기가 달라(SharedStrings.xml) 이름을
   고정해 찾으면 글자 셀이 전부 빈칸이 된다. 그래서 규칙으로 찾는다. */
const findEntry = (entries, pattern) => {
  const name = [...entries.keys()].find(key => pattern.test(key));
  return name ? entries.get(name) : undefined;
};
/* 붙여넣기 칸에 넣을 수 있는 양의 상한. 라벨은 400장이 상한이라 그보다 훨씬 크게 잡아도
   되지만, 수만 행을 한 문자열로 이어 붙이면 그 자체로 화면이 멈춘다. */
const SHEET_MAX_ROWS = 5000;
let readSheetNote = '';               // 잘라낸 경우처럼 사용자에게 알릴 말 (읽을 때마다 갱신)

/* 한국 윈도우 엑셀의 "CSV(쉼표로 분리)"는 UTF-8 이 아니라 CP949 로 저장한다 —
   UTF-8 로 읽으면 한글이 깨진 채로 라벨까지 흘러간다(품번은 ASCII 라 매칭은 되므로
   인쇄한 뒤에야 발견된다). 깨진 글자가 보이면 CP949 로 다시 읽는다. */
async function readTextFile(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if(!utf8.includes('�')) return utf8;
  try{
    const cp949 = new TextDecoder('euc-kr').decode(bytes);
    return cp949.includes('�') ? utf8 : cp949;
  }catch(error){ return utf8; }
}

/* 파일 하나 → 붙여넣기 칸에 그대로 넣을 수 있는 글자표.
   엑셀은 탭으로, CSV·텍스트는 원문 그대로 돌려준다(붙여넣기와 같은 경로로 흘려보내기 위함). */
async function readSheetFile(file){
  readSheetNote = '';
  if(/\.(csv|tsv|txt)$/i.test(file.name)) return readTextFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(bytes);
  const [workbook, rels] = await Promise.all([
    zipRead(bytes, findEntry(entries, /^xl\/workbook\.xml$/i)),
    zipRead(bytes, findEntry(entries, /^xl\/_rels\/workbook\.xml\.rels$/i))
  ]);
  const path = firstSheetPath(entries, workbook, rels);
  if(!path) throw new Error('엑셀에서 시트를 찾지 못했습니다.');
  const [sheet, shared] = await Promise.all([
    zipRead(bytes, entries.get(path)),
    zipRead(bytes, findEntry(entries, /^xl\/sharedstrings\.xml$/i))
  ]);
  const strings = sharedStrings(shared);
  /* 글자를 공유 문자열로 담아 둔 시트인데 그 표를 못 읽었으면, 품번·품명이 전부 빈칸인
     표가 조용히 만들어진다 — 그냥 넘기지 않고 다시 저장하도록 알린다. */
  if(!strings.length && RE_SHARED_CELL.test(sheet))
    throw new Error('엑셀의 공유 문자열 표를 읽지 못했습니다 — 엑셀에서 [다른 이름으로 저장]으로 .xlsx 로 다시 저장해 주세요.');
  const rows = sheetRows(sheet, strings);
  if(rows.length > SHEET_MAX_ROWS)
    readSheetNote = `${rows.length}행 중 앞 ${SHEET_MAX_ROWS}행만 읽었습니다`;
  /* 값 안의 탭·줄바꿈은 공백으로 바꾼다 — 그대로 두면 열이 밀린다(붙여넣기도 같은 규칙이다) */
  return rows.slice(0, SHEET_MAX_ROWS)
    .map(cells => cells.map(value => String(value).replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .filter(line => line.trim())
    .join('\n');
}
