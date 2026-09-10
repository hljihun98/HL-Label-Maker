const LOGO_USE = '<img src="assets/images/hl-robotics-logo.svg" alt="">';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'
}[char]));
const localIsoDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const yymmdd = date => String(date || '').replace(/-/g, '').slice(2);

/* ── 인쇄 정합 기본값 ────────────────────────────────────────────────
   프린터를 바꾸지 않는다면 한 번 맞춘 뒤 이 숫자만 고쳐 저장해두면 됩니다.
   lw/lh = 라벨 실측 크기(mm) · pt/pb/pl/pr = 내부 여백(mm)
   dx/dy = 인쇄 미세이동(mm, 아래가 잘리면 dy를 음수로) · sc = 배율(%)
   fs = 글자 크기 배율 · bw = 괘선 두께(mm)
   freeze — [전체 초기화]가 언제나 이 값으로 돌아가야 하므로 프리셋이 덮어쓰지 못하게 한다. */
const CAL = Object.freeze({ lw:100, lh:60, pt:4, pb:4, pl:4, pr:4, dx:0, dy:0, sc:100, fs:1, bw:0.35 });

/* 프린터 프리셋 — 푸터(바코드 줄)의 끝 위치는 '아래 여백'이 정한다. 위 여백은 무관.
   레이저 프린터는 용지 끝 4~5mm를 물리적으로 인쇄하지 못하므로 사방 4mm를 안전영역으로 비운다.
   프리셋은 입력칸만 바꾸고 기본값(CAL)은 건드리지 않는다. */
const CAL_PRESETS = {
  label: { pt:3, pb:3, pl:3, pr:3, dx:0, dy:0, sc:100 },   // 라벨 프린터 (가장자리까지 인쇄 가능)
  laser: { pt:4, pb:4, pl:4, pr:4, dx:0, dy:0, sc:100 }    // 레이저/복합기 (사방 4mm 안전영역)
};
function applyPreset(name){
  const preset = CAL_PRESETS[name];
  if(!preset) return;
  Object.entries(preset).forEach(([k, v])=>{ if($(k)) $(k).value = v; });
  renderAll();
}
const CAL_IDS = Object.keys(CAL);
const fieldNumber = (id, fallback = 0) => {
  const element = $(id);
  if(!element) return fallback;
  const parsed = Number.parseFloat(element.value);
  let value = Number.isFinite(parsed) ? parsed : fallback;
  const min = Number.parseFloat(element.min);
  const max = Number.parseFloat(element.max);
  if(Number.isFinite(min)) value = Math.max(min, value);
  if(Number.isFinite(max)) value = Math.min(max, value);
  return value;
};
const num = id => fieldNumber(id, Number(CAL[id]) || 0);

function applyCalDefaults(){ CAL_IDS.forEach(k=>{ if($(k)) $(k).value = CAL[k]; }); }
function resetCal(){ applyCalDefaults(); renderAll(); }
function toggleAdv(){
  $('advBox').classList.toggle('on', $('adv').checked);
  if(!$('adv').checked) return;
  if($('advBox').scrollIntoView) $('advBox').scrollIntoView({behavior:'smooth', block:'nearest'});
}
let items = [], scale = 1;

$('dt').value = localIsoDate();

/* 자재 라벨은 두 종류가 같은 폼을 쓴다 — 이미지 종류는 개략도 칸이 하나 더 붙을 뿐,
   품목 정보와 CSV 열 규격이 같다. 폼을 복제하면 칸을 고칠 때 한쪽만 고쳐진다. */
const isMatMode = m => m === 'mat' || m === 'matimg';
function switchMode(){
  const m = $('mode').value;
  $('matForm').style.display  = isMatMode(m) ? '' : 'none';
  $('boltForm').style.display = m==='bolt' ? '' : 'none';
  $('locForm').style.display  = m==='loc'  ? '' : 'none';
  $('linkForm').style.display = m==='link' ? '' : 'none';
  /* 개략도 입력은 이미지 종류에서만 — 기존 자재 라벨에 이미지가 섞여 들어가지 않는다.
     종류를 벗어나면 첨부해 둔 개략도를 비운다. 남겨두면 다시 돌아왔을 때 이전 부품의 그림이
     그대로 붙은 채 발행된다(칸이 숨겨져 있어 눈치채기 어렵다). */
  $('matImgWrap').style.display   = m==='matimg' ? '' : 'none';
  $('imgFolderWrap').style.display = m==='matimg' ? '' : 'none';
  if(m !== 'matimg' && typeof clearMatImage === 'function') clearMatImage();
  /* 링크 라벨은 CSV 열 규격이 없다 — 폼 안의 [일괄 생성]을 쓴다.
     칸을 남겨두면 자재 라벨 표를 붙여넣어 엉뚱한 라벨이 박스 ID 까지 물고 발행된다. */
  $('csvWrap').style.display = m==='link' ? 'none' : '';
  $('csv').placeholder = m==='bolt'
    ? '적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도  ← 엑셀에서 그대로 복사'
    : '품번,Rev,품명,규격,기종,수량,단위,로케이션,협력사,박스수';
  $('mergeWrap').style.display = m==='bolt' ? '' : 'none';
  $('csvHint').innerHTML = m==='bolt'
    ? '순서: <code>적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도</code><br>'
      + '머리: <code>SOCKET</code>(육각소켓) · <code>HEX</code>(헥사) · <code>FLAT</code>(접시머리) · <code>PHILLIPS</code>(십자). 엑셀 탭 구분을 자동 인식합니다.<br>'
      + '<b>워셔</b>도 같은 표에 섞어 넣으면 됩니다 — 머리 칸에 <code>WASHER</code> 또는 규격(<code>M10 T2.5</code>)을 적으면 자동으로 갈라냅니다. '
      + '<code>SPRING</code>이 있으면 스프링와셔, 두께를 빼면 표준값을 채우고 <b>≈</b>를 붙입니다.<br>'
      + '<b>강도</b> 열은 없어도 됩니다 — 비우면 위 [강도 구분]에서 고른 값이 전 행에 적용됩니다.'
    : '순서: <code>품번,Rev,품명,규격,기종,수량,단위,로케이션,협력사,박스수</code><br>'
      + '<b>규격</b> 열은 자리만 지켜주면 됩니다(라벨에 인쇄하지 않음).<br>'
      + 'LOT-IMS <b>재고현황 CSV</b>와 <b>부품 관리대장</b>(품번 … 제품개략도 파일명)은 '
      + '헤더째 그대로 붙여넣으면 자동으로 매핑됩니다.'
      + (m==='matimg' ? '<br>관리대장을 쓰면 <b>제품개략도 파일명</b> 열로도 이미지가 매칭되므로 '
        + '스크린샷 파일 이름을 바꾸지 않아도 됩니다.' : '');
  qrDiag();
}

