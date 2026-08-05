const MAX_LABELS = 400;      // 브라우저가 감당하는 현실적 상한 (QR·바코드가 라벨마다 들어감)
const PREVIEW_MAX = 50;      // 미리보기는 앞부분만 — 수백 장을 화면에 그리면 느려진다

function roomLeft(){ return MAX_LABELS - items.length; }
function capWarn(want){
  const room = roomLeft();
  if(want <= room) return want;
  if(room <= 0){ alert(`목록이 이미 ${MAX_LABELS}장입니다. 인쇄 후 [전체 비우기]를 눌러주세요.`); return 0; }
  alert(`한 번에 ${MAX_LABELS}장까지만 담을 수 있습니다. ${room}장만 추가합니다.`);
  return room;
}

/* ---------- 박스 ID 채번 ----------
   라벨 1장 = 실물 박스 1개이므로 박스 ID는 재고의 고유키다. 순번을 화면에만 두면
   브라우저를 다시 열 때 1로 돌아가 같은 날 두 번 작업하면 ID가 중복된다.
   그래서 날짜별 '마지막으로 발행한 순번'을 브라우저에 저장한다.
   저장값은 올라가기만 한다 — 라벨 훼손 재인쇄로 순번을 수동으로 되돌려도(문서 §4)
   다음 신규 발행이 이미 쓴 번호를 다시 쓰지 않는다. */
const SEQ_KEY = 'hlr.labelmaker.boxSeq';
const SEQ_KEEP_DAYS = 90;
let seqWarned = false;
function seqStore(){
  try{
    const raw = JSON.parse(localStorage.getItem(SEQ_KEY));
    return (raw && typeof raw === 'object') ? raw : {};
  }catch(error){ return {}; }
}
function seqSave(store){
  try{
    const kept = Object.keys(store).sort().slice(-SEQ_KEEP_DAYS);
    localStorage.setItem(SEQ_KEY, JSON.stringify(
      kept.reduce((out, key)=>{ out[key] = store[key]; return out; }, {})));
  }catch(error){
    if(seqWarned) return;
    seqWarned = true;
    console.warn('박스 ID 순번을 저장할 수 없습니다 — 이 창을 닫으면 1번부터 다시 시작합니다.', error);
  }
}
const seqDateKey = () => yymmdd($('dt').value || localIsoDate());
function commitSeq(lastSeq){
  if(!(lastSeq > 0)) return;
  const store = seqStore(), key = seqDateKey();
  if((store[key] || 0) >= lastSeq) return;
  store[key] = lastSeq;
  seqSave(store);
}
/* 입고일 기준으로 다음 번호를 시작 번호 칸에 채운다 (시작 시 · 입고일 변경 시) */
function syncSeq(){ $('bs').value = (seqStore()[seqDateKey()] || 0) + 1; }
/* 발행 직후 시작 번호 칸을 다음 번호로 되돌린다 — 저장값(이미 쓴 마지막 번호)을 하한으로 둔다.
   재인쇄(문서 §4)로 시작 번호를 손으로 내리면 발행 후 칸도 그 뒤 번호에서 멈추므로,
   하한이 없으면 같은 세션에서 이어 발행할 때 이미 붙인 박스 ID를 다시 찍는다. */
function restoreSeq(nextSeq){
  $('bs').value = Math.max(nextSeq, (seqStore()[seqDateKey()] || 0) + 1);
}
function nextBox(seq){
  const d = $('dt').value || localIsoDate();
  return `${$('bp').value}${yymmdd(d)}-${String(seq).padStart(3,'0')}`;
}
const startSeq = () => Math.max(1, parseInt($('bs').value)||1);

