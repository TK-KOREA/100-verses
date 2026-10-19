# 말씀 보석 100

어린이가 필수 암송 구절 100개를 하루 한 구절씩 외우고, 외운 구절을 스스로 체크하는 웹앱(PWA). 외울수록 열두 보석(100구절을 열두 묶음으로 나눈 것)이 빛나고, 상황별로 외운 말씀을 꺼내 본다(말씀 주머니).

- 공개 주소: https://tk-korea.github.io/100-verses/
- 옛 주소(https://tk-korea.github.io/verse-100-steps/)는 [TK-KOREA/verse-100-steps](https://github.com/TK-KOREA/verse-100-steps) 저장소가 새 주소로 넘겨준다. 그 저장소는 지우지 않는다.
- 기준 문서: [말씀 보석 100 개발 기획서](https://claude.ai/code/artifact/3de0cd38-30d3-4664-be2b-8792d11e7957)
- 시안: [design/mockup.html](design/mockup.html)

## 폴더

| 경로 | 내용 |
| --- | --- |
| web/ | GitHub Pages로 올리는 화면 (`index.html`, `css/`, `js/`, `sw.js`, `manifest.json`, `icons/`, `data/verses.json`) |
| gas/app/ | Apps Script 서버. 진도를 구글 시트에 저장 (five-people-garden과 같은 구조) |
| gas/test/ | Node 흉내 환경: 서버 논리 시험(`run.js`)과 흉내 서버(`server.js`) |
| web/audio/ | 들어 보기 음원. 목소리마다 `manifest.json`(덩어리 시간표)과 구절별 `ref.m4a`(주소), `text.m4a`(본문) |
| tools/tts/ | 음원 만들기(`make.py`), 목소리 설계(`voices.py`), 따라 말하기 덩어리(`chunks.txt`) |
| web/push0/ | 알림 0단계 시험용 홈 화면 앱(아이들 앱과 따로). 본 기능을 만들면 지운다 |
| design/ | 시안 (`mockup.html` 앱, `reminders.html` 말씀 알림) |
| 어린이_암송구절_회복역_최신.json | 구절 원본. `web/data/verses.json`은 이 파일을 그대로 복사한 것 |

## 진도 저장

1. "외웠어요!"를 누르면 기기(localStorage)에 바로 쓴다. 오프라인에서도 된다.
2. 뒤에서 Apps Script 웹 앱으로 보내 구글 시트의 `marks` 탭에 쌓는다. 실패하면 기기에 남겨 두었다가 다시 보낸다.
3. 처음 기록이 생기면 서버가 내 코드(예: 해바라기-4827)를 만든다. 다른 기기의 설정 화면에서 이 코드를 넣으면 진도가 이어진다.

서버 주소는 `web/js/config.js`의 `PROD_API` 한 곳에만 둔다. 비어 있으면 기기에만 저장한다.

## 처음 세팅 (한 번)

1. 구글 시트에 스크립트를 붙인다: `cd gas/app && clasp create-script --parentId <시트 id> --title "말씀 100계단 서버" --rootDir .`
   - `--type sheets`를 함께 주면 parentId를 무시하고 새 시트를 만든다(2026-10-11 확인). 넣지 않는다.
   - clasp가 `appsscript.json`을 기본값(뉴욕 시간대)으로 덮어쓰므로 저장소의 파일로 되돌린 뒤 push한다.
   - `.clasp.json`은 저장소에 올리지 않는다.
2. `clasp push` → `clasp open-script` → 편집기에서 `setupAll` 실행, 권한 허용
3. 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자). 나온 `/exec` 주소를 `web/js/config.js`의 `PROD_API`에 넣는다.

코드를 고친 뒤에는 `clasp push` 하고 `clasp create-deployment -i <배포 id> -d "…"`로 같은 주소를 유지한다. 배포 id는 `web/js/config.js` 주소의 `/s/` 뒤 값이다. 화면 파일을 바꾸면 `web/sw.js`의 `VERSION`을 올린다.

## 들어 보기 음원

목소리 다섯 개(주일학교 선생님, 다정한 언니, 든든한 아빠, 또박또박 선생님, 이야기 할아버지)로 100구절을 Gemini TTS로 미리 만들어 `web/audio/`에 둔다. 앱은 Gemini를 부르지 않는다. 음원이 없는 구절은 기기 목소리로 읽는다.

1. API 키를 `tools/tts/.env`에 `GEMINI_API_KEY=...`로 둔다(저장소에 올리지 않음).
2. 무료 등급: `python3 tools/tts/make.py daily --loop`. 1번 구절부터 다섯 목소리를 같이 만들고, 하루 한도를 다 쓰면 다음 한도(미국 태평양 시간 자정, 한국 16시·서머타임 끝나면 17시)까지 기다렸다가 이어서 만든다. 다 만들면 스스로 끝난다. 뒤에서 돌릴 때는 `nohup caffeinate -i python3 -u tools/tts/make.py daily --loop --publish >> tools/tts/out/daily.log 2>&1 &`. `--publish`는 한 번 만들 때마다 `web/audio`만 커밋하고 main에 push해 운영에 반영한다(main이 아니거나 안 올린 다른 커밋이 있으면 건너뛴다). 진행은 `python3 tools/tts/make.py status`.
   - 유료 키: `python3 tools/tts/make.py build --voice teacher` (다른 목소리는 `sister`, `dad`, `clear`, `storyteller`). `--ids 1-10`으로 일부만 만들 수 있다. 이미 만든 구절은 건너뛴다.
   - 한 모델의 한도를 다 쓰면 다음 모델(3.8 → 3.1 → 2.5)로 간다. 어느 모델로 만들었는지는 manifest의 `model`에 남는다.
3. 끝에 "확인 필요"가 붙은 구절은 받아쓰기가 본문과 달랐던 것이다. `tools/tts/out/heard/<목소리>.json`을 보고 `--ids <번호> --force`로 다시 만든다.

- 구절마다 주소와 본문을 한 번에 합성하고, 덩어리 사이 쉼을 찾아 시간표를 뽑는다(덩어리는 `chunks.txt`, 이으면 본문과 같아야 한다). 쉼은 0.4초로 맞춘다.
- 합성 원본은 `tools/tts/out/raw/`에 남는다. 덩어리만 다시 나눌 때는 `resplit --voice <목소리>`로 합성 없이 한다.
- 무료 등급은 모델마다 하루 10번이라 100구절×5목소리(500번)는 유료 등급 키가 있어야 한다.
- 음원을 바꾸면 `manifest.json`의 `v`가 바뀌어 앱이 새 파일을 받는다. `sw.js`의 VERSION은 화면 파일을 바꿀 때만 올린다.

## 알림 0단계

말씀 알림은 Apps Script → Firebase Cloud Messaging(FCM) → 기기로 보낸다. 본 기능 전에 `web/push0/` 시험 앱으로 실제 기기에 오는지 확인한다.

1. Firebase 프로젝트(TK 계정)에서 웹 앱을 등록하고 웹 푸시 인증서(키 쌍)를 만든다. 설정 값과 VAPID 공개 키를 `web/push0/firebase-config.js`에, 프로젝트 id를 `gas/app/Config.gs`의 `FCM_PROJECT_ID`에 넣는다(모두 공개 값).
2. `appsscript.json`에 `oauthScopes`를 적어 두었다(Firebase 범위는 자동으로 찾지 않는다). 쓰는 서비스가 늘면 여기에도 더한다. `clasp push` 뒤 편집기에서 `authorizePush`를 한 번 실행해 권한을 허용하고 나서 새 버전을 배포한다(허용 전에 배포하면 서버가 멈춘다).
3. 아이폰은 Safari로 `https://tk-korea.github.io/100-verses/push0/`를 열어 홈 화면에 추가하고 그 아이콘으로 연다. "알림 허용하고 준비하기" → "지금 보내기" → "1분 뒤 보내기"(누르고 앱을 닫고 화면 끄기) → 알림을 눌러 앱이 열리는지 본다.

## 내 컴퓨터에서 시험

```bash
node gas/test/run.js
```

```bash
node test/listen.mjs
```

`test/listen.mjs`는 4단계 "말해 보기"가 말한 글과 어절을 맞춰 보는 규칙을 시험한다.

화면까지 보려면 흉내 서버와 정적 서버를 띄우고 `http://localhost:8100/web/?api=http://localhost:8741/exec`를 연다. `FAIL=0.3`을 주면 요청의 30%를 구글 오류 페이지로 흉내 낸다.

```bash
PORT=8741 node gas/test/server.js
```

```bash
python3 -m http.server 8100
```

오프라인 저장(서비스 워커)은 내 컴퓨터에서는 꺼져 있다. 주소에 `&sw=1`을 붙이면 켜진다.