/* 규격 → 사내 코드 자동 생성 · 1대당 개수 자동 계산 */
const HEAD_ABBR = { SOCKET:'SOC', HEX:'HEX', PHILLIPS:'PHS', FLAT:'FLT', FLANGE:'FLG', BUTTON:'BTN', TORX:'TRX', SET:'SET' };
const HEAD_LABEL = {
  SOCKET:'육각소켓', HEX:'헥사 볼트', PHILLIPS:'십자', FLAT:'접시머리',
  FLANGE:'플랜지', BUTTON:'버튼', TORX:'별', SET:'무두'
};
/* FLAT(접시머리)은 반드시 SOCKET 보다 앞에 온다 —
   BOM 표기 "SOCKET HEAD FLAT"은 육각소켓 홈을 가진 접시머리이지 캡스크류가 아니다.
   순서를 뒤집으면 머리 모양이 원통으로 그려져 1:1 대조가 통째로 어긋난다. */
const HEAD_ALIASES = [
  ['FLAT', /FLAT|COUNTERSUNK|COUNTER\s*SUNK|CSK|접시/],
  ['SOCKET', /SOCKET|SOC|육각\s*소켓|소켓/],
  ['PHILLIPS', /PHILLIPS|CROSS|PHS|십자/],
  ['FLANGE', /FLANGE|FLG|플랜지/],
  ['BUTTON', /BUTTON|BTN|버튼/],
  ['TORX', /TORX|TRX|별/],
  ['HEX', /HEX|육각/],
  ['SET', /SET|무두/]
];
function normalizeBoltHead(value){
  const text = String(value || '').trim().toUpperCase();
  const match = HEAD_ALIASES.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : '';
}

/* ── 홈(drive) — 머리 모양과 별개로 공구가 물리는 자리 ──────────────
   접시머리는 육각소켓 홈과 십자 홈이 둘 다 흔해서 머리 종류만으로는 위에서 본 모양을
   그릴 수 없다. "SOCKET HEAD FLAT"은 육각, "FLAT PHILLIPS"는 십자다.
   다른 머리는 홈이 사실상 하나로 정해져 있으므로 머리 종류에서 그대로 끌어온다. */
const DRIVE_LABEL = { SOCKET:'육각', PHILLIPS:'십자', TORX:'별', SLOT:'일자' };
const DRIVE_ALIASES = [
  ['PHILLIPS', /PHILLIPS|CROSS|PHS|십자/],
  ['TORX', /TORX|TRX|별/],
  ['SOCKET', /SOCKET|SOC|HEX|육각|소켓/]
];
const DRIVE_OF_HEAD = { SOCKET:'SOCKET', TORX:'TORX', PHILLIPS:'PHILLIPS', BUTTON:'SOCKET',
  HEX:'', FLANGE:'', SET:'SOCKET', FLAT:'SOCKET' };
/* 홈이 하나로 정해진 머리는 원문을 읽지 않는다 — HEX 는 외부 육각이라 홈이 없는데
   "HEX" 글자가 육각 홈으로 잡히면 헥사 볼트 머리에 소켓 구멍이 그려진다.
   사내 표준은 접시머리도 육각소켓 홈이므로 표기가 없으면 육각으로 본다. */
function normalizeDrive(value, head){
  if(head !== 'FLAT') return DRIVE_OF_HEAD[head] || '';
  const text = String(value || '').trim().toUpperCase();
  const match = DRIVE_ALIASES.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : 'SOCKET';
}
function normalizeThreadDia(value){
  const text = String(value || '').trim().toUpperCase().replace(',', '.');
  const match = text.match(/^M?\s*(\d+(?:\.\d+)?)$/);
  if(!match || Number(match[1]) <= 0) return '';
  return `M${Number(match[1])}`;
}
/* 강도 표기 정리 — 현장에서 "12.9T"로 쓰므로 뒤에 붙는 T 를 떼고 라벨 표기와 맞춘다 */
const normalizeGrade = value => String(value || '').trim().toUpperCase().replace(/\s*T$/, '');

/* 표준 머리 치수 [머리지름 dk, 머리높이 k] (mm)
   SOCKET·TORX: ISO 4762/14579 · BUTTON: ISO 7380 · HEX: ISO 4014 계열(대각 dk)
   PHILLIPS: 일반 팬헤드 · FLANGE: 상용치수 · SET: 무두(dk=나사 지름, k=0)
   1:1 도면 기준값이며 제조사 편차가 있으므로 입력란에서 수정할 수 있다. */