/* ---------- 목록 ---------- */
function addLabels(){
  if($('mode').value==='loc'){
    const bulk = $('lbulk').value.trim();
    if(bulk){
      const lines = bulk.split(/\r?\n/).filter(Boolean);
      const take = capWarn(lines.length);
      if(!take) return;
      const parsed = [];
      try{
        lines.forEach((line, index) => {
          const cells = splitCells(line);
          const code = (cells.shift() || '').trim();
          if(!code) throw new Error(`${index + 1}번째 줄의 로케이션 코드가 비어 있습니다.`);
          parsed.push({type:'loc', code, desc:cells.join(', ').trim()});
        });
      }catch(error){ alert(error.message); return; }
      items.push(...parsed.slice(0, take));
    } else {
      const code = $('lcode').value.trim();
      if(!code){ alert('로케이션 코드를 입력하세요.'); return; }
      if(!capWarn(1)) return;
      items.push({type:'loc', code, desc:$('ldesc').value.trim()});
    }
    renderAll(); return;
  }
  if($('mode').value==='bolt'){
    const head = normalizeBoltHead($('bHead').value);
    const dia = normalizeThreadDia($('bDia').value);
    const length = Number.parseFloat($('bLen').value);
    const dk = Number.parseFloat($('bDk').value);
    const k = Number.parseFloat($('bK').value);
    if(!head){ alert('지원하는 볼트 머리 형상을 선택하세요.'); return; }
    if(!dia){ alert('직경을 M8 또는 8 형식의 양수로 입력하세요.'); return; }
    if(!Number.isFinite(length) || length <= 0){ alert('볼트 길이를 0보다 큰 숫자로 입력하세요.'); return; }
    if(!Number.isFinite(dk) || dk <= 0 || !Number.isFinite(k) || k < 0){
      alert('머리 지름은 0보다 크게, 머리 높이는 0 이상으로 입력하세요.'); return;
    }
    $('bDia').value = dia;
    if(!$('bCode').value.trim()) updateBoltCode();
    const bn = capWarn(Math.max(1, parseInt($('bN').value)||1));
    if(!bn) return;
    let bseq = startSeq();
    for(let i=0;i<bn;i++,bseq++){
      items.push({type:'bolt', pn:$('bCode').value.trim(), rev:'',
        head, dia, len:String(length),
        grade:$('bGrade').value, mat:$('bMat').value.trim(),
        dk:String(dk), k:String(k),
        prod:$('bProd').value.trim(), cat:$('bCat').value.trim(), pos:$('bPos').value.trim(),
        perBot:$('bPerBot').value.trim(), box:nextBox(bseq)});
    }
    commitSeq(bseq - 1);
    restoreSeq(bseq);
    renderAll(); return;
  }
  if(!$('pn').value.trim()){ alert('품번을 입력하세요.'); return; }
  const n = capWarn(Math.max(1, parseInt($('bn').value)||1));
  if(!n) return;
  let seq = startSeq();
  for(let i=0;i<n;i++,seq++){
    items.push({type:'mat',pn:$('pn').value.trim(),rev:$('rev').value.trim(),nm:$('nm').value.trim(),
      pj:$('pj').value.trim(),qty:$('qty').value.trim(),unit:$('unit').value,
      vd:$('vd').value.trim(),dt:$('dt').value,loc:$('loc').value.trim(),box:nextBox(seq)});
  }
  commitSeq(seq - 1);
  restoreSeq(seq);
  renderAll();
}
/* 셀 분리 — 엑셀 복사(탭)와 CSV 모두 지원.
   탭이 있으면 탭만 사용한다: 적용 위치에 "BLOCK, BREAK"처럼 쉼표가 들어가면 열이 밀리기 때문.
   순수 CSV는 인용부호 안의 쉼표를 보존한다. */
