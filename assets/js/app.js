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

/* ---------- 제품 개략도 이미지 ----------
   서버가 없으므로 로컬 파일을 브라우저에서 읽어 데이터 URL 로 라벨에 직접 넣는다.
   매칭을 두 갈래로 걸어 스크린샷 파일 이름을 바꾸지 않아도 되게 한다:
     ① 파일명이 "품번_스크린샷 ….png" 형태면 선두 토큰(품번)으로
     ② 관리대장의 [제품개략도 파일명] 열과 파일명이 같으면 (원본 이름 그대로인 폴더)
   조회 키가 품번이므로 같은 품번의 박스 라벨 수백 장이 데이터 URL 문자열 하나를 공유한다. */
const imageByPn = new Map();       // 정규화 품번 → 데이터 URL (파일명에 품번이 붙은 경우)
const imageByName = new Map();     // 파일명(소문자) → 데이터 URL
const imageNameByPn = new Map();   // 정규화 품번 → 관리대장에 적힌 개략도 파일명
const normPn = value => String(value || '').trim().toUpperCase();
function imageFor(it){
  if(it.img) return it.img;                                   // 수동 첨부가 폴더 매칭보다 우선
  const key = normPn(it.pn);
  /* 관리대장이 파일명을 지정했다면 그것이 먼저다 — 표에 적힌 짝은 사람이 정한 값이고,
     파일명 접두어 매칭은 이름 규칙에서 유추한 값이다. */
  const named = imageNameByPn.get(key);
  const byName = named && imageByName.get(named.trim().toLowerCase());
  return byName || imageByPn.get(key) || '';
}
/* 파일 하나를 두세 가지 키로 걸어 둔다 — 이름 그대로, "품번_" 접두어를 뗀 나머지, 확장자 뺀 전체.
   관리대장에는 접두어 없는 원본 이름이 적혀 있어서, 파일을 정리해 이름을 바꾼 폴더도 매칭된다.
   먼저 들어온 파일이 이긴다 — 파일을 이름순으로 처리하므로 결과가 매번 같다. */
function addImageFile(name, url){
  const put = (map, key) => { if(key && !map.has(key)) map.set(key, url); };
  const stem = name.replace(/\.[^.]+$/, '');
  put(imageByName, name.trim().toLowerCase());
  const cut = stem.indexOf('_');
  if(cut > 0){
    put(imageByPn, normPn(stem.slice(0, cut)));
    put(imageByName, name.slice(cut + 1).trim().toLowerCase());   // 접두어를 뗀 원본 파일명
  }
  put(imageByPn, normPn(stem));                                   // 파일명이 품번 그 자체인 경우
}
/* 인쇄 칸이 34mm(300dpi ≈ 400px)라 원본 스크린샷(수 MB)을 그대로 담을 이유가 없다.
   400장을 한 번에 그리고 인쇄해야 하므로 긴 변 700px 로 줄여 담는다.
   개략도는 선과 글자로 된 그림이라 JPEG 로 뭉개면 얇은 선이 번진다 — PNG 를 먼저 쓰고,
   사진처럼 커지는 경우에만 JPEG 로 떨어뜨린다. */
const IMG_MAX_EDGE = 700;
const IMG_PNG_MAX = 500 * 1024;
const IMG_RAW_MAX = 3 * 1024 * 1024;
/* 원본을 인쇄 크기에 맞게 줄인다 — 실패하면 던진다(부르는 쪽이 원본으로 되돌린다).
   줄이는 것은 400장 인쇄를 위한 것이지 그림을 띄우는 데 꼭 필요한 일은 아니다. */
function shrinkToDataUrl(image){
  const ratio = Math.min(1, IMG_MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  const ctx = canvas.getContext('2d');
  if(!ctx) throw new Error('canvas 를 쓸 수 없습니다.');
  /* 투명 배경을 흰색으로 깔아둔다 — 라벨은 흰 유포지에 흑백 1색으로 인쇄된다 */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  return png.length <= IMG_PNG_MAX ? png : canvas.toDataURL('image/jpeg', 0.92);
}
/* 윈도우가 파일 형식을 비워서 넘기는 경우가 있다(확장자 연결이 깨진 PC 에서 흔하다).
   그대로 데이터 URL 을 만들면 data:application/octet-stream 이 되고, 그러면 확장자가 .png 라도
   <img> 가 "이미지가 아니다"라며 거부한다. 그래서 형식이 비면 확장자로 채워 넣는다. */
const IMG_TYPE_BY_EXT = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
  gif:'image/gif', webp:'image/webp', bmp:'image/bmp' };