const HEAD_DIM = {
  SOCKET:{'M2.5':[4.5,2.5],M3:[5.5,3],M4:[7,4],M5:[8.5,5],M6:[10,6],M8:[13,8],M10:[16,10],M12:[18,12],M14:[21,14],M16:[24,16],M18:[27,18],M20:[30,20]},
  TORX:  {M3:[5.5,3],M4:[7,4],M5:[8.5,5],M6:[10,6],M8:[13,8],M10:[16,10],M12:[18,12],M14:[21,14],M16:[24,16]},
  PHILLIPS:{'M2.5':[5,2],M3:[5.5,2.4],M4:[7,3.1],M5:[9,3.7],M6:[10.5,4.6],M8:[14,6]},
  /* ISO 10642 접시머리 — dk 는 이론 예각 지름(실측 머리 외경), k 는 머리 높이 최대값 */
  FLAT:  {'M2.5':[5,1.5],M3:[6,1.86],M4:[8,2.48],M5:[10,3.1],M6:[12,3.72],M8:[16,4.96],M10:[20,6.2],M12:[24,7.44],M14:[27,8.4],M16:[30,8.8],M20:[36,10.16]},
  HEX:   {M4:[8.1,2.8],M5:[9.2,3.5],M6:[11.1,4],M8:[14.4,5.3],M10:[18.9,6.4],M12:[21.1,7.5],M14:[24.5,8.8],M16:[26.8,10],M18:[29.6,11.5],M20:[33,12.5]},
  FLANGE:{M6:[14,6.8],M8:[17,8],M10:[21,9.8],M12:[25,11.6]},
  BUTTON:{M3:[5.7,1.65],M4:[7.6,2.2],M5:[9.5,2.75],M6:[10.5,3.3],M8:[14,4.4],M10:[17.5,5.5],M12:[21,6.6],M16:[24,8.8]},
  SET:   {M3:[3,0],M4:[4,0],M5:[5,0],M6:[6,0],M8:[8,0],M10:[10,0],M12:[12,0],M14:[14,0],M16:[16,0]}
};
/* 표에 없는 조합(예: PHILLIPS M10)은 나사 지름 배수로 추정한다 — [dk 배수, k 배수].
   추정값을 쓴 라벨은 화면과 라벨 모두에 ≈ 를 붙여 실측이 필요함을 알린다. */
const HEAD_APPROX = {
  SOCKET:[1.5,1.0], TORX:[1.5,1.0], HEX:[1.85,0.65], FLAT:[2.0,0.62],
  PHILLIPS:[1.8,0.75], FLANGE:[2.2,1.0], BUTTON:[1.85,0.55], SET:[1.0,0]
};
/* 접시머리는 머리가 자재 면 아래로 잠기므로 호칭 길이 L 에 머리 높이 k 가 포함된다.
   (다른 머리는 머리 밑면부터 끝단까지가 L) — 1:1 도면의 나사부 길이 계산이 갈린다. */
const HEAD_IN_LENGTH = { FLAT:true };
const threadD = dia => Number(String(dia||'').replace(/[^\d.]/g,'')) || 0;
function headDims(head, dia){
  const key = String(dia||'').toUpperCase();
  const table = (HEAD_DIM[head] || HEAD_DIM.SOCKET)[key];
  if(table) return { dk:table[0], k:table[1], approx:false };
  const d = threadD(dia);
  const [fdk, fk] = HEAD_APPROX[head] || HEAD_APPROX.SOCKET;
  return { dk:n2(d*fdk), k:n2(d*fk), approx:true };
}

/* ── 워셔 ────────────────────────────────────────────────────────────
   볼트 표(11열)에 워셔가 섞여 들어온다. 워셔는 머리 형상도 나사 길이도 없어서
   BOM 작성자가 규격을 '머리' 칸에 통째로 적는다 — "WASHER | M10 T2.5 | (빈) | (빈)".
   열을 못 바꾸므로 행 단위로 종류를 먼저 가른 뒤 파싱한다. */
const WASHER_LABEL = { PLAIN:'평와셔', SPRING:'스프링와셔' };
const WASHER_SHORT = { PLAIN:'평와셔', SPRING:'스프링' };
const WASHER_ABBR  = { PLAIN:'PLN', SPRING:'SPR' };
/* [내경 d1, 외경 d2, 두께 t] — PLAIN: ISO 7089(200HV) · SPRING: DIN 127B */
const WASHER_DIM = {
  PLAIN: {'M2.5':[2.7,6,0.5],M3:[3.2,7,0.5],M4:[4.3,9,0.8],M5:[5.3,10,1],M6:[6.4,12,1.6],M8:[8.4,16,1.6],
          M10:[10.5,20,2],M12:[13,24,2.5],M14:[15,28,2.5],M16:[17,30,3],M18:[19,34,3],M20:[21,37,3]},
  SPRING:{M3:[3.1,6.2,0.8],M4:[4.1,7.6,0.9],M5:[5.1,9.2,1.2],M6:[6.1,11.8,1.6],M8:[8.1,14.8,2],
          M10:[10.2,18.1,2.2],M12:[12.2,21.1,2.5],M14:[14.2,24.1,3],M16:[16.2,26.2,3.5],M20:[20.2,33.2,4]}
};
/* 표에 없는 호칭은 나사 지름 배수로 추정한다 — [d1 배수, d2 배수, t 배수] */
const WASHER_APPROX = { PLAIN:[1.05,2.0,0.2], SPRING:[1.02,1.75,0.22] };
function washerDims(kind, dia){
  const table = (WASHER_DIM[kind] || WASHER_DIM.PLAIN)[String(dia||'').toUpperCase()];
  if(table) return { d1:table[0], d2:table[1], t:table[2], approx:false };
  const d = threadD(dia);
  const [f1, f2, ft] = WASHER_APPROX[kind] || WASHER_APPROX.PLAIN;
  return { d1:n2(d*f1), d2:n2(d*f2), t:n2(d*ft), approx:true };
}
/* 내경(실측)에서 호칭경을 되찾는다 — "10.5x20x2" 처럼 M 표기 없이 적힌 규격용 */
function washerNominal(kind, bore){
  const table = WASHER_DIM[kind] || WASHER_DIM.PLAIN;
  let best = '', gap = 1.6;                               // 1.6mm 넘게 벌어지면 같은 호칭으로 보지 않는다
  Object.entries(table).forEach(([key, [d1]])=>{
    const diff = Math.abs(d1 - bore);
    if(diff < gap){ gap = diff; best = key; }
  });
  return best || (bore > 0 ? `M${Math.round(bore)}` : '');
}

const WASHER_RE = /WASHER|WASHR|WSHR|와셔|워셔|W\/S/i;
const SPRING_RE = /SPRING|스프링|(^|[^A-Z])SW([^A-Z]|$)/i;
const isWasherText = value => WASHER_RE.test(String(value || ''));
const normalizeWasherKind = value => SPRING_RE.test(String(value || '')) ? 'SPRING' : 'PLAIN';