function splitCells(line){
  if(line.indexOf('\t') >= 0) return line.split('\t').map(s=>s.trim());
  const out = []; let cur = '', q = false;
  for(let i=0;i<line.length;i++){
    const ch = line[i];
    if(ch === '"'){ if(q && line[i+1] === '"'){ cur += '"'; i++; } else q = !q; }
    else if(ch === ',' && !q){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  if(q) throw new Error('닫히지 않은 CSV 인용부호(")가 있습니다.');
  out.push(cur);
  return out.map(s=>s.trim());
}
/* 박스수 열 — 표준 양식은 10열(마지막이 박스수), 구 양식은 11열(안전재고 포함)이다.
   열 개수로 판단하면 후행 빈 셀 하나에 열이 밀려 엉뚱한 칸을 읽으므로
   11번째를 먼저 보고 비어 있으면 10번째를 쓴다. */
function boxCount(cells){
  const raw = String(cells[10] ?? '').trim() || String(cells[9] ?? '').trim();
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LABELS) : 1;
}
/* 강도 표기 정리 — 현장에서 "12.9T"로 쓰므로 뒤에 붙는 T 를 떼고 라벨 표기와 맞춘다 */
const normalizeGrade = value => String(value || '').trim().toUpperCase().replace(/\s*T$/, '');

function importCsv(){
  const lines = $('csv').value.trim().split(/\r?\n/).filter(Boolean);
  if(!lines.length){ alert('붙여넣은 내용이 없습니다.'); return; }
  let table;
  try{ table = lines.map(splitCells); }
  catch(error){ alert(error.message); return; }

  /* 볼트 표 붙여넣기 — 적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도(선택) */
  if($('mode').value==='bolt'){
    const formGrade = $('bGrade').value;
    const rows = [];
    let invalidRows = 0;
    table.forEach(c=>{
      const first = String(c[0] || '').replace(/^\uFEFF/, '').trim();
      const diaCell = String(c[4] || '').trim();
      if(/^(적용\s*제품|product)$/i.test(first) || /^(직경|dia(?:meter)?)$/i.test(diaCell)) return;
      const head = normalizeBoltHead(c[3] || 'SOCKET');
      const dia = normalizeThreadDia(diaCell);
      const lengthText = String(c[5] || '').trim().replace(',', '.').replace(/^L\s*/i, '');
      const lengthMatch = lengthText.match(/^(-?\d+(?:\.\d+)?)\s*(?:MM)?$/i);
      const lenNumber = lengthMatch ? Number(lengthMatch[1]) : NaN;
      if(!head || !dia || !Number.isFinite(lenNumber) || lenNumber <= 0){ invalidRows++; return; }
      const perAssy = Math.max(0, parseInt(c[6])||0), assyN = Math.max(0, parseInt(c[7])||0);
      rows.push({ head, dia, len:String(lenNumber), mat:c[9]||$('bMat').value.trim(),
        grade: normalizeGrade(c[10]) || formGrade,          // 강도 열이 없으면 화면에서 고른 값
        prod:c[0]||'', cat:c[1]||'', pos:c[2]||'',
        perBot: Math.max(0, parseInt(c[8]) || perAssy*assyN || 0) });
    });
    if(!rows.length){ alert('인식된 줄이 없습니다. 직경(M8) 열이 5번째인지 확인하세요.'); return; }

    /* 같은 규격이 여러 위치에 쓰이면 한 박스에 담기므로 라벨도 하나로 합치고,
       위치별 개수는 "이름 : 개수" 로 각 줄에 남긴다 (합계는 캡션에 표시).
       강도가 다르면 다른 부품이므로(관절부 12.9 / 커버 8.8) 절대 합치지 않는다. */
    const pcOf = r => r.prod && r.cat ? r.prod + ' · ' + r.cat : (r.prod || r.cat || '');
    const posOf = r => r.pos ? r.pos + (r.perBot ? ' : ' + r.perBot : '') : '';
    let merged = rows;
    if($('bMerge').checked){
      const map = new Map();
      rows.forEach(r=>{
        const key = [r.head, r.dia, r.len, r.mat, r.grade].join('|');
        let m = map.get(key);
        if(!m){ m = { ...r, prods:[], posQty:new Map(), perBot:0 }; map.set(key, m); }
        if(pcOf(r) && !m.prods.includes(pcOf(r))) m.prods.push(pcOf(r));
        /* 위치는 이름 단위로 개수를 합산한다 — BOM 이 서브어셈블리별로 쪼개져 있어
           같은 위치가 여러 줄로 들어온다. 완성된 "위치 : 개수" 문자열로 중복을 제거하면
           개수가 같은 줄(FRT:4 / FRT:4)이 하나 버려져 라벨 개수가 실제보다 적게 찍히고,
           개수만 다른 줄(FRT:16 / FRT:12)은 남아 한 곳이 두 곳으로 부풀려진다. */
        if(r.pos) m.posQty.set(r.pos, (m.posQty.get(r.pos) || 0) + r.perBot);
        m.perBot += r.perBot;
      });
      merged = [...map.values()].map(m=>({ ...m, prod:m.prods.join('\n'), cat:'',
        pos:[...m.posQty].map(([pos, qty]) => pos + (qty ? ' : ' + qty : '')).join('\n') }));
    } else {
      merged = rows.map(r=>({ ...r, prod:pcOf(r), cat:'', pos:posOf(r) }));
    }

    const take = capWarn(merged.length);
    if(!take) return;
    let seq = startSeq();
    merged.slice(0, take).forEach(r=>{
      const code = ['BT', HEAD_ABBR[r.head] || 'BLT', r.dia+'X'+(r.len||'0'),
                    r.grade.replace(/[^0-9A-Z]/gi,'')].join('-');
      const dim = headDims(r.head, r.dia);
      items.push({type:'bolt', pn:code, rev:'', head:r.head, dia:r.dia, len:r.len,
        grade:r.grade, mat:r.mat, dk:String(dim.dk), k:String(dim.k),
        prod:r.prod, cat:r.cat, pos:r.pos, perBot:(r.perBot || '') + '', box:nextBox(seq++)});
    });
    commitSeq(seq - 1);
    restoreSeq(seq);
    $('csv').value = ''; renderAll();
    /* 붙여넣은 줄 수보다 라벨이 적게 나오는 경우가 두 가지라 어느 쪽인지 밝힌다 —
       합치기로 줄어든 것을 누락으로 오해하면 붙여넣기를 반복해 박스 ID만 낭비한다. */
    const notes = [];
    if(take < merged.length) notes.push(`목록 상한(${MAX_LABELS}장)에 도달해 ${take}장만 추가했습니다.`);
    if(invalidRows) notes.push(`형식이 잘못된 ${invalidRows}개 행은 제외했습니다 (머리·직경·길이 열을 확인하세요).`);
    if(merged.length < rows.length) notes.push(
      `${rows.length}개 행을 동일 규격끼리 합쳐 ${merged.length}종 = ${take}장이 되었습니다.`
      + `\n행마다 라벨이 필요하면 [동일 규격 합치기]를 끄고 다시 붙여넣으세요.`);
    if(notes.length) alert(notes.join('\n\n'));
    return;
  }
  // LOT-IMS 재고현황 CSV 헤더 자동 인식 → 품번/리비전/품명/제품군/단위/현재고/안전재고/상태/보관위치
  const head = (table[0] || []).join('|').replace(/^\uFEFF/,'');
  if(/품번/.test(head) && /제품군/.test(head)){
    table = table.slice(1).map(c=>{
      //       품번   Rev     품명     규격 기종(제품군) 수량(현재고) 단위      로케이션  협력사 박스수
      return [c[0], c[1]||'', c[2]||'', '', c[3]||'', c[5]||'', c[4]||'EA', c[8]||'', '', '1'];
    });
  }
  let seq = startSeq();
  let stop = false;
  table.forEach(c=>{
    if(stop) return;
    c[0] = String(c[0] || '').replace(/^\uFEFF/, '').trim();
    if(!c[0] || /^품번/.test(c[0])) return;
    let n = boxCount(c);
    if(n > roomLeft()){ n = roomLeft(); stop = true; }
    if(n <= 0){ stop = true; return; }
    for(let i=0;i<n;i++,seq++){
      /* c[3] = 규격 — 라벨에 인쇄하지 않으므로 자리만 지키고 읽지 않는다 */
      items.push({type:'mat',pn:c[0],rev:c[1]||'',nm:c[2]||'',pj:c[4]||'',qty:c[5]||'',
        unit:c[6]||'EA',loc:c[7]||'',vd:c[8]||'',dt:$('dt').value,box:nextBox(seq)});
    }
  });
  commitSeq(seq - 1);
  restoreSeq(seq);
  $('csv').value=''; renderAll();
  if(stop) alert(`목록 상한(${MAX_LABELS}장)에 도달해 일부만 추가했습니다.`);
}
function doPrint(){
  if(!items.length){ alert('인쇄할 라벨이 없습니다. 정보를 입력하고 [목록에 추가]를 누르세요.'); return; }
  renderAll(true);                        // 인쇄 직전에만 전체 장수를 그린다
  try{ window.print(); } finally { renderAll(); }
}
function clearAll(){ items=[]; renderAll(); }
function del(i){ items.splice(i,1); renderAll(); }
function zoom(d){ scale = Math.min(2, Math.max(.5, scale + d*0.15)); renderAll(); }

let renderFrame = 0;
function scheduleRender(){
  if(renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderAll();
  });
}
function renderAll(full){
  if(renderFrame){ cancelAnimationFrame(renderFrame); renderFrame = 0; }
  const shown = full ? items : items.slice(0, PREVIEW_MAX);
  $('cnt').textContent = items.length + '장'
    + (items.length > shown.length ? ` (미리보기 ${shown.length}장)` : '');
  const desc = it => {
    if(it.type === 'loc') return it.desc || '';
    if(it.type === 'bolt'){
      const positions = splitMulti(it.pos).length;
      return `${HEAD_LABEL[it.head] || it.head} ${it.dia}×${it.len} ${it.grade} · ${it.mat}`
        + (positions > 1 ? ` · 적용 ${positions}곳` : '');
    }
    return `${it.nm} · ${it.qty}${it.unit} · ${it.box} · ${it.loc||'로케이션 수기'}`;
  };
  $('listWrap').innerHTML = items.length ? '<div class="list">' + items.map((it,i)=>
    `<div class="it"><b>${esc(it.type==='loc'?it.code:it.pn)}</b><span>${esc(desc(it))}</span><button type="button" data-delete-index="${i}">삭제</button></div>`
  ).join('') + '</div>' : '<div class="empty">왼쪽에서 정보를 입력하고 <b>목록에 추가</b>를 누르세요.</div>';

  const a4 = $('paper').value==='a4';
  const grid = a4 ? sheetGrid() : null;
  const prev = $('prev');
  if(a4){
    const per = grid.per, pages = [];
    for(let i=0;i<shown.length;i+=per) pages.push(shown.slice(i,i+per));
    prev.innerHTML = pages.map(p=>`<div class="sheet">${p.map(it=>
      `<div class="cell">${labelOf(it)}</div>`).join('')}</div>`).join('') || '';
    prev.style.display = 'block';
  } else {
    prev.innerHTML = shown.map(it=>`<div class="pw">${labelOf(it)}</div>`).join('');
    prev.style.display = 'flex';
  }
  applyStyles(grid);
  qrDiag();
}

