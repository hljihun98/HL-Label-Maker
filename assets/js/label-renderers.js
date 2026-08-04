/* ---------- QR / 바코드 ---------- */
/* QR·바코드는 같은 데이터가 반복되므로 캐시한다 (라벨 수백 장 미리보기 갱신 비용 제거) */
const _qrCache = new Map(), _bcCache = new Map();
/* 라벨 칸 치수(mm) — CSS 는 applyStyles() 가 주입하는 변수로 이 값을 그대로 쓴다.
   여기 숫자만 고치면 화면·인쇄·QR 진단이 함께 따라온다. */
const FC_PAD = 1.4;                                    // .fc 좌우 패딩(mm)
/* 자재·볼트 라벨의 푸터(QR + 1D 바코드)는 높이를 10.2mm 로 통일한다 —
   두 라벨을 같은 박스 랙에 섞어 붙이므로 스캔 위치가 같아야 하고,
   QR 칸은 정사각형이어야 하므로 폭도 같은 값을 쓴다(남는 폭은 1D 바코드가 가져간다). */
const FOOT_H = 10.2;
const MAT_LAYOUT = Object.freeze({ headerH:9, footerH:FOOT_H, qrW:FOOT_H, revW:10 });
const BOLT_LAYOUT = Object.freeze({
  headerH:5.2, footerH:FOOT_H, qrW:FOOT_H,
  sideW:55, topW:15, gradeW:10,
  heroH:15.5, shapeH:11.5
});
function cacheGet(map, key, make){
  let v = map.get(key);
  if(v === undefined){ if(map.size > 1200) map.clear(); v = make(); map.set(key, v); }
  return v;
}
/* QR — quiet zone 은 모듈 수로만 확보하고 칸 안의 CSS 여백은 두지 않는다.
   작은 칸에서는 여백을 늘릴수록 셀이 작아져 오히려 인식이 나빠진다. */
const qrSvg = (text, margin) => {
  const quietZone = margin == null ? 4 : margin;
  return cacheGet(_qrCache, `${$('ecc').value}:${quietZone}|${text}`,
    () => qrSvgTag(text, $('ecc').value, quietZone));
};
const bcSvg = text => cacheGet(_bcCache, text, () => code128SvgTag(text, {text:false}));

/* 칸을 넘지 않는 최대 글자 크기(mm)를 실제 폰트로 측정해 구한다 → 품번이 길어도 잘리지 않는다 */
const _fitCtx = (()=>{ try{ return document.createElement('canvas').getContext('2d'); }catch(e){ return null; } })();
const _textWidthCache = new Map();
const PXMM = 96/25.4;
/* 글자 크기 1mm 기준 텍스트 폭(mm) — 폭은 글자 크기에 비례하므로 한 번만 재면 된다.
   canvas 를 못 쓰는 환경에서는 한글 1em / 라틴 0.62em 로 추정한다. */
function textW1(text, weight, family){
  const t = String(text || ''); if(!t) return 0;
  const key = `${weight}|${family}|${t}`;
  const cached = _textWidthCache.get(key);
  if(cached !== undefined) return cached;
  let width;
  if(_fitCtx){
    _fitCtx.font = `${weight} ${(10*PXMM).toFixed(2)}px ${family}`;
    width = _fitCtx.measureText(t).width / PXMM / 10;
  } else {
    width = [...t].reduce((sum, char)=> sum + (char.codePointAt(0) > 0x2000 ? 1 : 0.62), 0);
  }
  if(_textWidthCache.size >= 2000) _textWidthCache.clear();
  _textWidthCache.set(key, width);
  return width;
}
/* 칸(availMm)에 들어가는 최대 글자 크기(mm) */
function fitMm(text, availMm, maxMm, minMm, weight, family){
  const w1 = textW1(text, weight, family);
  if(!w1) return maxMm;
  return Math.round(Math.max(minMm, Math.min(maxMm, availMm / w1)) * 10) / 10;
}
/* 한 줄에 넣으면 글자가 너무 작아지는 경우, 단어 단위로 2줄로 나눠 더 큰 글자를 쓴다.
   반환: {fs, lines[]} — 2줄일 때는 줄당 최대 크기(max2)로 제한해 칸 높이를 넘지 않게 한다 */
