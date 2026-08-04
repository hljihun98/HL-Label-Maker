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

function switchMode(){
  const m = $('mode').value;
  $('matForm').style.display  = m==='mat'  ? '' : 'none';
  $('boltForm').style.display = m==='bolt' ? '' : 'none';
  $('locForm').style.display  = m==='loc'  ? '' : 'none';
  $('csv').placeholder = m==='bolt'
    ? '적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도  ← 엑셀에서 그대로 복사'
    : '품번,Rev,품명,규격,기종,수량,단위,로케이션,협력사,박스수';
  $('mergeWrap').style.display = m==='bolt' ? '' : 'none';
  $('csvHint').innerHTML = m==='bolt'
    ? '순서: <code>적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도</code><br>'
      + '머리: <code>SOCKET</code>(육각소켓) · <code>HEX</code>(헥사 볼트) · <code>PHILLIPS</code>(십자). 엑셀 탭 구분을 자동 인식합니다.<br>'
      + '<b>강도</b> 열은 없어도 됩니다 — 비우면 위 [강도 구분]에서 고른 값이 전 행에 적용됩니다.'
    : '순서: <code>품번,Rev,품명,규격,기종,수량,단위,로케이션,협력사,박스수</code><br>'
      + '<b>규격</b> 열은 자리만 지켜주면 됩니다(라벨에 인쇄하지 않음).<br>'
      + 'LOT-IMS <b>재고현황 CSV</b>는 헤더째 그대로 붙여넣으면 자동으로 매핑됩니다.';
  qrDiag();
}