/* QR 밀도 진단 — 셀(모듈) 한 변의 인쇄 크기로 판정한다.
   기준은 실측이다: 현재 프린터·유포지 조합에서 0.38mm 셀이 폰 카메라로 인식되는 것을 확인했다.
   URL형으로 바꾸면 데이터가 3~4배 길어져 모듈 수가 늘고 셀이 급격히 작아지므로 그때 경고가 뜬다. */
function qrDiag(){
  const mode = $('mode').value;
  const sample = items.find(item => item.type === mode) || items[0];
  const el = $('qrDiag');
  if(!sample){ el.textContent=''; return; }
  const data = qrData(sample);
  const urlMode = $('qmode').value === 'url' && sample.type !== 'bolt';
  const advice = urlMode ? '기준 URL을 짧게 하세요' : 'QR 칸이 좁습니다 — 라벨 종류를 확인하세요';
  let q;
  try{ q = makeQrCode(data, $('ecc').value); }
  catch(error){
    el.innerHTML = `<b style="color:#b32020">QR 생성 실패</b> — 데이터가 ${data.length}자로 너무 깁니다. ${advice}.`;
    return;
  }
  const quietZone = sample.type === 'loc' ? 4 : 2;
  const modules = q.getModuleCount();
  const mm = qrPrintSide(sample.type) / (modules + quietZone*2);
  const grade = mm>=0.37 ? ['양호','#127a3d'] : mm>=0.30 ? ['주의 – 스캔 거리·조명 확인','#a86a00'] : ['위험','#b32020'];
  el.innerHTML = `현재 QR <b>${modules}×${modules}</b> 모듈 · 셀 <b>${mm.toFixed(2)}mm</b>`
    + ` · <b style="color:${grade[1]}">${grade[0]}</b> · 데이터 ${data.length}자`
    + (mm < 0.37 ? ` — ${advice}` : '');
}

