/**
 * 말씀 100계단 서버 설정. 구조는 five-people-garden과 같다(기획서 "진도 저장").
 * 시트 열 이름은 영문, 값은 한글. 열 종류: s = 글, n = 숫자.
 */

var TZ = 'Asia/Seoul';

var SCHEMA = {
  children: [
    ['code', 's'],        // 계단 코드 (예: 해바라기-4827)
    ['nickname', 's'],    // 불러 줄 이름(선택). 실명은 받지 않는다고 화면에서 안내
    ['created_at', 's'],
    ['updated_at', 's'],  // 마지막으로 기록이 들어온 때
    ['request_id', 's']   // 같은 등록 요청을 두 번 받아도 한 번만 만든다
  ],
  marks: [
    ['code', 's'],
    ['verse_id', 'n'],
    ['action', 's'],      // 외움 | 취소
    ['at', 's'],          // 아이가 누른 때(기기 시각, KST)
    ['saved_at', 's'],    // 서버에 들어온 때
    ['request_id', 's'],
    ['round', 'n']        // 몇 번째 바퀴(2026-10-13에 더함). 비어 있는 옛 기록은 1바퀴
  ]
};

// 알림(Firebase Cloud Messaging) 프로젝트 id. 공개 값이다. 비어 있으면 알림을 보내지 않는다(NOT_READY).
var FCM_PROJECT_ID = 'malsseum-boseok';

var VERSE_COUNT = 100;
var ROUND_MAX = 99;

var ACTION_LABEL = { done: '외움', undo: '취소' };

var LIMITS = {
  writePerMin: 20,          // 기기 키별 1분 쓰기 횟수
  writeGlobalPerMin: 300,   // 전체 1분 쓰기 횟수
  marksPerRequest: 200,
  nicknameMax: 12,
  lookupFailPerDevice: 10,  // 없는 계단 코드를 10분에 10번 넘게 물으면 그 기기만 잠근다
  lookupFailGlobalPerHour: 300,
  lookupWindowSec: 600
};

// 계단 코드 앞 단어. 아이가 읽고 말하기 쉬운 낱말만.
var CODE_WORDS = [
  '사과', '포도', '딸기', '수박', '참외', '바나나', '해바라기', '민들레', '무지개', '구름',
  '햇살', '바다', '하늘', '나무', '열매', '씨앗', '새싹', '풀잎', '꽃잎', '다람쥐',
  '토끼', '사슴', '참새', '비둘기', '고래', '등대', '시냇물', '오솔길', '별빛', '달빛'
];