function imageBlob(file){
  if(/^image\//.test(file.type)) return file;
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  return new Blob([file], { type: IMG_TYPE_BY_EXT[ext] || 'image/png' });
}
/* 실패했을 때 무엇이 문제였는지 알 수 있게 브라우저가 본 형식·크기를 함께 남긴다 */
const fileNote = file => `(형식 ${file.type || '없음'} · ${Math.round((file.size || 0)/1024)}KB)`;
function loadImage(blob, file){
  return new Promise((resolve, reject) => {
    /* 데이터 URL 대신 objectURL 로 디코딩한다 — 파일을 통째로 base64 로 부풀리지 않고,
       선언된 형식이 이상해도 blob 의 형식을 우리가 정해 줄 수 있다. */
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const done = fn => (...args) => { URL.revokeObjectURL(url); fn(...args); };
    image.onload = done(() => resolve(image));
    image.onerror = done(() => reject(new Error(`${file.name} 을(를) 이미지로 열지 못했습니다 ${fileNote(file)}.`)));
    image.src = url;
  });
}
function blobToDataUrl(blob, file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} 을(를) 읽을 수 없습니다 ${fileNote(file)}.`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
async function fileToDataUrl(file){
  const blob = imageBlob(file);
  const image = await loadImage(blob, file);
  if(!image.width || !image.height)
    throw new Error(`${file.name} 의 크기를 읽지 못했습니다 ${fileNote(file)}.`);
  try{
    return shrinkToDataUrl(image);
  }catch(error){
    /* 캔버스를 못 쓰는 환경 — 줄이지 못할 뿐이므로 원본을 그대로 담는다 */
    const raw = await blobToDataUrl(blob, file);
    if(raw.length > IMG_RAW_MAX)
      throw new Error(`${file.name} 을(를) 줄이지 못했고 원본이 너무 큽니다 — 캡처를 작게 잘라 주세요.`);
    return raw;
  }
}
let matImageDataUrl = '';          // 수동 첨부 — 다음 [목록에 추가] 부터 라벨에 붙는다
function renderMatImgPreview(name){
  $('matImgPreview').innerHTML = matImageDataUrl
    ? `<img src="${matImageDataUrl}" alt=""><span>${esc(name || '첨부됨')}</span>`
      + '<button type="button" onclick="clearMatImage()">제거</button>'
    : '';
}
function clearMatImage(){
  matImageDataUrl = '';
  $('matImg').value = '';
  renderMatImgPreview();
}
async function onMatImagePicked(event){
  const file = event.target.files[0];
  if(!file){ clearMatImage(); return; }
  try{ matImageDataUrl = await fileToDataUrl(file); }
  catch(error){ matImageDataUrl = ''; alert(error.message); }
  event.target.value = '';                 // 같은 파일을 고쳐 저장한 뒤 다시 골라도 반영되도록
  renderMatImgPreview(file.name);
}
/* 폴더는 붙여넣기 전·후 아무 때나 불러도 된다 — imageFor() 가 그릴 때 조회하므로 순서가 무관하다 */
let folderLoading = false;
async function onImageFolderPicked(event){
  const input = event.target;
  const files = [...input.files]
    .filter(file => /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));       // 같은 품번이 둘이면 결과가 매번 같게
  const info = $('imgFolderInfo');
  if(!files.length){ info.textContent = '이미지 파일을 찾지 못했습니다.'; input.value = ''; return; }
  if(folderLoading){ info.textContent = '앞서 고른 폴더를 아직 읽는 중입니다. 끝난 뒤 다시 눌러주세요.'; return; }
  folderLoading = true;
  /* 폴더를 새로 고르면 이전 폴더의 매칭은 버린다 — 폴더에서 지운 파일이 남아 있으면
     라벨에 없는 개략도가 인쇄된다. 관리대장에서 읽은 파일명은 표에서 온 값이라 남긴다. */
  imageByPn.clear();
  imageByName.clear();
  let loaded = 0, failed = 0, firstError = '';
  /* 한꺼번에 다 읽으면 원본(수 MB×장수)이 동시에 메모리에 올라와 탭이 멈춘다 — 조금씩 끊어 읽는다 */
  const LOAD_AT_ONCE = 4;
  try{
    for(let i = 0; i < files.length; i += LOAD_AT_ONCE){
      const chunk = files.slice(i, i + LOAD_AT_ONCE);
      info.textContent = `이미지 ${i}/${files.length}개 읽는 중…`;
      await Promise.all(chunk.map(async file => {
        let url;
        try{ url = await fileToDataUrl(file); }
        catch(error){                                     // 깨진 파일 한 장이 폴더를 막지 않는다
          failed++;
          if(!firstError) firstError = error.message;     // 왜 실패했는지 화면에도 남긴다
          console.warn(error.message);
          return;
        }
        loaded++;
        addImageFile(file.name, url);
      }));
    }
  } finally {
    folderLoading = false;
    /* 파일을 다 읽은 뒤에 비운다 — 읽기 전에 비우면 브라우저가 방금 고른 파일 목록을 놓아버려
       한 장도 못 읽는다. 비우는 목적은 같은 폴더를 다시 골라도 change 가 뜨게 하는 것뿐이다. */
    input.value = '';
  }
  const matched = items.filter(it => it.form === 'img' && imageFor(it)).length;
  const why = firstError ? ` — 첫 실패 사유: ${esc(firstError)}` : '';
  info.innerHTML = loaded
    ? `이미지 <b>${loaded}개</b> 불러왔습니다`
      + (failed ? ` · <b>${failed}개는 읽지 못했습니다</b>${why}` : '')
      + (items.length ? ` · 지금 목록에서 <b>${matched}/${items.length}장</b>에 붙었습니다.` : '.')
    : `<b style="color:#b32020">이미지를 하나도 읽지 못했습니다</b> (${failed}개 실패)${why}`;
  renderAll();
}

/* 엑셀 파일을 고르면 첫 번째 시트를 읽어 붙여넣기 칸을 채운다 — 곧바로 발행하지 않는 이유는
   라벨 한 장이 박스 ID 하나를 소비하기 때문이다. 무엇이 들어왔는지 보고 [CSV 추가]를 누른다. */
async function onSheetFilePicked(event){
  const file = event.target.files[0];
  const info = $('sheetFileInfo');
  event.target.value = '';                 // 같은 파일을 고쳐 저장한 뒤 다시 골라도 반영되도록
  if(!file) return;
  info.textContent = `${file.name} 읽는 중…`;
  let text;
  try{ text = await readSheetFile(file); }
  catch(error){ info.innerHTML = `<b style="color:#b32020">${esc(error.message)}</b>`; return; }
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if(!lines.length){ info.innerHTML = '<b style="color:#b32020">시트에 내용이 없습니다.</b>'; return; }
  $('csv').value = text;
  info.innerHTML = `<b>${esc(file.name)}</b> · ${lines.length}줄을 읽었습니다`
    + ' — 아래 내용을 확인하고 <b>[CSV 추가]</b>를 누르세요.';
}

/* ---------- 목록 ---------- */
/* 주소에 스킴이 없으면 붙인다 — "intra/check" 만 적힌 QR 은 휴대폰 카메라가
   링크로 인식하지 못해 라벨이 통째로 무용지물이 된다. */
const normalizeUrl = value => {
  const text = String(value || '').trim();
  if(!text) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text;
};
function addLabels(){
  if($('mode').value==='link'){
    const bulk = $('kbulk').value.trim();
    const parsed = [];
    try{
      if(bulk){
        bulk.split(/\r?\n/).filter(Boolean).forEach((line, index) => {
          const cells = splitCells(line);
          const name = (cells[0] || '').trim();
          /* 주소는 마지막 열이지만 쿼리에 쉼표가 들어갈 수 있으므로 3번째부터 다시 이어 붙인다 */
          const url = normalizeUrl(cells.slice(2).join(',').trim() || cells[1] || '');
          if(!url) throw new Error(`${index + 1}번째 줄에 주소가 없습니다. 형식: 링크명,설명,주소`);
          /* 일괄 생성은 한 줄이 라벨 하나라 Enter 를 쓸 수 없다 — | 를 줄바꿈으로 받는다 */
          const desc = (cells.length > 2 ? cells[1] : '').trim().replace(/\s*\|\s*/g, '\n');
          parsed.push({type:'link', name:name.replace(/\s*\|\s*/g, '\n'), desc, url});
        });
      } else {
        const url = normalizeUrl($('kurl').value);
        if(!url) throw new Error('링크 주소(URL)를 입력하세요.');
        parsed.push({type:'link', name:$('kname').value.trim(), desc:$('kdesc').value.trim(), url});
      }
    }catch(error){ alert(error.message); return; }
    const take = capWarn(parsed.length);
    if(!take) return;
    items.push(...parsed.slice(0, take));
    renderAll(); return;
  }
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
    const kind = formWasherKind();                 // 머리 형상 칸이 워셔면 두 칸의 뜻이 달라진다
    const head = kind ? '' : normalizeBoltHead($('bHead').value);
    const dia = normalizeThreadDia($('bDia').value);
    const length = Number.parseFloat($('bLen').value);   // 볼트=길이 L · 워셔=두께 T
    const dk = Number.parseFloat($('bDk').value);        // 볼트=머리 지름 dk · 워셔=외경 d2
    const k = Number.parseFloat($('bK').value);          // 볼트=머리 높이 k · 워셔=내경 d1
    if(!kind && !head){ alert('지원하는 볼트 머리 형상을 선택하세요.'); return; }
    if(!dia){ alert('직경을 M8 또는 8 형식의 양수로 입력하세요.'); return; }
    if(!Number.isFinite(length) || length <= 0){
      alert(kind ? '워셔 두께를 0보다 큰 숫자로 입력하세요.' : '볼트 길이를 0보다 큰 숫자로 입력하세요.'); return;
    }
    if(kind){
      if(!Number.isFinite(dk) || !Number.isFinite(k) || k <= 0 || dk <= k){
        alert('워셔 외경은 내경보다 크게, 내경은 0보다 크게 입력하세요.'); return;
      }
    } else if(!Number.isFinite(dk) || dk <= 0 || !Number.isFinite(k) || k < 0){
      alert('머리 지름은 0보다 크게, 머리 높이는 0 이상으로 입력하세요.'); return;
    }
    $('bDia').value = dia;
    if(!$('bCode').value.trim()) updateBoltCode();
    const bn = capWarn(Math.max(1, parseInt($('bN').value)||1));
    if(!bn) return;
    let bseq = startSeq();
    for(let i=0;i<bn;i++,bseq++){
      const common = { type:'bolt', pn:$('bCode').value.trim(), rev:'', dia,
        mat:$('bMat').value.trim(), prod:$('bProd').value.trim(), cat:$('bCat').value.trim(),
        pos:$('bPos').value.trim(), perBot:$('bPerBot').value.trim(), box:nextBox(bseq) };
      items.push(kind
        ? { ...common, form:'washer', kind, d2:String(dk), d1:String(k), thk:String(length), approx:false }
        : { ...common, form:'bolt', head, len:String(length),
            drive: head === 'FLAT' ? $('bDrive').value : (DRIVE_OF_HEAD[head] || ''),
            grade:$('bGrade').value, dk:String(dk), k:String(k) });
    }
    commitSeq(bseq - 1);
    restoreSeq(bseq);
    renderAll(); return;
  }
  if(!$('pn').value.trim()){ alert('품번을 입력하세요.'); return; }
  const n = capWarn(Math.max(1, parseInt($('bn').value)||1));
  if(!n) return;
  /* 이미지 종류도 type 은 'mat' 이다 — form 하위 필드로만 가른다(워셔와 같은 방식).
     새 type 을 만들면 QR 진단·CSS 변수 주입·목록 요약에 분기가 전부 늘어난다. */
  const imgMode = $('mode').value === 'matimg';
  let seq = startSeq();
  for(let i=0;i<n;i++,seq++){
    items.push({type:'mat',pn:$('pn').value.trim(),rev:$('rev').value.trim(),nm:$('nm').value.trim(),
      pj:$('pj').value.trim(),qty:$('qty').value.trim(),unit:$('unit').value,
      vd:$('vd').value.trim(),dt:$('dt').value,loc:$('loc').value.trim(),box:nextBox(seq),
      ...(imgMode ? { form:'img', ...(matImageDataUrl ? { img:matImageDataUrl } : {}) } : {})});
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
function importCsv(){
  const lines = $('csv').value.trim().split(/\r?\n/).filter(Boolean);
  if(!lines.length){ alert('붙여넣은 내용이 없습니다.'); return; }
  let table;
  try{ table = lines.map(splitCells); }
  catch(error){ alert(error.message); return; }

  /* 볼트 표 붙여넣기 — 적용제품,대분류,적용위치,머리,직경,길이,ASSY당,ASSY개수,1대당,재질,강도(선택)
     같은 표에 워셔가 섞여 들어오므로 행마다 볼트/워셔를 갈라 읽는다 (parseFastenerRow). */
  if($('mode').value==='bolt'){
    const defaults = { grade:$('bGrade').value, mat:$('bMat').value.trim() };
    const rows = [];
    let invalidRows = 0;
    table.forEach(c=>{
      const first = String(c[0] || '').replace(/^\uFEFF/, '').trim();
      const diaCell = String(c[4] || '').trim();
      if(/^(적용\s*제품|product)$/i.test(first) || /^(직경|dia(?:meter)?)$/i.test(diaCell)) return;
      const row = parseFastenerRow(c, defaults);
      if(!row){ invalidRows++; return; }
      rows.push(row);
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
        /* 워셔는 볼트와 키 체계가 달라(길이·강도가 없다) form 을 키 맨 앞에 둔다 —
           빼면 M10 볼트와 M10 워셔가 빈 칸끼리 맞아떨어져 한 라벨로 합쳐진다. */
        const key = r.form === 'washer'
          ? ['W', r.kind, r.dia, r.t, r.mat].join('|')
          : ['B', r.head, r.drive, r.dia, r.len, r.mat, r.grade].join('|');
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
      const common = { type:'bolt', rev:'', mat:r.mat, prod:r.prod, cat:r.cat, pos:r.pos,
        perBot:(r.perBot || '') + '', box:nextBox(seq++) };
      if(r.form === 'washer'){
        items.push({ ...common, form:'washer', pn:washerCode(r.kind, r.dia, r.t),
          kind:r.kind, dia:r.dia, d1:String(r.d1), d2:String(r.d2), thk:String(r.t), approx:r.approx });
        return;
      }
      const dim = headDims(r.head, r.dia);
      items.push({ ...common, form:'bolt', pn:boltCode(r.head, r.dia, r.len, r.grade),
        head:r.head, drive:r.drive, dia:r.dia, len:r.len, grade:r.grade,
        dk:String(dim.dk), k:String(dim.k) });
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
  /* 붙여넣은 표의 헤더 자동 인식 — 부품 관리대장은 열이 20개가 넘고 앞으로 더 붙을 수 있어
     위치 기반 매핑이 바로 어긋난다. 그래서 열 번호를 헤더 이름으로 찾는다.
     LOT-IMS 재고현황 CSV(품번/리비전/품명/제품군/…)는 지금처럼 위치로 읽는다. */
  const stripBom = value => {
    const text = String(value ?? '');
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  };
  const headerCells = (table[0] || []).map(cell => stripBom(cell).trim());
  /* 열 이름은 시트마다 조금씩 다르게 적힌다(이름/품명, Product/기종…). 흔한 표기를 함께 받되
     못 찾은 열은 아래에서 알린다 — 조용히 비우면 품명 없는 라벨이 수백 장 인쇄된다. */
  const col = (...names) => headerCells.findIndex(h => names.includes(h.replace(/\s+/g, '').toUpperCase()));
  const ledger = { pn:col('품번','PARTNO','PARTNO.'), rev:col('REVISION','REV','리비전'),
    nm:col('이름','품명','NAME','DESCRIPTION'), pj:col('PRODUCT','제품','기종','제품군'),
    qty:col('재고수량','현재고','수량'), loc:col('재고위치','보관위치','로케이션'),
    vd:col('업체명','협력사'), img:col('제품개략도파일명','개략도파일명') };
  const head = (table[0] || []).join('|').replace(/^\uFEFF/,'');
  if(/제품개략도/.test(head) && ledger.pn >= 0){
    const at = (cells, index) => index >= 0 ? String(cells[index] ?? '').trim() : '';
    const missing = [['품명(이름)','nm'], ['기종(Product)','pj'], ['제품개략도 파일명','img']]
      .filter(([, key]) => ledger[key] < 0).map(([label]) => label);
    if(missing.length) alert(`관리대장에서 다음 열을 찾지 못해 비워 둡니다 — 헤더 이름을 확인하세요.\n\n${missing.join('\n')}`);
    table = table.slice(1).map(c=>{
      const pn = at(c, ledger.pn), imgName = at(c, ledger.img);
      /* 개략도 파일명을 기억해 두면 스크린샷을 원본 이름 그대로 둔 폴더에서도 매칭된다 */
      if(pn && imgName) imageNameByPn.set(normPn(pn), imgName);
      //       품번 Rev              품명             규격 기종(Product)  수량(재고수량)   단위  로케이션(재고위치) 협력사(업체명)  박스수
      return [pn, at(c, ledger.rev), at(c, ledger.nm), '', at(c, ledger.pj), at(c, ledger.qty), 'EA', at(c, ledger.loc), at(c, ledger.vd), '1'];
    });
  } else if(/품번/.test(head) && /제품군/.test(head)){          // LOT-IMS 재고현황 CSV
    table = table.slice(1).map(c=>{
      //       품번   Rev     품명     규격 기종(제품군) 수량(현재고) 단위      로케이션  협력사 박스수
      return [c[0], c[1]||'', c[2]||'', '', c[3]||'', c[5]||'', c[4]||'EA', c[8]||'', '', '1'];
    });
  }
  const imgMode = $('mode').value === 'matimg';
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
        unit:c[6]||'EA',loc:c[7]||'',vd:c[8]||'',dt:$('dt').value,box:nextBox(seq),
        ...(imgMode ? {form:'img'} : {})});
    }
  });
  commitSeq(seq - 1);
  restoreSeq(seq);
  $('csv').value=''; renderAll();
  if(stop) alert(`목록 상한(${MAX_LABELS}장)에 도달해 일부만 추가했습니다.`);
}
/* 이미지 라벨에는 <img> 가 붙는다 — QR·바코드 SVG 와 달리 그림은 붙자마자 그려지지 않으므로,
   그리는 즉시 인쇄하면 아직 안 올라온 칸이 빈 채로 찍힌다. 그래서 인쇄 전에 기다린다.
   한 장이라도 영영 안 올라오면 인쇄 자체가 막히므로 상한을 둔다. */
function whenImagesReady(root, timeoutMs = 15000){
  /* 글꼴도 함께 기다린다 — 아직 안 올라온 글꼴로 인쇄되면 칸에 맞춰 계산한 글자 크기가
     실제 인쇄와 어긋난다(품번이 칸을 넘거나 남는다). */
  const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  const pending = [...root.querySelectorAll('img')].filter(img => !img.complete);
  const settle = img => new Promise(resolve => {
    img.addEventListener('load', resolve, { once:true });
    img.addEventListener('error', resolve, { once:true });
  });
  return Promise.race([
    Promise.all([fonts, ...pending.map(settle)]),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
}
/* 인쇄가 끝날 때까지 기다린다. window.print() 가 돌아온 시점은 인쇄가 끝난 시점이 아니라서,
   곧바로 화면을 미리보기(50장)로 되돌리면 브라우저가 인쇄 작업을 다 만들기 전에 라벨이 사라진다.
   afterprint 를 기다리되, 대화상자를 열어둔 채 두는 경우가 있으므로 상한을 둔다. */
function printAndWait(){
  return new Promise(resolve => {
    let settled = false, timer = 0;
    const finish = () => {
      if(settled) return;
      settled = true;
      clearTimeout(timer);                // 남겨두면 인쇄가 끝난 뒤에도 타이머가 계속 살아 있다
      window.removeEventListener('afterprint', finish);
      resolve();
    };
    window.addEventListener('afterprint', finish);
    timer = setTimeout(finish, 5 * 60 * 1000);   // 대화상자를 열어둔 채 둬도 영영 매달리지 않게
    try{ window.print(); }
    catch(error){ finish(); }
  });
}
const wait = seconds => new Promise(resolve => setTimeout(resolve, Math.max(0, seconds) * 1000));

/* 프린터가 급지를 못 따라오면 라벨이 밀린다. 프린터의 인쇄 속도 자체는 드라이버 설정이라
   웹페이지가 바꿀 수 없지만, 한 번에 보내는 양은 나눌 수 있다 — 묶음 사이에 프린터가
   용지 위치를 다시 잡는다. 0이면 지금까지처럼 한 번에 보낸다. */
async function doPrint(){
  if(!items.length){ alert('인쇄할 라벨이 없습니다. 정보를 입력하고 [목록에 추가]를 누르세요.'); return; }
  const size = Math.max(0, Math.min(MAX_LABELS, parseInt($('batch').value) || 0));
  const gap = Math.max(0, Number.parseFloat($('batchWait').value) || 0);
  const all = items;
  const batches = [];
  for(let i = 0; i < all.length; i += (size || all.length)) batches.push(all.slice(i, i + (size || all.length)));
  try{
    for(let i = 0; i < batches.length; i++){
      /* 묶음만 그려서 보낸다 — items 를 잠시 바꿔 renderAll 을 그대로 쓴다(복구는 finally) */
      items = batches[i];
      renderAll(true);                    // 인쇄할 때만 전체 장수를 그린다
      await whenImagesReady($('prev'));
      await printAndWait();
      if(i + 1 < batches.length){
        $('cnt').textContent = `${i + 1}/${batches.length}묶음 인쇄함 · 다음 묶음 준비 중…`;
        await wait(gap);
      }
    }
  } finally {
    items = all;
    renderAll();
  }
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
    if(it.type === 'link') return `${it.desc ? it.desc + ' · ' : ''}${it.url}`;
    if(it.type === 'loc') return it.desc || '';
    if(it.type === 'bolt'){
      const positions = splitMulti(it.pos).length;
      const spot = positions > 1 ? ` · 적용 ${positions}곳` : '';
      if(it.form === 'washer')
        return `${WASHER_LABEL[it.kind] || '와셔'} ${it.dia} T${it.thk} · ${it.mat}` + spot;
      return `${HEAD_LABEL[it.head] || it.head} ${it.dia}×${it.len} ${it.grade} · ${it.mat}` + spot;
    }
    const mat = `${it.nm} · ${it.qty}${it.unit} · ${it.box} · ${it.loc||'로케이션 수기'}`;
    /* 이미지 종류는 매칭 실패를 인쇄 전에 잡아야 한다 — 라벨에도 같은 문구가 찍힌다 */
    return it.form === 'img' && !imageFor(it) ? `${mat} · 이미지 미첨부` : mat;
  };
  const title = it => it.type==='loc' ? it.code : it.type==='link' ? (it.name || '(이름 없음)') : it.pn;
  $('listWrap').innerHTML = items.length ? '<div class="list">' + items.map((it,i)=>
    `<div class="it"><b>${esc(title(it))}</b><span>${esc(desc(it))}</span><button type="button" data-delete-index="${i}">삭제</button></div>`
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
  /* 이미지 종류는 자재 라벨과 같은 type 이므로 표본을 찾을 때 되돌려 준다 */
  const wantType = mode === 'matimg' ? 'mat' : mode;
  const sample = items.find(item => item.type === wantType) || items[0];
  const el = $('qrDiag');
  if(!sample){ el.textContent=''; return; }
  const data = qrData(sample);
  const urlMode = $('qmode').value === 'url' && sample.type !== 'bolt';
  /* 링크 라벨은 QR 데이터가 곧 주소라 칸을 넓혀도 한계가 있다 — 줄일 대상을 정확히 짚어준다 */
  const advice = sample.type === 'link' ? '링크 주소를 줄이세요 (사내 단축주소 권장)'
    : urlMode ? '기준 URL을 짧게 하세요' : 'QR 칸이 좁습니다 — 라벨 종류를 확인하세요';
  let q;
  try{ q = makeQrCode(data, $('ecc').value); }
  catch(error){
    el.innerHTML = `<b style="color:#b32020">QR 생성 실패</b> — 데이터가 ${data.length}자로 너무 깁니다. ${advice}.`;
    return;
  }
  const quietZone = (sample.type === 'loc' || sample.type === 'link') ? 4 : 2;
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
     .matmode{--qr-w:${MAT_LAYOUT.qrW}mm;--rev-w:${MAT_LAYOUT.revW}mm;
       --loc-w:${mmv(matBoxW())}mm;--img-w:${mmv(matImgW())}mm}
     .boltmode{--qr-w:${BOLT_LAYOUT.qrW}mm;--grade-w:${BOLT_LAYOUT.gradeW}mm;
       --top-w:${BOLT_LAYOUT.topW}mm;--side-w:${mmv(BOLT_LAYOUT.sideW + FC_PAD*2)}mm}
     .linkmode{--link-qr:${LINK_QR}mm}
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