/* 페이지 규격 + 화면 배율 */
function applyStyles(grid){
  const a4 = $('paper').value==='a4';
  const mx=fieldNumber('mx'), my=fieldNumber('my'), gx=fieldNumber('gx'), gy=fieldNumber('gy');
  const W=num('lw'), H=num('lh');
  const dx = a4 ? 0 : num('dx'), dy = a4 ? 0 : num('dy');   // A4는 시트 전체를 옮긴다
  /* 라벨 칸 치수는 label-renderers.js 의 상수 하나만 고치면 CSS 까지 따라오도록 변수로 넘긴다 */
  let css = `.label{--lw:${W}mm;--lh:${H}mm;--pt:${num('pt')}mm;--pb:${num('pb')}mm;
       --pl:${num('pl')}mm;--pr:${num('pr')}mm;--dx:${dx}mm;--dy:${dy}mm;
       --sc:${(num('sc')||100)/100};--fs:${num('fs')||1};--bw:${num('bw')}mm}
     .matmode{--qr-w:${MAT_LAYOUT.qrW}mm;--rev-w:${MAT_LAYOUT.revW}mm}
     .boltmode{--qr-w:${BOLT_LAYOUT.qrW}mm;--grade-w:${BOLT_LAYOUT.gradeW}mm;
       --top-w:${BOLT_LAYOUT.topW}mm;--side-w:${mmv(BOLT_LAYOUT.sideW + FC_PAD*2)}mm}
     .pw,.cell{width:${W}mm;height:${H}mm;overflow:hidden}
     ${a4?`.sheet{transform:translate(${num('dx')}mm,${num('dy')}mm)}`:''}`;
  css += a4
    ? `@page{size:A4;margin:0}
       .sheet{width:210mm;height:297mm;padding:${my}mm ${mx}mm;display:grid;
         grid-template-columns:repeat(${(grid || sheetGrid()).cols},${W}mm);grid-auto-rows:${H}mm;column-gap:${gx}mm;row-gap:${gy}mm;
         background:#fff;page-break-after:always;box-shadow:0 1px 6px rgba(0,0,0,.13);margin:0 auto 16px;}
       .sheet:last-child{page-break-after:auto}
       @media print{.sheet{box-shadow:none;margin:0}}`
    : `@page{size:${W}mm ${H}mm;margin:0}
       @media print{.pw{page-break-after:always}.pw:last-child{page-break-after:auto}}`;
  css += `@media screen{.preview>*{zoom:${scale}}}`;
  const cl = $('clearInfo');
  if(cl){
    const s = (num('sc')||100)/100;
    const bot = (num('lh') - num('pb') + num('dy')) * s;      // 푸터 끝의 인쇄 위치
    const top = (num('pt') + num('dy')) * s;                  // 위쪽 흰 여유
    const warn = v => v < 1.5 ? '#b32020' : v < 2.5 ? '#a86a00' : 'inherit';
    cl.innerHTML = `가장자리 여유 — 아래 <b style="color:${warn(num('lh')-bot)}">${(num('lh')-bot).toFixed(1)}mm</b>`
      + ` · 위 <b style="color:${warn(top)}">${top.toFixed(1)}mm</b>`
      + ` <span style="color:var(--muted)">· 라벨 프린터 2mm↑ / 레이저 4mm↑ 권장</span>`;
  }
  const gi = $('gridInfo');
  if(gi){ const g = grid || sheetGrid();
    gi.innerHTML = `A4 1장 = <b>${g.cols}열 × ${g.rows}행 = ${g.per}칸</b> · 라벨 ${g.W}×${g.H}mm`
      + (g.cols*g.W + (g.cols-1)*g.gx + g.mx*2 > 210 ? ' <b style="color:#b32020">· 가로 초과</b>' : ''); }
  let el = document.getElementById('pageCss');
  if(!el){ el=document.createElement('style'); el.id='pageCss'; document.head.appendChild(el); }
  el.textContent = css;
}
['mx','my','gx','gy'].concat(CAL_IDS).forEach(id=>$(id).addEventListener('input', scheduleRender));

