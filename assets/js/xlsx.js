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
const XML_NAMED = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
const xmlText = value => String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code) => {
  if(code[0] !== '#') return XML_NAMED[code.toLowerCase()] ?? whole;
  const number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return Number.isFinite(number) ? String.fromCodePoint(number) : whole;
});
const xmlAttr = (tag, name) => {
  const found = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag);
  return found ? found[1] : '';
};
const xmlTexts = fragment => [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
  .map(match => xmlText(match[1])).join('');
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
  return [...xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<si>([\s\S]*?)<\/si>|<si\s*\/>/g)]
    .map(match => match[1] ? xmlTexts(match[1]) : '');
}

function sheetRows(xml, strings){
  const rows = [];
  for(const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const cells = [];
    for(const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const tag = cell[1], inner = cell[2] || '', type = xmlAttr(tag, 't');
      let value = '';
      if(type === 'inlineStr'){
        value = xmlTexts(inner);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner);
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
  const sheet = /<sheet\b[^>]*>/.exec(workbookXml || '');
  const id = sheet ? xmlAttr(sheet[0], 'r:id') : '';
  if(id && relsXml){
    const rel = new RegExp(`<Relationship\\b[^>]*\\sId="${id}"[^>]*>`).exec(relsXml);
    let target = rel ? xmlAttr(rel[0], 'Target') : '';
    if(target){
      target = target.replace(/^\//, '').replace(/^\.\.\//, '');
      const path = target.startsWith('xl/') ? target : 'xl/' + target;
      if(entries.has(path)) return path;
    }
  }
  return [...entries.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0] || '';
}

/* 파일 하나 → 붙여넣기 칸에 그대로 넣을 수 있는 글자표.
   엑셀은 탭으로, CSV·텍스트는 원문 그대로 돌려준다(붙여넣기와 같은 경로로 흘려보내기 위함). */
async function readSheetFile(file){
  if(/\.(csv|tsv|txt)$/i.test(file.name)) return String(await file.text());
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(bytes);
  const [workbook, rels] = await Promise.all([
    zipRead(bytes, entries.get('xl/workbook.xml')),
    zipRead(bytes, entries.get('xl/_rels/workbook.xml.rels'))
  ]);
  const path = firstSheetPath(entries, workbook, rels);
  if(!path) throw new Error('엑셀에서 시트를 찾지 못했습니다.');
  const [sheet, shared] = await Promise.all([
    zipRead(bytes, entries.get(path)),
    zipRead(bytes, entries.get('xl/sharedStrings.xml'))
  ]);
  const rows = sheetRows(sheet, sharedStrings(shared));
  /* 값 안의 탭·줄바꿈은 공백으로 바꾼다 — 그대로 두면 열이 밀린다(붙여넣기도 같은 규칙이다) */
  return rows.map(cells => cells.map(value => String(value).replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .filter(line => line.trim())
    .join('\n');
}
