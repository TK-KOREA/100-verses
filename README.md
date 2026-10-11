# 말씀 100계단

어린이가 필수 암송 구절 100개를 하루 한 구절씩 외우고, 외운 구절을 스스로 체크하는 웹앱(PWA). 구절 하나를 외울 때마다 계단 하나를 오른다.

- 공개 주소: https://tk-korea.github.io/verse-100-steps/
- 기준 문서: [말씀 100계단 개발 기획서](https://claude.ai/code/artifact/3de0cd38-30d3-4664-be2b-8792d11e7957)
- 시안: [design/mockup.html](design/mockup.html)

## 폴더

| 경로 | 내용 |
| --- | --- |
| web/ | GitHub Pages로 올리는 화면 (`index.html`, `css/`, `js/`, `sw.js`, `manifest.json`, `icons/`, `data/verses.json`) |
| gas/app/ | Apps Script 서버. 진도를 구글 시트에 저장 (five-people-garden과 같은 구조) |
| gas/test/ | Node 흉내 환경: 서버 논리 시험(`run.js`)과 흉내 서버(`server.js`) |
| design/ | 시안 |
| 어린이_암송구절_회복역_최신.json | 구절 원본. `web/data/verses.json`은 이 파일을 그대로 복사한 것 |

## 진도 저장

1. "외웠어요!"를 누르면 기기(localStorage)에 바로 쓴다. 오프라인에서도 된다.
2. 뒤에서 Apps Script 웹 앱으로 보내 구글 시트의 `marks` 탭에 쌓는다. 실패하면 기기에 남겨 두었다가 다시 보낸다.
3. 처음 기록이 생기면 서버가 계단 코드(예: 해바라기-4827)를 만든다. 다른 기기의 설정 화면에서 이 코드를 넣으면 진도가 이어진다.

서버 주소는 `web/js/config.js`의 `PROD_API` 한 곳에만 둔다. 비어 있으면 기기에만 저장한다.

## 처음 세팅 (한 번)

1. 구글 시트에 스크립트를 붙인다: `cd gas/app && clasp create-script --parentId <시트 id> --title "말씀 100계단 서버" --rootDir .`
   - `--type sheets`를 함께 주면 parentId를 무시하고 새 시트를 만든다(2026-10-11 확인). 넣지 않는다.
   - clasp가 `appsscript.json`을 기본값(뉴욕 시간대)으로 덮어쓰므로 저장소의 파일로 되돌린 뒤 push한다.
   - `.clasp.json`은 저장소에 올리지 않는다.
2. `clasp push` → `clasp open-script` → 편집기에서 `setupAll` 실행, 권한 허용
3. 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자). 나온 `/exec` 주소를 `web/js/config.js`의 `PROD_API`에 넣는다.

코드를 고친 뒤에는 `clasp push` 하고 `clasp create-deployment -i <배포 id> -d "…"`로 같은 주소를 유지한다. 배포 id는 `web/js/config.js` 주소의 `/s/` 뒤 값이다. 화면 파일을 바꾸면 `web/sw.js`의 `VERSION`을 올린다.

## 내 컴퓨터에서 시험

```bash
node gas/test/run.js
```

화면까지 보려면 흉내 서버와 정적 서버를 띄우고 `http://localhost:8100/web/?api=http://localhost:8741/exec`를 연다. `FAIL=0.3`을 주면 요청의 30%를 구글 오류 페이지로 흉내 낸다.

```bash
PORT=8741 node gas/test/server.js
```

```bash
python3 -m http.server 8100
```

오프라인 저장(서비스 워커)은 내 컴퓨터에서는 꺼져 있다. 주소에 `&sw=1`을 붙이면 켜진다.