function fitWrap(text, availMm, max1, max2, minMm, weight, family){
  const t = String(text || '').trim();
  if(!t) return { fs:max1, lines:['-'] };
  const one = fitMm(t, availMm, max1, minMm, weight, family);
  const words = t.split(/\s+/);
  if(one >= max2 || words.length < 2) return { fs:one, lines:[t] };
  let best = null;
  for(let i=1;i<words.length;i++){
    const a = words.slice(0,i).join(' '), b = words.slice(i).join(' ');
    const wa = textW1(a, weight, family), wb = textW1(b, weight, family);
    const fs = Math.max(minMm, Math.min(max2, availMm / Math.max(wa, wb)));
    const gap = Math.abs(wa - wb);                               // 크기가 같으면 두 줄 길이가 고른 쪽
    if(!best || fs > best.fs + 0.05 || (Math.abs(fs - best.fs) <= 0.05 && gap < best.gap))
      best = { fs: Math.round(fs*10)/10, gap, lines:[a,b] };
  }
  return (best && best.fs > one) ? best : { fs:one, lines:[t] };
}
const mlHtml = r => r.lines.map(l=>`<span class="ml">${esc(l)}</span>`).join('');

/* 라벨 본문(헤더·푸터 제외)의 실제 높이 — 여백을 바꾸면 여기부터 달라진다 */
const fmtN = n => Number(n||0).toLocaleString('ko-KR');
const mmv = v => Math.round(v * 100) / 100;      // 인라인 mm 값 정리
const fsv = v => Math.round(v * 10) / 10;
/* 행 높이 h(mm) 안에 n줄을 넣을 때 허용되는 최대 글자 크기
   캡션 1.6 + 캡션 여백 0.5 + 셀 패딩 1.6 + 반올림 여유 0.3 = 4.0mm 를 뺀다 */
const lineCap = (h, n) => Math.max(1.4, (h - 4.0) / (n * 1.12));

const MONO_FF = 'Consolas,"D2Coding",ui-monospace,monospace';
const SANS_FF = '"Malgun Gothic","맑은 고딕",Arial,sans-serif';

/* 라벨 안쪽 폭(mm) — 괘선·패딩을 빼기 전의 기준값 */
const innerWmm = () => Math.max(40, num('lw') - num('pl') - num('pr'));

/* QR이 실제로 인쇄되는 한 변(mm) — CSS 는 칸 안에 여백을 두지 않으므로 괘선만 뺀다 */
function qrPrintSide(type){
  const bw = num('bw');
  if(type === 'loc') return Math.max(4, 34 - bw*2 - 0.4);            // 34mm 칸 − 테두리 − 패딩 0.2mm×2
  if(type === 'bolt' || type === 'mat'){
    const layout = type === 'bolt' ? BOLT_LAYOUT : MAT_LAYOUT;
    return Math.max(4, Math.min(layout.qrW - bw, layout.footerH - bw*2));
  }
  return 4;
}
/* ---------- QR 데이터 규격 ---------- */
function qrUrl(params){
  const base = $('base').value.trim();
  try{
    const url = new URL(base);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value ?? ''));
    return url.toString();
  }catch(error){
    /* 사내 단축주소처럼 브라우저가 절대 URL로 해석하지 못하는 값도 그대로 지원한다. */
  }
  const query = new URLSearchParams(params).toString();
  const hashIndex = base.indexOf('#');
  const path = hashIndex < 0 ? base : base.slice(0, hashIndex);
  const hash = hashIndex < 0 ? '' : base.slice(hashIndex);
  const separator = /[?&]$/.test(path) ? '' : path.includes('?') ? '&' : '?';
  return `${path}${separator}${query}${hash}`;
}
function qrData(it){
  if(it.type==='loc'){
    if($('qmode').value==='ims') return it.code;
    return $('qmode').value==='url'
      ? qrUrl({v:'1', t:'L', l:it.code})
      : `HLR1|L|${it.code}`;
  }
  /* 볼트 QR은 하단의 작은 정사각형 칸을 사용하므로 짧은 사내 코드만 넣는다. */
  if(it.type === 'bolt') return it.pn;
  if($('qmode').value==='ims'){          // LOT-IMS 스캔 탭이 그대로 인식하는 형식
    return it.rev ? `${it.pn} (${it.rev})` : it.pn;
  }
  if($('qmode').value==='url'){
    return qrUrl({v:'1',t:'M',p:it.pn,r:it.rev,b:it.box,q:it.qty,u:it.unit,l:it.loc});
  }
  return ['HLR1',it.pn,it.rev,it.box,it.qty,it.unit,it.loc].join('|');
}

/* 1D 바코드 내용 — [박스 ID]를 고르면 라벨 1장 = 박스 1개의 고유키를 찍는다 */
const barcodeText = it => ($('c128v').value === 'box' ? (it.box || it.pn) : it.pn);
function barcodeHtml(it, plainFs){
  const code = barcodeText(it);
  return $('c128').checked
    ? `<div class="bcbars">${bcSvg(code)}</div><div class="bctext mono">${esc(code)}</div>`
    : `<div class="bctext mono" style="font-size:${plainFs}mm">${esc(code)}</div>`;
}