/* 규격 문자열 → { dia, d1, d2, t } · 두께가 없으면 t 를 비워 표준값으로 채우게 한다.
   지원 표기: "M10 T2.5" · "M10T2.5" · "M10*2.5" · "M10 2.5T" · "M10" · "10.5x20x2" */
function parseWasherSpec(text){
  const t = String(text || '').toUpperCase().replace(/,/g, '.').replace(/[×＊✕]/g, 'X');
  const three = t.match(/(\d+(?:\.\d+)?)\s*[X*]\s*(\d+(?:\.\d+)?)\s*[X*]\s*(\d+(?:\.\d+)?)/);
  if(three) return { dia:'', d1:Number(three[1]), d2:Number(three[2]), t:Number(three[3]) };
  const nominal = t.match(/M\s*(\d+(?:\.\d+)?)/);
  /* T 표기를 먼저 본다 — "M10 T2.5" 를 뒤 패턴으로 읽으면 "10 T" 가 걸려 두께가 10 이 된다 */
  const thick = t.match(/T\s*(\d+(?:\.\d+)?)/)
    || t.match(/(\d+(?:\.\d+)?)\s*T(?![A-Z0-9])/)
    || t.match(/[X*-]\s*(\d+(?:\.\d+)?)/);
  const dia = nominal && Number(nominal[1]) > 0 ? `M${Number(nominal[1])}` : '';
  if(!dia) return null;
  return { dia, d1:0, d2:0, t: thick ? Number(thick[1]) : 0 };
}

/* ── 볼트 표 한 행 → 부품 한 종 ──────────────────────────────────────
   열: 적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도
   워셔를 머리 형상보다 먼저 가른다 — 순서를 뒤집으면 "FLAT WASHER"(평와셔)가
   FLAT 별칭에 걸려 접시머리 볼트로 둔갑한다. null 을 돌려주면 형식 불량 행이다. */
function parseFastenerRow(cells, defaults){
  const c = i => String(cells[i] ?? '').trim();
  const headCell = c(3), diaCell = c(4), lenCell = c(5), posCell = c(2), catCell = c(1);
  const perAssy = Math.max(0, parseInt(c(6)) || 0), assyN = Math.max(0, parseInt(c(7)) || 0);
  const base = { prod:c(0), cat:catCell, pos:posCell, mat:c(9) || defaults.mat,
    perBot: Math.max(0, parseInt(c(8)) || perAssy*assyN || 0) };
  const head = normalizeBoltHead(headCell);

  /* 워셔 판정 — ① 머리 칸의 워셔 표기, 또는 머리 형상이 안 잡히는 행의 위치 칸 표기
                  ("SOCKET" 볼트가 "WASHER PLATE" 위치에 쓰이는 경우를 볼트로 남긴다)
                ② 표기가 없어도 직경·길이가 둘 다 비고 머리 칸에 호칭경만 적힌 행 */
  const tagged = isWasherText(headCell) || (isWasherText(posCell) && !head);
  const bare = !head && !diaCell && !lenCell && /M\s*\d/i.test(headCell);
  if(tagged || bare){
    const kind = normalizeWasherKind(`${headCell} ${posCell} ${catCell}`);
    const spec = parseWasherSpec([headCell, diaCell, lenCell].filter(Boolean).join(' '));
    if(!spec) return null;
    const dia = spec.dia || washerNominal(kind, spec.d1);
    const std = washerDims(kind, dia);
    /* 두께 생략은 흔하다 — 호칭경마다 표준 두께가 하나뿐이라 BOM 에 "M10"만 적는다.
       표준값으로 채우되 추정 표시를 남겨 실측이 필요함을 라벨에 알린다. */
    const t = spec.t || std.t;
    const d1 = spec.d1 || std.d1, d2 = spec.d2 || std.d2;
    if(!(t > 0) || !(d2 > 0) || !dia) return null;
    /* 위치 칸에 부품 이름("WASHER")이 들어와 있어 그대로 두면 라벨의 적용 위치가 무의미해진다.
       워셔 표기를 걷어내고, 남는 게 없으면 대분류를 위치로 올린다. */
    const pos = posCell.replace(/(SPRING|PLAIN|FLAT)?\s*(WASHER|WASHR|WSHR|W\/S)/ig, '')
      .replace(/(스프링|평)?\s*(와셔|워셔)/g, '')
      .replace(/[-·,()]+/g, ' ').replace(/\s+/g, ' ').trim() || catCell;
    return { ...base, pos, form:'washer', kind, dia,
      d1:n2(d1), d2:n2(d2), t:n2(t), approx: std.approx || !spec.t };
  }

  /* 머리 칸이 비면 사내 표준인 육각소켓으로 본다. 워셔 판정이 끝난 뒤에 채워야 하는데,
     먼저 채우면 머리 칸이 빈 워셔 행이 볼트로 잡힌다. */
  const boltHead = head || (headCell ? '' : 'SOCKET');
  const dia = normalizeThreadDia(diaCell);
  const lengthText = lenCell.replace(',', '.').replace(/^L\s*/i, '');
  const lengthMatch = lengthText.match(/^(-?\d+(?:\.\d+)?)\s*(?:MM)?$/i);
  const len = lengthMatch ? Number(lengthMatch[1]) : NaN;
  if(!boltHead || !dia || !Number.isFinite(len) || len <= 0) return null;
  return { ...base, form:'bolt', head:boltHead, drive:normalizeDrive(headCell, boltHead),
    dia, len:String(len), grade: normalizeGrade(cells[10]) || defaults.grade };
}

/* ISO 261 보통나사 피치(mm) — 나사산 묘사에 사용 */
const PITCH = { 'M2.5':0.45, M3:0.5, M4:0.7, M5:0.8, M6:1.0, M8:1.25, M10:1.5, M12:1.75, M14:2, M16:2, M18:2.5, M20:2.5 };
const pitchOf = dia => PITCH[String(dia||'').toUpperCase()] || Math.max(0.5, threadD(dia)*0.15);

