qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/* ---------------------------------------------------------------------
   Code 128 (subset B) 인코더 — 패턴 테이블은 표준 Code128 심볼 정의
   문자값 = charCode-32, START B=104, 체크섬=(104+Σ(i+1)*값)%103, STOP
   --------------------------------------------------------------------- */
var CODE128_T = '11011001100110011011001100110011010010011000100100011001000100110010011001000100110001001000110010011001001000110010001001100010010010110011100100110111001001100111010111001100100111011001001110011011001110010110010111001100100111011011100100110011101001110110111011101001100111001011001110010011011101100100111001101001110011001011011011000110110001101100011011010100011000100010110001000100011010110001000100011010001000110001011010001000110001010001100010001010110111000101100011101000110111010111011000101110001101000111011011101110110110100011101100010111011011101000110111000101101110111011101011000111010001101110001011011101101000111011000101110001101011101111010110010000101111000101010100110000101000011001001011000010010000110100001011001000010011010110010000101100001001001101000010011000010100001101001000011001011000010010110010100001111011101011000010100100011110101010011110010010111100100100111101011110010010011110100100111100101111010010011110010100111100100101101101111011011110110111101101101010111100010100011110100010111101011110100010111100010111101010001111010001010111011110101111011101110101111011110101110110100001001101001000011010011100';

/* Code128(서브셋 B)로 인코딩 가능한 문자열인지 — ASCII 32~126 만 가능 */
function code128Supported(text){ return /^[\x20-\x7E]+$/.test(String(text == null ? '' : text)); }

function code128Bits(text){
  var v = [104], sum = 104, i, x;
  for(i=0;i<text.length;i++){
    x = text.charCodeAt(i) - 32;
    if(x < 0 || x > 94) throw new Error('Code128(B)로 인코딩할 수 없는 문자: ' + text.charAt(i));
    v.push(x); sum += (i+1) * x;
  }
  v.push(sum % 103);
  var bits = '';
  for(i=0;i<v.length;i++) bits += CODE128_T.substr(v[i]*11, 11);
  return bits + '1100011101011';                  // STOP + 종료바
}

/* Code128 SVG — 좌우 quiet zone 10모듈 포함, 하단에 사람이 읽는 문자 */
function code128SvgTag(text, opt){
  var o = opt || {}, s = String(text == null ? '' : text);
  var bh = o.barHeight || 12, th = (o.text === false) ? 0 : 5;   // 가로로 넓은 칸을 꽉 채우도록 낮은 비율
  var esc1 = function(t){ return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  /* 인코딩 불가 문자가 있으면 바코드를 그리지 않고 문자만 인쇄한다.
     (임의 치환하면 스캔은 되지만 원본과 다른 값이 읽혀 재고가 어긋난다) */
  if(!code128Supported(s)){
    var w0 = Math.max(60, s.length * 5 + 20);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w0 + ' ' + (bh+th) + '" preserveAspectRatio="xMidYMid meet">'
      + '<rect width="100%" height="100%" fill="#fff"/>'
      + '<text x="' + (w0/2) + '" y="' + ((bh+th)/2 + 3) + '" text-anchor="middle" font-family="Consolas,monospace" font-weight="700" font-size="8">'
      + esc1(s) + '</text></svg>';
  }
  var bits = code128Bits(s), q = 10, w = bits.length + q*2;
  var d = '', i = 0, j, n;
  while(i < bits.length){
    if(bits.charAt(i) === '1'){
      j = i; while(bits.charAt(j) === '1') j++;
      n = j - i;
      d += 'M' + (q+i) + ' 0h' + n + 'v' + bh + 'h-' + n + 'z';
      i = j;
    } else i++;
  }
  var label = esc1(s);
  /* 문자를 뺀 막대만 그릴 때는 칸 크기에 정확히 맞춘다(막대는 세로로 늘려도 정보가 변하지 않음) */
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + (bh+th) + '" preserveAspectRatio="' + (th ? 'xMidYMid meet' : 'none') + '">'
    + '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/>'
    + (th ? '<text x="' + (w/2) + '" y="' + (bh+th-1) + '" text-anchor="middle" font-family="Consolas,monospace" font-weight="700" font-size="4.4" fill="#000">' + label + '</text>' : '')
    + '</svg>';
}

/* 실제 렌더링과 진단이 같은 인코딩 방식을 사용하도록 QR 생성을 한곳에서 처리한다. */
function makeQrCode(text, ecc){
  var q = qrcode(0, ecc || 'M');
  var s = String(text == null ? '' : text);
  /* 영숫자 모드(0-9 A-Z 및 " $%*+-./:")는 바이트 모드보다 조밀하다 —
     BT-SOC-M8X30-129 같은 코드는 25→21 모듈로 줄어 셀 크기가 19% 커진다 */
  q.addData(s, /^[0-9A-Z $%*+\-.\/:]+$/.test(s) ? 'Alphanumeric' : 'Byte');
  q.make();
  return q;
}

/* QR SVG — 오류정정 기본 M, quiet zone 4모듈 포함 */
function qrSvgTag(text, ecc, margin){
  try{
    var q = makeQrCode(text, ecc);
    /* margin = quiet zone 모듈 수 (기본 4 = 표준. 작은 QR 은 2 로 줄여 셀 크기를 확보) */
    return q.createSvgTag({ cellSize:1, margin:(margin == null ? 4 : margin), scalable:true });
  }catch(e){
    /* 데이터가 QR 최대 용량을 넘긴 경우 등 — 빈칸 대신 원인을 인쇄해 즉시 알 수 있게 */
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" preserveAspectRatio="xMidYMid meet">'
      + '<rect width="29" height="29" fill="#fff" stroke="#000" stroke-width="0.6"/>'
      + '<text x="14.5" y="13" text-anchor="middle" font-size="3.4" font-weight="700" font-family="sans-serif">QR 생성실패</text>'
      + '<text x="14.5" y="18" text-anchor="middle" font-size="2.6" font-family="sans-serif">데이터가 너무 김</text></svg>';
  }
}
