# HL Robotics 라벨 생성기

100 × 60 mm 유포지 라벨(자재 · 볼트류 · 로케이션)을 생성하고 인쇄하는 브라우저 애플리케이션입니다.
설치·빌드·서버가 필요 없고 외부 CDN도 쓰지 않아 **인터넷 연결 없이 동작**합니다.

## 실행

`index.html` 을 브라우저에서 열면 끝입니다. GitHub Pages 로 배포하면 주소로 바로 열 수 있습니다.

## 라벨 3종

| 종류 | 용도 | 특징 |
|---|---|---|
| 자재 라벨 | 파트박스 정면 | 품번·Rev·품명·기종·협력사·입고일·박스ID + QR + Code128. 품번은 칸 폭에 맞춰 자동 축소 |
| 볼트류 라벨 | 파스너 박스 정면 | 규격 대형 표기 + 강도 + 머리 형상 도면 + **1:1 반단면 측면 도면**(실물 대조용) + 적용 제품·위치 |
| 로케이션 라벨 | 랙 칸 앞면 | 32.9 mm QR + 코드 대형 표기 |

용지는 **라벨 프린터 낱장 연속**과 **A4 시트(격자 자동 계산)** 두 가지를 지원하고,
인쇄가 잘리거나 밀릴 때는 [디테일 설정]의 정합 테스트 인쇄로 실측해 보정합니다.

운영 규칙(코드 체계 · QR 데이터 규격 · 트랜잭션 · 구글시트 연동 · 도입 순서)은
**[docs/운영계획.md](docs/운영계획.md)** 에 있습니다.

## 파일 구조

```text
.
├─ index.html                     # 화면 마크업과 자산 로딩
├─ assets/
│  ├─ css/
│  │  └─ label-maker.css          # 화면·라벨·인쇄 스타일
│  ├─ images/
│  │  └─ hl-robotics-logo.svg     # 화면과 라벨이 공유하는 회사 로고
│  └─ js/
│     ├─ vendor/
│     │  ├─ qrcode.min.js         # QR 생성 라이브러리
│     │  └─ LICENSE               # qrcode-generator (MIT) 고지
│     ├─ barcode.js               # QR·Code128 SVG 생성기
│     ├─ core.js                  # 설정, 공통 도우미, 볼트 규격표·도면
│     ├─ label-renderers.js       # 라벨 종류별 HTML 렌더러, 레이아웃 상수
│     └─ app.js                   # 채번, 목록, CSV, 미리보기, 인쇄 제어
└─ docs/
   └─ 운영계획.md                  # QR 재고관리 운영 계획
```

## 유지보수 원칙

- 스크립트는 HTML에 선언된 순서대로 의존합니다: `qrcode.min.js` → `barcode.js` → `core.js` → `label-renderers.js` → `app.js`.
- **프린터 기본 보정값**은 `assets/js/core.js` 의 `CAL` · `CAL_PRESETS` 에서 관리합니다.
  `CAL` 은 `Object.freeze` 되어 있습니다 — 프리셋 버튼은 입력칸만 바꾸므로 [전체 초기화]는 항상 이 값으로 돌아갑니다.
- **라벨 칸 치수**(푸터 높이, QR 칸 폭, 도면 칸 폭 등)는 `assets/js/label-renderers.js` 의
  `MAT_LAYOUT` · `BOLT_LAYOUT` **한 곳**에서만 관리합니다. `applyStyles()` 가 CSS 변수(`--qr-w`, `--side-w` 등)로
  넘겨주므로 CSS 에 같은 숫자를 다시 적지 않습니다.
  푸터(바코드 칸) 높이는 자재·볼트가 공유하는 `FOOT_H`(10.2mm) 하나로 정합니다 — 두 라벨이 같은 랙에
  섞여 붙으므로 스캔 높이가 같아야 합니다. QR 칸은 정사각형이라 폭도 이 값을 씁니다.
- **QR·1D 바코드 기본값은 둘 다 품번**입니다(`qmode=ims` → `품번 (Rev)`, `c128v=pn` → 품번).
  기본값을 바꿀 때는 `index.html` 의 두 `<select>` 의 `selected` 를 옮기세요.
- 레이아웃을 고칠 때는 `assets/css/label-maker.css` 와 `assets/js/label-renderers.js` 를 함께 확인합니다.
- 용지 크기와 A4 인쇄 격자는 `assets/js/app.js` 의 `applyStyles()` · `sheetGrid()` 에서 계산합니다.
- **볼트 측면 도면은 절대 축소하지 않습니다.** 칸에 맞추는 수단은 반단면(세로 절반)과
  지그재그 축약 기호(가로)뿐이며, 축척 표기는 두지 않습니다 — 자세한 근거는 운영계획 §3.
- **박스 ID 순번**은 `localStorage` 키 `hlr.labelmaker.boxSeq` 에 입고일별로 저장됩니다
  (`{"260804": 12}` = 2026-08-04 입고분은 012번까지 발행됨. 최근 **90개 입고일**분만 유지).
  저장값은 `commitSeq()` 에서 올라가기만 하고, 발행 후 [시작 번호] 칸은 `restoreSeq()` 가 저장값+1을
  하한으로 되돌립니다 — 재인쇄로 번호를 손으로 내려도 이어지는 신규 발행이 이미 쓴 박스 ID를 재사용하지 않습니다.
- QR quiet zone 은 자재·볼트 2모듈, 로케이션 4모듈입니다. 작은 칸에서 모듈을 늘리면 셀이 작아져
  인식이 나빠지므로 **줄이지 말고 늘리지도 마세요** — 근거는 운영계획 §7.

## 라이선스

`assets/js/vendor/qrcode.min.js` 는 [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
(MIT, © Kazuhiko Arase) 입니다. 고지는 `assets/js/vendor/LICENSE` 에 있습니다.
그 외 코드와 문서는 HL Robotics 사내 자산입니다.