/* 정다각형 경로 — acrossFlats = 대변 거리(mm) */
function hexPath(cx, cy, acrossFlats, rot){
  const R = acrossFlats / Math.sqrt(3);
  let p = '';
  for(let i=0;i<6;i++){
    const a = (Math.PI/180) * (60*i + (rot||0));
    p += (i ? 'L' : 'M') + (cx + R*Math.cos(a)).toFixed(2) + ' ' + (cy + R*Math.sin(a)).toFixed(2);
  }
  return p + 'Z';
}
const n2 = v => (Math.round(v*100)/100);

/* ── 머리 위에서 본 모양 ─────────────────────────────────────────────
   머리 실측치와 무관하게 같은 100×100 좌표를 사용한다. 작업자는 크기가 아니라
   외부 육각(헥사)·십자·내부 육각(소켓)의 형상 차이로 종류를 판별한다. */
/* 홈(공구 자리) — 반지름 r 안에 그린다. 머리 모양과 분리해 두어야
   같은 접시머리라도 육각/십자를 구분해 그릴 수 있다. */
function driveSvg(drive, r){
  if(drive === 'PHILLIPS')
    return `<path d="M50 ${n2(50-r)}V${n2(50+r)}M${n2(50-r)} 50H${n2(50+r)}" fill="none" stroke="#000" stroke-width="${n2(r*0.44)}" stroke-linecap="round"/>`;
  if(drive === 'TORX'){
    let path = '';
    for(let i=0;i<12;i++){
      const radius = i%2 ? r*0.58 : r, angle = (Math.PI/180)*(30*i - 15);
      path += (i?'L':'M') + n2(50 + radius*Math.cos(angle)) + ' ' + n2(50 + radius*Math.sin(angle));
    }
    return `<path d="${path}Z" fill="#000"/>`;
  }
  return `<path d="${hexPath(50,50,n2(r*1.732),0)}" fill="#000"/>`;   // 육각 소켓
}
function headTopSvg(head, drive){
  const dr = drive || DRIVE_OF_HEAD[head] || 'SOCKET';
  const ring = '<circle cx="50" cy="50" r="43" fill="#fff" stroke="#000" stroke-width="5"/>'
    + '<circle cx="50" cy="50" r="36" fill="none" stroke="#000" stroke-width="2"/>';
  let g;
  if(head === 'HEX'){
    g = `<path d="${hexPath(50,50,72,0)}" fill="#fff" stroke="#000" stroke-width="6"/>`
      + '<circle cx="50" cy="50" r="28" fill="none" stroke="#000" stroke-width="2"/>';
  } else if(head === 'FLAT'){
    /* 접시머리 — 바깥 원과 안쪽 원 사이의 넓은 테이퍼 면이 캡스크류와 갈리는 지점이다.
       홈은 표기에 따라 육각/십자가 달라지므로 driveSvg 에 맡긴다. */
    g = '<circle cx="50" cy="50" r="46" fill="#fff" stroke="#000" stroke-width="4"/>'
      + '<circle cx="50" cy="50" r="33" fill="none" stroke="#000" stroke-width="1.8"/>'
      + driveSvg(dr, 24);
  } else if(head === 'PHILLIPS'){
    g = ring + driveSvg('PHILLIPS', 25);
  } else if(head === 'FLANGE'){
    g = '<circle cx="50" cy="50" r="46" fill="#fff" stroke="#000" stroke-width="3"/>'
      + `<path d="${hexPath(50,50,60,0)}" fill="#fff" stroke="#000" stroke-width="6"/>`;
  } else if(head === 'TORX'){
    g = ring + driveSvg('TORX', 31);
  } else {                                                  // SOCKET · BUTTON · SET
    g = ring + driveSvg('SOCKET', 28.87);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}

/* 워셔 — 위에서 본 종류 판별 심볼 (크기 무관, 형상만 본다) */
function washerTopSvg(kind){
  const ro = 45, ri = 21;
  if(kind === 'SPRING'){
    /* 스프링와셔는 링이 한 곳 끊겨 있다 — 이 절개부가 평와셔와 갈리는 유일한 지점이다 */
    const pt = (r, deg) => {
      const a = deg*Math.PI/180;
      return `${n2(50 + r*Math.cos(a))} ${n2(50 + r*Math.sin(a))}`;
    };
    const d = `M${pt(ro,16)}A${ro} ${ro} 0 1 1 ${pt(ro,-16)}L${pt(ri,-16)}A${ri} ${ri} 0 1 0 ${pt(ri,16)}Z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">`
      + `<path d="${d}" fill="#fff" stroke="#000" stroke-width="5" stroke-linejoin="round"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">`
    + `<circle cx="50" cy="50" r="${ro}" fill="#fff" stroke="#000" stroke-width="5"/>`
    + `<circle cx="50" cy="50" r="${ri}" fill="#fff" stroke="#000" stroke-width="4"/></svg>`;
}

/* ── 워셔 1:1 도면 (반단면 평면도 + 두께 단면) ──
   볼트는 길이 혼입이 사고 원인이라 측면을 1:1 로 그리지만, 워셔는 볼트가 들어가는
   내경과 체결력을 정하는 두께가 사고 원인이다. 그래서 두 가지를 나란히 1:1 로 둔다.
     왼쪽 — 평면도의 위쪽 절반. 중심선이 아래 경계다. 원은 중심선 위에서 가장 넓으므로
            칸보다 큰 워셔라 위가 잘려도 외경·내경의 좌우 끝은 언제나 남는다.
     오른쪽 — 두께 단면. 세로만 1:1 이고 가로 폭은 도면 관례상 임의다.
   실물을 중심선에 맞춰 올리면 구멍과 외곽이 그대로 겹친다. */
function washerSideSvg(kind, d1, d2, t, availW, availH){
  const H = Math.max(d2, 1), cy = H/2, cx = d2/2;
  const sw = Math.max(0.18, H*0.022), thin = sw*0.6;
  const p = Math.max(0.5, d2*0.07);                       // 중심선 파선 간격
  const gap = 2.0;
  /* 두께 단면은 폭이 남을 때만 붙인다 — 평면도(외경)가 1:1 대조의 본체라 먼저 자리를 준다 */
  const twWant = Math.max(2.2, Math.min(t*2.4, 6));
  const twRoom = availW - d2 - gap - 0.6;
  const tw = twRoom >= 1.6 ? Math.min(twWant, twRoom) : 0;
  const w = n2(d2 + (tw ? gap + tw : 0) + 0.6);
  let g = '';

  /* 중심선 (일점쇄선) — 반단면의 하단 경계선이자 실물을 맞추는 기준선 */
  g += `<line x1="0" y1="${n2(cy)}" x2="${n2(w)}" y2="${n2(cy)}" stroke="#000" stroke-width="${n2(thin*1.3)}" stroke-dasharray="${n2(p*1.6)} ${n2(p*0.5)} ${n2(p*0.2)} ${n2(p*0.5)}"/>`;

  /* 평면도 반원 — 왼쪽 끝에서 오른쪽 끝까지 위쪽을 지나간다 */
  const arc = r => `M${n2(cx-r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 0 1 ${n2(cx+r)} ${n2(cy)}`;
  g += `<path d="${arc(d2/2)}" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
  g += `<path d="${arc(d1/2)}" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
  if(kind === 'SPRING')                                   // 절개부 — 12시 방향에 반경선으로 표시
    g += `<line x1="${n2(cx)}" y1="${n2(cy-d2/2)}" x2="${n2(cx)}" y2="${n2(cy-d1/2)}" stroke="#000" stroke-width="${n2(sw)}"/>`;

  /* 외경·내경 끝의 세로 안내선 — 실물 가장자리를 맞출 자리 */
  [cx-d2/2, cx-d1/2, cx+d1/2, cx+d2/2].forEach(x =>
    g += `<line x1="${n2(x)}" y1="0" x2="${n2(x)}" y2="${n2(H)}" stroke="#000" stroke-width="${n2(thin*0.9)}" stroke-dasharray="${n2(p*0.5)} ${n2(p*0.45)}"/>`);

  /* 두께 단면 — 세로 t 가 정확히 1:1. 스프링와셔는 한쪽이 들려 있어 기울여 그린다. */
  if(tw){
    const xs = d2 + gap, xe = xs + tw;
    const d = kind === 'SPRING'
      ? `M${n2(xs)} ${n2(cy)}L${n2(xe)} ${n2(cy - t*0.5)}L${n2(xe)} ${n2(cy - t*1.5)}L${n2(xs)} ${n2(cy - t)}Z`
      : `M${n2(xs)} ${n2(cy)}L${n2(xe)} ${n2(cy)}L${n2(xe)} ${n2(cy - t)}L${n2(xs)} ${n2(cy - t)}Z`;
    g += `<path d="${d}" fill="#000" stroke="#000" stroke-width="${n2(thin)}" stroke-linejoin="round"/>`;
  }

  const bottom = cy + n2(thin*1.3);
  const wanted = cy + 0.5;
  const visH = n2(Math.min(wanted, availH > 0 ? availH : wanted));
  return { svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.3 ${n2(bottom - visH)} ${w} ${visH}" preserveAspectRatio="none">${g}</svg>`,
           w, h:visH, fit: wanted <= availH && d2 + gap <= availW };
}

/* ── 옆에서 본 실물 형상 (반단면 · 축척 1:1 고정) ──
   도면은 절대 축소하지 않는다. 축소된 도면은 실물 대조에 쓸 수 없고 "축소 84%" 같은
   표기는 현장에서 혼란만 준다. 대신 두 가지로 칸에 맞춘다.
     세로 — 도면이 중심선 대칭이므로 중심선 위쪽 절반만 노출한다(반단면). 그래도 칸보다
            크면 머리 외곽 상단을 잘라낸다. 나사부는 중심선 근처라 언제나 보인다.
     가로 — 칸을 넘는 길이는 끝단에 지그재그 축약 기호를 그린다(도면 관례).
   따라서 라벨에 보이는 모든 부분은 실물과 1:1이며, 실물 볼트의 중심을 하단 중심선에
   맞춰 올리면 길이와 머리 두께를 그대로 대조할 수 있다. */
function boltSideSvg(head, dk, k, d, L, dia, availW, availH){
  const p = pitchOf(dia), th = p*0.54;                    // 나사산 피치 / 편측 깊이
  const H = Math.max(dk, d);                              // 도면 세로 전체(머리 지름) — HEX 는 표의 dk 가 대각 거리
  const cy = H/2, yT = cy - d/2, yB = cy + d/2;
  /* 접시머리의 호칭 길이 L 은 머리를 포함한 전체 길이다 — 그대로 k+L 로 그리면
     M10×20 접시가 26mm 로 길어져 1:1 대조가 무의미해진다. */
  const shank = HEAD_IN_LENGTH[head] ? Math.max(1, L - k) : L;
  const full = k + shank + 0.6, fit = full <= availW;     // 0.6 = 좌우 선 두께 여유
  const drawL = fit ? shank : Math.max(6, availW - k - 3.5);
  const x0 = k, x1 = k + drawL;
  const sw = Math.max(0.2, H*0.022), thin = sw*0.6;
  let g = '';

  /* 중심선 (일점쇄선) — 반단면의 하단 경계선이자 실물을 맞추는 기준선이라 조금 굵게 */
  g += `<line x1="0" y1="${n2(cy)}" x2="${n2(x1+0.3)}" y2="${n2(cy)}" stroke="#000" stroke-width="${n2(thin*1.3)}" stroke-dasharray="${n2(p*1.6)} ${n2(p*0.5)} ${n2(p*0.2)} ${n2(p*0.5)}"/>`;

  /* 나사부 외곽 — 위/아래 지그재그 + 끝단 챔퍼 */
  const neck = Math.min(Math.max(0.6, p*0.8), drawL*0.15);
  let top = `M${n2(x0)} ${n2(yT)}L${n2(x0+neck)} ${n2(yT)}`;
  let bot = `M${n2(x0)} ${n2(yB)}L${n2(x0+neck)} ${n2(yB)}`;
  for(let x = x0 + neck; x < x1 - 0.01; x += p){
    const xm = Math.min(x + p/2, x1), xe = Math.min(x + p, x1);
    top += `L${n2(xm)} ${n2(yT+th)}L${n2(xe)} ${n2(yT)}`;
    bot += `L${n2(xm)} ${n2(yB-th)}L${n2(xe)} ${n2(yB)}`;
  }
  g += `<path d="${top}" fill="none" stroke="#000" stroke-width="${n2(sw)}"/>`;
  g += `<path d="${bot}" fill="none" stroke="#000" stroke-width="${n2(sw)}"/>`;
  /* 골지름 안내선 */
  g += `<line x1="${n2(x0+neck)}" y1="${n2(yT+th)}" x2="${n2(x1)}" y2="${n2(yT+th)}" stroke="#000" stroke-width="${n2(thin)}"/>`;
  g += `<line x1="${n2(x0+neck)}" y1="${n2(yB-th)}" x2="${n2(x1)}" y2="${n2(yB-th)}" stroke="#000" stroke-width="${n2(thin)}"/>`;
  /* 끝단 — 45° 챔퍼 또는 축약 표시 */
  if(fit){
    g += `<path d="M${n2(x1)} ${n2(yT+th)}L${n2(x1)} ${n2(yB-th)}" fill="none" stroke="#000" stroke-width="${n2(sw)}"/>`;
    g += `<path d="M${n2(x1-th)} ${n2(yT)}L${n2(x1)} ${n2(yT+th)}M${n2(x1-th)} ${n2(yB)}L${n2(x1)} ${n2(yB-th)}" fill="none" stroke="#000" stroke-width="${n2(sw)}"/>`;
  } else {
    g += `<path d="M${n2(x1-1.6)} ${n2(yT)}l1 ${n2(d/3)}l-1 ${n2(d/3)}l1 ${n2(d/3)}" fill="none" stroke="#000" stroke-width="${n2(sw)}"/>`;
  }

  /* 머리 — 종류별 형상 */
  const cham = Math.min(0.7, H*0.07);
  if(head === 'SET'){
    g += `<line x1="0" y1="${n2(yT)}" x2="0" y2="${n2(yB)}" stroke="#000" stroke-width="${n2(sw)}"/>`;
    g += `<rect x="0" y="${n2(cy - d*0.22)}" width="${n2(Math.min(2.2, drawL*0.25))}" height="${n2(d*0.44)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;
  } else if(head === 'BUTTON' || head === 'PHILLIPS'){
    g += `<path d="M${n2(k)} 0A${n2(k*1.35)} ${n2(H/2)} 0 0 0 ${n2(k)} ${n2(H)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    if(head === 'PHILLIPS'){
      const slot = Math.min(dk,H)*0.34;
      g += `<path d="M0 ${n2(cy-slot)}L${n2(k*0.42)} ${n2(cy-slot)}L${n2(k*0.42)} ${n2(cy+slot)}L0 ${n2(cy+slot)}M0 ${n2(cy)}L${n2(k*0.65)} ${n2(cy)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;
    } else {
      g += `<rect x="${n2(k*0.18)}" y="${n2(cy - Math.min(dk,H)*0.5*0.42)}" width="${n2(k*0.5)}" height="${n2(Math.min(dk,H)*0.42)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;
    }
  } else if(head === 'HEX'){
    const s = H/1.1547;                                   // 대변 거리
    g += `<path d="M${n2(cham)} 0L${n2(k)} 0L${n2(k)} ${n2(H)}L${n2(cham)} ${n2(H)}L0 ${n2(H-cham*1.6)}L0 ${n2(cham*1.6)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    g += `<line x1="0" y1="${n2((H-s)/2)}" x2="${n2(k)}" y2="${n2((H-s)/2)}" stroke="#000" stroke-width="${n2(thin)}"/>`;
    g += `<line x1="0" y1="${n2((H+s)/2)}" x2="${n2(k)}" y2="${n2((H+s)/2)}" stroke="#000" stroke-width="${n2(thin)}"/>`;
  } else if(head === 'FLAT'){
    /* 접시머리 — 상면(지름 dk)에서 나사부(지름 d)까지 90°로 좁아지는 원뿔 */
    g += `<path d="M0 0L${n2(k)} ${n2(yT)}L${n2(k)} ${n2(yB)}L0 ${n2(H)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    const sd = Math.min(dk, H) * 0.42, sdep = Math.max(k*0.55, 0.5);
    g += `<path d="M0 ${n2(cy-sd/2)}L${n2(sdep)} ${n2(cy-sd/2)}L${n2(sdep)} ${n2(cy+sd/2)}L0 ${n2(cy+sd/2)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;
  } else if(head === 'FLANGE'){
    const ft = Math.max(0.8, k*0.32), hw = k - ft, sAF = H/1.35;
    g += `<path d="M${n2(hw)} ${n2((H-sAF)/2)}L${n2(k-ft*0.25)} 0L${n2(k)} ${n2(cham)}L${n2(k)} ${n2(H-cham)}L${n2(k-ft*0.25)} ${n2(H)}L${n2(hw)} ${n2((H+sAF)/2)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    g += `<path d="M${n2(cham)} ${n2((H-sAF)/2)}L${n2(hw)} ${n2((H-sAF)/2)}L${n2(hw)} ${n2((H+sAF)/2)}L${n2(cham)} ${n2((H+sAF)/2)}L0 ${n2((H+sAF)/2-cham*1.4)}L0 ${n2((H-sAF)/2+cham*1.4)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
  } else {                                                /* SOCKET · TORX */
    g += `<path d="M${n2(cham)} 0L${n2(k)} 0L${n2(k)} ${n2(H)}L${n2(cham)} ${n2(H)}L0 ${n2(H-cham)}L0 ${n2(cham)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    const sd = Math.min(dk, H) * 0.46, sdep = k*0.62;      // 소켓 홈 (깊이 방향 단면)
    g += `<path d="M0 ${n2(cy-sd/2)}L${n2(sdep)} ${n2(cy-sd/2)}L${n2(sdep)} ${n2(cy+sd/2)}L0 ${n2(cy+sd/2)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;
  }
  /* 머리 밑면 필렛 — 접시머리는 원뿔이 나사부로 바로 이어져 필렛이 없다 */
  if(k > 0 && head !== 'FLAT') g += `<path d="M${n2(k)} ${n2(yT-th*0.6)}Q${n2(k+th*0.5)} ${n2(yT-th*0.3)} ${n2(k+th*0.9)} ${n2(yT)}M${n2(k)} ${n2(yB+th*0.6)}Q${n2(k+th*0.5)} ${n2(yB+th*0.3)} ${n2(k+th*0.9)} ${n2(yB)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;

  /* 길이 기준선 — 호칭 길이 L 의 양 끝에 전체 높이 안내선(실물 정렬용).
     접시머리는 머리 상면부터가 L 이므로 기준이 왼쪽 끝으로 옮겨간다.
     별도 치수선을 두지 않아 세로 공간을 볼트 형상에 모두 쓴다. */
  [HEAD_IN_LENGTH[head] ? 0 : k, x1].forEach(x => g += `<line x1="${n2(x)}" y1="0" x2="${n2(x)}" y2="${n2(H)}" stroke="#000" stroke-width="${n2(thin*0.9)}" stroke-dasharray="${n2(p*0.5)} ${n2(p*0.45)}"/>`);

  /* 반단면 — 중심선을 하단 경계로 두고 칸 높이만큼만 위로 노출한다.
     viewBox 폭·높이를 mm 크기와 똑같이 반환해 preserveAspectRatio="none" 에서도 정확히 1:1이 된다. */
  const bottom = cy + n2(thin*1.3);
  const wanted = cy + 0.5;                                // 머리 외곽 위쪽 여유 포함한 반쪽 높이
  const visH = n2(Math.min(wanted, availH > 0 ? availH : wanted));
  const vbTop = n2(bottom - visH);
  const w = n2(x1 + 0.6);
  return { svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.3 ${vbTop} ${w} ${visH}" preserveAspectRatio="none">${g}</svg>`,
           w, h:visH, fit };
}

function updateBoltQuantity(){
  const per = parseInt($('bPerAssy').value)||0, n = parseInt($('bAssyN').value)||0;
  $('bPerBot').value = per > 0 && n > 0 ? per * n : 0;
}
/* 사내 코드 — CSV 취합과 수동 입력이 같은 규칙을 써야 같은 부품이 같은 코드로 찍힌다 */
const boltCode = (head, dia, len, grade) => ['BT', HEAD_ABBR[head] || 'BLT',
  `${dia}X${len || 0}`, String(grade || '').replace(/[^0-9A-Z]/gi, '')].join('-');
const washerCode = (kind, dia, t) => ['WS', WASHER_ABBR[kind] || 'WSH', `${dia}T${t}`].join('-');

/* 폼의 머리 형상 칸은 워셔도 겸한다 — 값이 WASHER 로 시작하면 워셔 입력 모드다. */
const formWasherKind = () => {
  const v = String($('bHead').value || '');
  return v.startsWith('WASHER') ? (v === 'WASHER-SP' ? 'SPRING' : 'PLAIN') : '';
};
function updateBoltCode(){
  const dia = normalizeThreadDia($('bDia').value) || 'M0';
  const value = String($('bLen').value || '').trim() || '0';
  const kind = formWasherKind();
  $('bCode').value = kind ? washerCode(kind, dia, value)
    : boltCode(normalizeBoltHead($('bHead').value) || 'SOCKET', dia, value, $('bGrade').value);
}
/* 볼트 ↔ 워셔 전환 — 같은 입력칸을 뜻만 바꿔 쓴다(길이→두께, 머리 치수→와셔 치수).
   칸을 따로 만들면 폼이 두 배가 되고 어느 쪽이 활성인지 알기 어려워진다. */
function applyBoltFormMode(){
  const kind = formWasherKind();
  const isFlat = !kind && $('bHead').value === 'FLAT';
  $('boltLegend').textContent = kind ? '워셔 규격' : '볼트 규격';
  $('bLenLabel').textContent = kind ? '두께 (T, mm)' : '길이 (L, mm)';
  $('bDimLabel').innerHTML = (kind ? '와셔 치수' : '머리 치수')
    + ' <span class="tag">(1:1 도면용 · 규격에서 자동, 수정 가능)</span>';
  $('bDkLabel').textContent = kind ? '외경 d2' : '머리 지름 dk';
  $('bKLabel').textContent  = kind ? '내경 d1' : '머리 높이 k';
  $('bGradeCell').style.display = kind ? 'none' : '';   // 워셔는 강도 등급이 없다
  $('bDriveCell').style.display = isFlat ? '' : 'none';
  $('bMetaRow').classList.toggle('r3', isFlat);
  $('bMetaRow').classList.toggle('r2', !isFlat);
  $('boltDwgNote').style.display = kind ? 'none' : '';
}
function boltAuto(){
  updateBoltQuantity();
  applyBoltFormMode();
  const kind = formWasherKind();
  const dia = normalizeThreadDia($('bDia').value);
  /* 규격이 바뀌면 치수를 다시 채운다. 표준값이 없는 조합도 추정값으로 채워야 한다 —
     비워두면 이전 규격의 치수가 남아 엉뚱한 크기로 1:1 도면이 그려진다. */
  if(dia){
    const dim = kind ? washerDims(kind, dia) : headDims(normalizeBoltHead($('bHead').value) || 'SOCKET', dia);
    $('bDk').value = kind ? dim.d2 : dim.dk;
    $('bK').value  = kind ? dim.d1 : dim.k;
    if(kind && !Number.parseFloat($('bLen').value)) $('bLen').value = dim.t;
    const what = kind ? WASHER_LABEL[kind] : (normalizeBoltHead($('bHead').value) || 'SOCKET');
    $('dimNote').textContent = dim.approx
      ? `${what} ${dia} 표준값 없음 — 추정값입니다. 실측해 고쳐 쓰세요.` : '';
    $('dimNote').classList.toggle('warn', dim.approx);
  }
  updateBoltCode();
}
function applyPaper(shouldRender = true){
  $('a4box').style.display = $('paper').value==='a4' ? '' : 'none';
  if(shouldRender) renderAll();
}