/* A4 한 장에 들어가는 라벨 격자를 실측 크기·여백·간격에서 계산 */
function sheetGrid(){
  const W=num('lw'), H=num('lh');
  const mx=fieldNumber('mx'), my=fieldNumber('my'), gx=fieldNumber('gx'), gy=fieldNumber('gy');
  const cols = Math.max(1, Math.floor((210 - 2*mx + gx) / (W + gx)));
  const rows = Math.max(1, Math.floor((297 - 2*my + gy) / (H + gy)));
  return { W, H, mx, my, gx, gy, cols, rows, per: cols*rows };
}

/* ---------- 정합 테스트 인쇄 ----------
   라벨과 똑같은 크기·여백·이동·배율로 눈금자를 인쇄한다.
   잘린 쪽 가장자리에서 마지막으로 보이는 숫자 = 잘린 양(mm). */
function calibSvg(W,H){
  const g = [];
  const line=(x1,y1,x2,y2,w)=>g.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${w}"/>`);
  const text=(x,y,s,sz,an)=>g.push(`<text x="${x}" y="${y}" font-size="${sz}" text-anchor="${an||'start'}" font-family="Consolas,monospace" font-weight="700">${s}</text>`);
  for(let x=0;x<=W;x+=10) line(x,0,x,H,0.12);
  for(let y=0;y<=H;y+=10) line(0,y,W,y,0.12);
  for(let x=0;x<=W;x+=5){ line(x,0,x,x%10?2:3.4,0.25); line(x,H,x,H-(x%10?2:3.4),0.25); }
  for(let y=0;y<=H;y+=5){ line(0,y,y%10?2:3.4,y,0.25); line(W,y,W-(y%10?2:3.4),y,0.25); }
  for(let x=10;x<=W-10;x+=10){ text(x+0.8,6.2,x,2.6); text(x+0.8,H-4.2,x,2.6); }
  for(let y=10;y<=H-10;y+=10){ text(1.2,y-1.2,y,2.6); text(W-1.2,H-y-1.2,y,2.6,'end'); }
  text(W/2,H/2-3.5,'정합 테스트',4,'middle');
  text(W/2,H/2+1,`${W} x ${H} mm`,3.2,'middle');
  text(W/2,H/2+5,`이동 ${num('dx')} / ${num('dy')} mm · 배율 ${num('sc')}%`,2.6,'middle');
  text(W/2,H/2+9,'오른쪽 숫자 = 아래 끝에서부터의 거리',2.4,'middle');
  g.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#000" stroke-width="0.5"/>`);
  [[0,0],[W,0],[0,H],[W,H]].forEach(([x,y])=>g.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="none" stroke="#000" stroke-width="0.4"/>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">
    <rect width="100%" height="100%" fill="#fff"/>${g.join('')}</svg>`;
}
/* A4 시트용 정합 — 다이컷 위치(여백·간격)를 맞추기 위한 격자 시트 */
function calibSheetSvg(){
  const g = sheetGrid(), t = [];
  const line=(x1,y1,x2,y2,w,dash)=>t.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${w}"${dash?' stroke-dasharray="1 1"':''}/>`);
  const txt=(x,y,s,sz,an)=>t.push(`<text x="${x}" y="${y}" font-size="${sz}" text-anchor="${an||'start'}" font-family="Consolas,monospace" font-weight="700">${s}</text>`);
  for(let x=0;x<=210;x+=5){ line(x,0,x,x%10?2:3.5,0.2); if(x%20===0&&x) txt(x+0.6,6.5,x,2.8); }
  for(let y=0;y<=297;y+=5){ line(0,y,y%10?2:3.5,y,0.2); if(y%20===0&&y) txt(1,y-1,y,2.8); }
  for(let r=0;r<g.rows;r++) for(let c=0;c<g.cols;c++){
    const x=g.mx+c*(g.W+g.gx), y=g.my+r*(g.H+g.gy);
    t.push(`<rect x="${x}" y="${y}" width="${g.W}" height="${g.H}" fill="none" stroke="#000" stroke-width="0.35"/>`);
    [[x,y],[x+g.W,y],[x,y+g.H],[x+g.W,y+g.H]].forEach(a=>t.push(`<circle cx="${a[0]}" cy="${a[1]}" r="1.4" fill="none" stroke="#000" stroke-width="0.3"/>`));
    txt(x+2.5, y+6, `${r*g.cols+c+1}`, 5);
    txt(x+2.5, y+10.5, `x ${x} / y ${y} mm`, 2.6);
    line(x, y+g.H/2, x+g.W, y+g.H/2, 0.15, true);
    line(x+g.W/2, y, x+g.W/2, y+g.H, 0.15, true);
  }
  txt(105, 292, `여백 ${g.mx}/${g.my}mm · 간격 ${g.gx}/${g.gy}mm · 라벨 ${g.W}×${g.H}mm · ${g.cols}열 ${g.rows}행`, 3.2, 'middle');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm">
    <rect width="100%" height="100%" fill="#fff"/>${t.join('')}</svg>`;
}
function printCalib(){
  const a4 = $('paper').value==='a4';
  const W = a4 ? 210 : num('lw'), H = a4 ? 297 : num('lh');
  const w = window.open('', '_blank');
  if(!w){ alert('팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 눌러주세요.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>정합 테스트</title>
    <style>*{margin:0;padding:0}@page{size:${W}mm ${H}mm;margin:0}
    body{background:#fff}
    .p{width:${W}mm;height:${H}mm;overflow:hidden;
       transform:translate(${num('dx')}mm,${num('dy')}mm) scale(${(num('sc')||100)/100});transform-origin:0 0}
    svg{display:block}</style></head><body><div class="p">${a4?calibSheetSvg():calibSvg(num('lw'),num('lh'))}</div>
    <scr`+`ipt>window.onload=function(){setTimeout(function(){window.print()},150)}</scr`+`ipt></body></html>`);
  w.document.close();
}

$('listWrap').addEventListener('click', event => {
  const button = event.target.closest('[data-delete-index]');
  if(!button) return;
  const index = Number.parseInt(button.dataset.deleteIndex, 10);
  if(Number.isInteger(index) && index >= 0 && index < items.length) del(index);
});

/* 시작 — 샘플 라벨을 자동으로 넣지 않는다. 모르고 인쇄하면 실물 없는 박스 ID가 발행된다. */
applyCalDefaults();
boltAuto();
switchMode();
applyPaper(false);
syncSeq();
renderAll();