/* ---------- 라벨 HTML ---------- */
function matLabel(it){
  const logo = $('logoOn').checked ? `<div class="lb-logo">${LOGO_USE}</div>` : '';
  const loc = it.loc
    ? `<div class="loc"><span class="cap">LOC 로케이션</span><span class="v">${esc(it.loc)}</span></div>`
    : `<div class="loc blank"><span class="cap">LOC 로케이션</span><span class="v">&nbsp;</span></div>`;
  const bc = barcodeHtml(it, 3.4);      /* 푸터 높이가 볼트 라벨과 같으므로 문자 크기도 같게 */
  const M  = num('fs') || 1, bw = num('bw');
  /* 시안 순서: 품번/REV → 품명 → 기종/협력사/입고일/BOX ID → QR/1D 바코드 */
  const bodyH  = Math.max(18, num('lh') - num('pt') - num('pb') - MAT_LAYOUT.headerH - MAT_LAYOUT.footerH);
  const pnH    = Math.min(13, Math.max(9.5, bodyH * 0.38));
  const metaH  = Math.min(9, Math.max(7.5, bodyH * 0.27));
  const nmH    = Math.max(5, bodyH - pnH - metaH);
  const innerW = innerWmm();
  /* 칸마다 괘선(bw)과 좌우 패딩(FC_PAD)을 뺀 실제 글자 폭 */
  const pnAvail   = Math.max(20, innerW - bw*3 - MAT_LAYOUT.revW - FC_PAD*2);
  const revAvail  = Math.max(4, MAT_LAYOUT.revW - FC_PAD*2);
  const nmAvail   = Math.max(20, innerW - bw*2 - FC_PAD*2);
  const metaAvail = Math.max(8, (innerW - bw*5)/4 - FC_PAD*2);
  const pnFs   = fsv(Math.min(fitMm(it.pn, pnAvail/M, 6.4, 2.6, 800, MONO_FF), lineCap(pnH, 1)));
  const revFs  = fsv(Math.min(fitMm(it.rev || '-', revAvail/M, 4.5, 2.2, 800, MONO_FF), lineCap(pnH, 1)));
  const nm     = fitWrap(it.nm, nmAvail/M, Math.min(4.2, lineCap(nmH,1)), Math.min(3.2, lineCap(nmH,2)), 1.7, 700, SANS_FF);
  nm.fs = fsv(nm.fs);
  const meta = [
    ['기종 <i>PJT</i>', it.pj || '-', SANS_FF],
    ['협력사', it.vd || '-', SANS_FF],
    ['입고일', it.dt || '-', MONO_FF],
    ['BOX ID <i>박스번호</i>', it.box || '-', MONO_FF]
  ].map(([cap,val,ff])=>({cap, val, ff, fs:fsv(Math.min(fitMm(val, metaAvail/M, 2.5, 1.45, 700, ff), lineCap(metaH,1)))}));

  return `<div class="label matmode">${frameHtml()}
    <div class="lb-head" style="height:${MAT_LAYOUT.headerH}mm">${logo}<span class="gap"></span>${loc}</div>
    <div class="lb-body">
      <div class="fields">
        <div class="fr r-pn" style="height:${mmv(pnH)}mm">
          <div class="fc w-pn"><span class="cap">품번 <i>PART NO.</i></span>
            <span class="v-xl mono nowrap" style="font-size:calc(${pnFs}mm * var(--fs,1))">${esc(it.pn)}</span></div>
          <div class="fc w-rev"><span class="cap">REV</span><span class="v-lg mono nowrap" style="font-size:calc(${revFs}mm * var(--fs,1))">${esc(it.rev||'-')}</span></div>
        </div>
        <div class="fr r-nm" style="height:${mmv(nmH)}mm">
          <div class="fc"><span class="cap">품명 <i>DESCRIPTION</i></span>
            <span class="v-ml" style="font-size:calc(${nm.fs}mm * var(--fs,1));font-weight:700">${mlHtml(nm)}</span></div>
        </div>
        <div class="fr r-mat-meta" style="height:${mmv(metaH)}mm">
          ${meta.map(({cap,val,ff,fs})=>`<div class="fc w-mat-meta"><span class="cap">${cap}</span>`
            + `<span class="v-sm nowrap" style="font-family:${ff};font-size:calc(${fs}mm * var(--fs,1))">${esc(val)}</span></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="lb-foot" style="height:${MAT_LAYOUT.footerH}mm">
      <div class="mat-foot-qr">${qrSvg(qrData(it), 2)}</div><div class="bcbox">${bc}</div></div>
  </div>`;
}
/* "A / B" 또는 줄바꿈으로 구분된 여러 항목 → 최대 3줄. 쉼표는 이름의 일부로 유지한다
   (BOM 표기 "BRACKET, MOTOR"를 두 곳으로 잘못 쪼개지 않기 위함) */
const splitMulti = s => String(s||'').split(/\r?\n|\s*\/\s*/).map(x=>x.trim()).filter(Boolean);

/* "이름 : 개수" 형태를 파싱해 항목마다 한 줄로 인쇄하고 개수를 오른쪽 정렬한다. */
function applyCell(text, availMm, M, rowH){
  const parts = splitMulti(text).map(x=>{
    const m = x.match(/^(.*?)\s*[:=]\s*([\d,]+)\s*(?:개|EA|ea)?$/);
    return m ? { t:m[1].trim(), q:m[2].replace(/,/g,'') } : { t:x, q:'' };
  });
  if(!parts.length) return { n:1, fs:2.4, count:0, total:0, html:'<span class="ml"><span class="mt">-</span></span>' };
  /* 입력 안내와 같은 최대 3줄. 초과 시 마지막 줄에 남은 곳의 수와 합계를 명시하되 '/'로 합치지 않는다. */
  const hidden = Math.max(0, parts.length - 3);
  const lines = hidden
    ? parts.slice(0,2).concat([{t:`… 외 ${hidden+1}곳`, q:String(parts.slice(2).reduce((a,o)=>a+(Number(o.q)||0),0))}])
    : parts;
  const n = lines.length;
  const verticalCap = Math.max(1.45, (rowH - 2.6) / (n * 1.15));
  const cap = Math.min(n===1 ? 2.6 : n===2 ? 2.3 : 1.7, verticalCap);
  /* 개수 칸은 실제 폭(가장 긴 "24개")만 차지하게 해서 이름에 폭을 몰아준다 */
  const qW = lines.reduce((a,o)=> Math.max(a, o.q ? textW1(o.q + '개', 800, MONO_FF) : 0), 0);
  const wMax = lines.reduce((a,o)=> Math.max(a, textW1(o.t, 600, SANS_FF)), 0.1);
  const fs = fsv(Math.max(n===3 ? 1.45 : 1.55, Math.min(cap, (availMm/M - (qW ? qW*cap + 1.0 : 0)) / wMax)));
  return { n, fs, count: parts.length, total: parts.reduce((a,o)=> a + (Number(o.q)||0), 0),
    html: lines.map(o=>`<span class="ml"><span class="mt">${esc(o.t)}</span>`
      + (o.q ? `<span class="mq mono">${esc(o.q)}개</span>` : '') + '</span>').join('') };
}

/* 볼트류 라벨 — 규격·강도 / 머리 형상 도면 / 1:1 측면 대조 / 적용 제품·위치(줄별 개수)
   M8×20 과 M8×30 혼입이 파스너 관리의 대표 사고이므로
   ① 규격을 최대 크기로 ② 실물을 라벨에 올려 맞추는 1:1 측면 도면 두 단계로 막는다. */
function boltLabel(it){
  const M = num('fs') || 1, bw = num('bw');
  const logo = $('logoOn').checked ? `<div class="lb-logo">${LOGO_USE}</div>` : '';
  const bc = barcodeHtml(it, 3.4);

  /* 머리 도면 — 저장된 치수(수정 가능), 없으면 나사 지름에서 근사 */
  const d  = threadD(it.dia);
  const dk = Number(it.dk) || d*1.6, k = (it.k === '' || it.k == null) ? d : Number(it.k);
  /* 표준표에 없는 규격이고 추정값을 그대로 쓰는 중이면 치수 앞에 ≈ 를 붙여 실측이 필요함을 알린다 */
  const std = headDims(it.head, it.dia);
  const dimMark = (std.approx && n2(dk) === std.dk && n2(k) === std.k) ? '≈' : '';

  /* 행 높이 — 규격 행과 도면 행을 고정해 라벨마다 시인성을 일정하게 한다.
     측면도는 축소하지 않는다(반단면 + 필요 시 상단 크롭으로 칸에 맞춘다). */
  const footH  = BOLT_LAYOUT.footerH;
  const bodyH  = Math.max(20, num('lh') - num('pt') - num('pb') - BOLT_LAYOUT.headerH - footH);
  const heroH  = BOLT_LAYOUT.heroH;
  const shapeH = BOLT_LAYOUT.shapeH;
  const apH    = Math.max(4.8, bodyH - heroH - shapeH);
  const innerW = innerWmm();

  const specAvail  = Math.max(20, innerW - bw*3 - BOLT_LAYOUT.gradeW - FC_PAD*2);
  const gradeAvail = Math.max(4, BOLT_LAYOUT.gradeW - FC_PAD*2);
  const spec = `${it.dia} × ${it.len}`;
  const spFs = fsv(Math.min(fitMm(spec, specAvail/M, 11.5, 4, 800, MONO_FF), lineCap(heroH, 1)));
  const grFs = fsv(Math.min(fitMm(it.grade, gradeAvail/M, 3.4, 2.2, 800, MONO_FF), lineCap(heroH, 1)));

  /* 도면 칸의 실제 높이 = 행 높이 − 행 괘선 − .fc 상하 패딩(0.8mm×2) */
  const dwgH = Math.max(3, shapeH - 1.6 - bw);
  const side = boltSideSvg(it.head, dk, k, d, Number(it.len)||0, it.dia, BOLT_LAYOUT.sideW, dwgH);

  const apAvail = Math.max(15, (innerW - bw*3)/2 - FC_PAD*2);
  const pr = applyCell(it.cat ? splitMulti(it.prod).map(x=>x+' · '+it.cat).join('\n') : it.prod, apAvail, M, apH);
  const po = applyCell(it.pos, apAvail, M, apH);

  return `<div class="label boltmode">${frameHtml()}
    <div class="lb-head" style="height:${BOLT_LAYOUT.headerH}mm">${logo}</div>
    <div class="lb-body">
      <div class="fields">
        <div class="fr r-hero" style="height:${mmv(heroH)}mm">
          <div class="fc w-spec"><span class="cap">규격 <i>SIZE</i></span>
            <span class="bl-spec mono nowrap" style="font-size:calc(${spFs}mm * var(--fs,1))">${esc(spec)}</span></div>
          <div class="fc w-grade"><span class="cap">강도</span>
            <span class="bl-grade mono nowrap" style="font-size:calc(${grFs}mm * var(--fs,1))">${esc(it.grade)}</span></div>
        </div>
        <div class="fr r-shape" style="height:${mmv(shapeH)}mm">
          <div class="fc w-top"><div class="dwg top">${headTopSvg(it.head)}</div></div>
          <div class="fc w-side"><div class="bolt-side-art" style="width:${side.w}mm;height:${side.h}mm">${side.svg}</div></div>
          <div class="fc w-hm">
            <span class="hm"><b>머리</b> ${esc(HEAD_LABEL[it.head] || it.head)}</span>
            <span class="hm"><b>재질</b> ${esc(it.mat||'-')}</span>
            <span class="hm mono">${dimMark}Ø${mmv(dk)} × ${mmv(k)}</span></div>
        </div>
        <div class="fr r-ap" style="height:${mmv(apH)}mm">
          <div class="fc w-ap"><span class="cap">적용 제품${pr.count>1?` <i>${pr.count}종</i>`:''}</span>
            <span class="v-ap" style="font-size:calc(${pr.fs}mm * var(--fs,1))">${pr.html}</span></div>
          <div class="fc w-ap"><span class="cap">적용 위치${po.count>1?` <i>${po.count}곳</i>`:''}${po.total?` · 계 ${fmtN(po.total)}개`:''}</span>
            <span class="v-ap" style="font-size:calc(${po.fs}mm * var(--fs,1))">${po.html}</span></div>
        </div>
      </div>
    </div>
    <div class="lb-foot" style="height:${mmv(footH)}mm">
      <div class="bolt-foot-qr">${qrSvg(qrData(it), 2)}</div><div class="bcbox">${bc}</div></div>
  </div>`;
}

function locLabel(it){
  const logo = $('logoOn').checked ? `<div class="lm-logo">${LOGO_USE}</div>` : '<span></span>';
  return `<div class="label locmode">${frameHtml()}
    <div class="lm-top">
      <div class="lm-qr">${qrSvg(qrData(it))}</div>
      <div class="lm-txt"><div class="v mono nowrap">${esc(it.code)}</div><div class="d nowrap">${esc(it.desc||'')}</div></div>
    </div>
    <div class="lm-foot">${logo}<span class="t">LOCATION</span></div>
  </div>`;
}

const labelOf = it => it.type==='loc' ? locLabel(it) : it.type==='bolt' ? boltLabel(it) : matLabel(it);
const frameHtml = () => $('marks').checked ? '<div class="frame"></div>' : '';
