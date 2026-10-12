# 말씀 보석 100

어린이 성경 암송 PWA. 외울수록 열두 보석이 빛나고(내 말씀 탭), 상황별로 외운 말씀을 꺼내 본다(말씀 주머니). 주소와 폴더 이름은 옛 이름(verse-100-steps)을 그대로 쓴다. 스토어 없이 링크로 나눠 홈 화면에 설치해 쓴다.

## 먼저 읽을 것

- 기획서(모든 결정의 기준): https://claude.ai/code/artifact/3de0cd38-30d3-4664-be2b-8792d11e7957 — docs 도구로 읽는다.
- 시안: `design/mockup.html`. 기획서와 다르면 기획서를 따른다.
- README.md: 폴더, 세팅, 시험 방법.

## 구조

- 화면: `web/` 정적 HTML/CSS/JS(ES 모듈, 프레임워크·빌드 없음) → GitHub Pages
- 서버: `gas/app/` Apps Script 웹 앱(doGet load, doPost register·sync) → 구글 시트 탭 children, marks
- 진도는 기기에 먼저 쓰고 뒤에서 보낸다(`web/js/progress.js`). 서버 주소는 `web/js/config.js` 한 곳.

## 꼭 지킬 것 (five-people-garden 0단계 결과와 같음)

- POST는 헤더 없이 `fetch(url, {method:'POST', body: JSON.stringify(x)})`. Content-Type 지정 안 함.
- 시트 쓰기는 appendRow 금지. 서식(@)을 건 뒤 setValues, 글 앞에 `'`. 시간은 KST 문자열.
- 요청은 시간 제한 8초와 한 번 다시 보내기. 쓰기는 request_id로 중복 저장을 막는다.
- 사용자가 쓴 글(별칭, 코드)은 textContent로만 넣는다. `web/js/ui.js`의 `h()`를 쓴다.
- 실명·연락처는 저장하지 않는다. 별칭은 선택, 12자까지. 참여 코드는 두지 않는다(2026-10-11).
- 글자: 구절 본문 24px 이상, 누르는 곳 44px 이상(주요 버튼 64px). 줄바꿈은 어절 단위(keep-all).
- 화면 문구는 아이가 하는 동작으로: 들어 보기, 외우러 가기, 다음 단계, 외웠어요!, 잘못 눌렀어요.
- 화면 파일을 바꾸면 `web/sw.js`의 VERSION을 올린다.
- 시험은 흉내 서버(`?api=http://localhost:8741/exec`)로만 한다. localhost에서는 api 없이 열면 기기에만 저장된다(실제 시트에 시험 기록이 쌓인 일이 있었다, 2026-10-11).

## 시험

`node gas/test/run.js` (서버 논리), `node test/listen.mjs` (말해 보기 맞춰 보기). 화면은 README의 "내 컴퓨터에서 시험".

## 사용자

TK — SAP 컨설턴트·개발자, 어린이 사역 섬김. 한국어로 답한다. 설명은 짧게, 결정이 필요한 것만 묻는다.