/* 규격 → 사내 코드 자동 생성 · 1대당 개수 자동 계산 */
const HEAD_ABBR = { SOCKET:'SOC', HEX:'HEX', PHILLIPS:'PHS', FLANGE:'FLG', BUTTON:'BTN', TORX:'TRX', SET:'SET' };
const HEAD_LABEL = {
  SOCKET:'육각소켓', HEX:'헥사 볼트', PHILLIPS:'십자',
  FLANGE:'플랜지', BUTTON:'버튼', TORX:'별', SET:'무두'
};
const HEAD_ALIASES = [
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
function normalizeThreadDia(value){
  const text = String(value || '').trim().toUpperCase().replace(',', '.');
  const match = text.match(/^M?\s*(\d+(?:\.\d+)?)$/);
  if(!match || Number(match[1]) <= 0) return '';
  return `M${Number(match[1])}`;
}

/* 표준 머리 치수 [머리지름 dk, 머리높이 k] (mm)
   SOCKET·TORX: ISO 4762/14579 · BUTTON: ISO 7380 · HEX: ISO 4014 계열(대각 dk)
   PHILLIPS: 일반 팬헤드 · FLANGE: 상용치수 · SET: 무두(dk=나사 지름, k=0)
   1:1 도면 기준값이며 제조사 편차가 있으므로 입력란에서 수정할 수 있다. */
const HEAD_DIM = {
  SOCKET:{'M2.5':[4.5,2.5],M3:[5.5,3],M4:[7,4],M5:[8.5,5],M6:[10,6],M8:[13,8],M10:[16,10],M12:[18,12],M14:[21,14],M16:[24,16],M18:[27,18],M20:[30,20]},
  TORX:  {M3:[5.5,3],M4:[7,4],M5:[8.5,5],M6:[10,6],M8:[13,8],M10:[16,10],M12:[18,12],M14:[21,14],M16:[24,16]},
  PHILLIPS:{'M2.5':[5,2],M3:[5.5,2.4],M4:[7,3.1],M5:[9,3.7],M6:[10.5,4.6],M8:[14,6]},
  HEX:   {M4:[8.1,2.8],M5:[9.2,3.5],M6:[11.1,4],M8:[14.4,5.3],M10:[18.9,6.4],M12:[21.1,7.5],M14:[24.5,8.8],M16:[26.8,10],M18:[29.6,11.5],M20:[33,12.5]},
  FLANGE:{M6:[14,6.8],M8:[17,8],M10:[21,9.8],M12:[25,11.6]},
  BUTTON:{M3:[5.7,1.65],M4:[7.6,2.2],M5:[9.5,2.75],M6:[10.5,3.3],M8:[14,4.4],M10:[17.5,5.5],M12:[21,6.6],M16:[24,8.8]},
  SET:   {M3:[3,0],M4:[4,0],M5:[5,0],M6:[6,0],M8:[8,0],M10:[10,0],M12:[12,0],M14:[14,0],M16:[16,0]}
};
/* 표에 없는 조합(예: PHILLIPS M10)은 나사 지름 배수로 추정한다 — [dk 배수, k 배수].
   추정값을 쓴 라벨은 화면과 라벨 모두에 ≈ 를 붙여 실측이 필요함을 알린다. */
const HEAD_APPROX = {
  SOCKET:[1.5,1.0], TORX:[1.5,1.0], HEX:[1.85,0.65],
  PHILLIPS:[1.8,0.75], FLANGE:[2.2,1.0], BUTTON:[1.85,0.55], SET:[1.0,0]
};
const threadD = dia => Number(String(dia||'').replace(/[^\d.]/g,'')) || 0;
function headDims(head, dia){
  const key = String(dia||'').toUpperCase();
  const table = (HEAD_DIM[head] || HEAD_DIM.SOCKET)[key];
  if(table) return { dk:table[0], k:table[1], approx:false };
  const d = threadD(dia);
  const [fdk, fk] = HEAD_APPROX[head] || HEAD_APPROX.SOCKET;
  return { dk:n2(d*fdk), k:n2(d*fk), approx:true };
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
function headTopSvg(head){
  const ring = '<circle cx="50" cy="50" r="43" fill="#fff" stroke="#000" stroke-width="5"/>'
    + '<circle cx="50" cy="50" r="36" fill="none" stroke="#000" stroke-width="2"/>';
  let g;
  if(head === 'HEX'){
    g = `<path d="${hexPath(50,50,72,0)}" fill="#fff" stroke="#000" stroke-width="6"/>`
      + '<circle cx="50" cy="50" r="28" fill="none" stroke="#000" stroke-width="2"/>';
  } else if(head === 'PHILLIPS'){
    g = ring + '<path d="M50 25V75M25 50H75" fill="none" stroke="#000" stroke-width="11" stroke-linecap="round"/>';
  } else if(head === 'FLANGE'){
    g = '<circle cx="50" cy="50" r="46" fill="#fff" stroke="#000" stroke-width="3"/>'
      + `<path d="${hexPath(50,50,60,0)}" fill="#fff" stroke="#000" stroke-width="6"/>`;
  } else if(head === 'TORX'){
    let path = '';
    for(let i=0;i<12;i++){
      const radius = i%2 ? 18 : 31, angle = (Math.PI/180)*(30*i - 15);
      path += (i?'L':'M') + n2(50 + radius*Math.cos(angle)) + ' ' + n2(50 + radius*Math.sin(angle));
    }
    g = ring + `<path d="${path}Z" fill="#000"/>`;
  } else {                                                  // SOCKET · BUTTON · SET
    g = ring + `<path d="${hexPath(50,50,50,0)}" fill="#000"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
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
  const full = k + L + 0.6, fit = full <= availW;         // 0.6 = 좌우 선 두께 여유
  const drawL = fit ? L : Math.max(6, availW - k - 3.5);
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
  } else if(head === 'FLANGE'){
    const ft = Math.max(0.8, k*0.32), hw = k - ft, sAF = H/1.35;
    g += `<path d="M${n2(hw)} ${n2((H-sAF)/2)}L${n2(k-ft*0.25)} 0L${n2(k)} ${n2(cham)}L${n2(k)} ${n2(H-cham)}L${n2(k-ft*0.25)} ${n2(H)}L${n2(hw)} ${n2((H+sAF)/2)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    g += `<path d="M${n2(cham)} ${n2((H-sAF)/2)}L${n2(hw)} ${n2((H-sAF)/2)}L${n2(hw)} ${n2((H+sAF)/2)}L${n2(cham)} ${n2((H+sAF)/2)}L0 ${n2((H+sAF)/2-cham*1.4)}L0 ${n2((H-sAF)/2+cham*1.4)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
  } else {                                                /* SOCKET · TORX */
    g += `<path d="M${n2(cham)} 0L${n2(k)} 0L${n2(k)} ${n2(H)}L${n2(cham)} ${n2(H)}L0 ${n2(H-cham)}L0 ${n2(cham)}Z" fill="#fff" stroke="#000" stroke-width="${n2(sw)}"/>`;
    const sd = Math.min(dk, H) * 0.46, sdep = k*0.62;      // 소켓 홈 (깊이 방향 단면)
    g += `<path d="M0 ${n2(cy-sd/2)}L${n2(sdep)} ${n2(cy-sd/2)}L${n2(sdep)} ${n2(cy+sd/2)}L0 ${n2(cy+sd/2)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;
  }
  /* 머리 밑면 필렛 */
  if(k > 0) g += `<path d="M${n2(k)} ${n2(yT-th*0.6)}Q${n2(k+th*0.5)} ${n2(yT-th*0.3)} ${n2(k+th*0.9)} ${n2(yT)}M${n2(k)} ${n2(yB+th*0.6)}Q${n2(k+th*0.5)} ${n2(yB+th*0.3)} ${n2(k+th*0.9)} ${n2(yB)}" fill="none" stroke="#000" stroke-width="${n2(thin)}"/>`;

  /* 길이 기준선 — 머리 밑면과 끝단에 전체 높이 안내선(실물 정렬용).
     별도 치수선을 두지 않아 세로 공간을 볼트 형상에 모두 쓴다. */
  [k, x1].forEach(x => g += `<line x1="${n2(x)}" y1="0" x2="${n2(x)}" y2="${n2(H)}" stroke="#000" stroke-width="${n2(thin*0.9)}" stroke-dasharray="${n2(p*0.5)} ${n2(p*0.45)}"/>`);

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
function updateBoltCode(){
  const head = normalizeBoltHead($('bHead').value) || 'SOCKET';
  const dia = normalizeThreadDia($('bDia').value) || 'M0';
  const length = String($('bLen').value || '').trim() || '0';
  const code = ['BT', HEAD_ABBR[head] || 'BLT', `${dia}X${length}`,
    ($('bGrade').value||'').replace(/[^0-9A-Z]/gi,'')].join('-');
  $('bCode').value = code;
}
function boltAuto(){
  updateBoltQuantity();
  const head = normalizeBoltHead($('bHead').value) || 'SOCKET';
  const dia = normalizeThreadDia($('bDia').value);
  /* 규격이 바뀌면 머리 치수를 다시 채운다. 표준값이 없는 조합도 추정값으로 채워야 한다 —
     비워두면 이전 규격의 치수가 남아 엉뚱한 크기로 1:1 도면이 그려진다. */
  if(dia){
    const dim = headDims(head, dia);
    $('bDk').value = dim.dk;
    $('bK').value = dim.k;
    $('dimNote').textContent = dim.approx
      ? `${head} ${dia} 표준값 없음 — 추정값입니다. 실측해 고쳐 쓰세요.` : '';
    $('dimNote').classList.toggle('warn', dim.approx);
  }
  updateBoltCode();
}
function applyPaper(shouldRender = true){
  $('a4box').style.display = $('paper').value==='a4' ? '' : 'none';
  if(shouldRender) renderAll();
}
