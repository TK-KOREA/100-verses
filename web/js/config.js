// 서버 주소는 이 파일 한 곳에만 둔다. 비밀 값은 넣지 않는다.
// Apps Script를 배포하면 PROD_API에 /exec 주소를 넣는다. 비어 있으면 기기에만 저장한다.
const PROD_API = 'https://script.google.com/macros/s/AKfycbx8TS_7gPpSMUWWi5U7i5WSglhiKHLnc2V3nQO5gQ8vPt_2EkUeJFTGBG1qBnt_Jxdj/exec';
// 내 컴퓨터(localhost)에서는 실제 서버에 보내지 않는다. ?api=로 흉내 서버(gas/test/server.js)를 줄 때만 보낸다.
// (2026-10-11: api 없이 연 시험 화면이 실제 시트에 기록을 남긴 일이 있었다)
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API_URL = IS_LOCAL ? (new URLSearchParams(location.search).get('api') || '') : PROD_API;

// five-people-garden 0단계 결과: 요청의 약 7%가 8~20초 뒤 실패하므로 시간 제한과 한 번 다시 보내기를 둔다.
export const TIMEOUT_MS = 8000;
export const RETRIES = 1;

export const VERSE_COUNT = 100;
