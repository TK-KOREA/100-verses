/**
 * 오류, 잠금, 횟수 제한, 입력 검사.
 * 참여 코드는 두지 않는다(2026-10-11). 기기 키별·전체 횟수 제한과 값 검사로 장난을 줄인다.
 */

function ApiError(code, message) {
  this.code = code;
  this.message = message || code;
}

function fail_(code, message) {
  throw new ApiError(code, message);
}

/** 모든 쓰기는 스크립트 잠금 안에서. 10초 안에 못 얻으면 BUSY. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function incr_(key, ttl) {
  var c = cache_();
  var n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), ttl);
  return n;
}

/** 쓰기 횟수 제한. 잠금 안에서 부른다. */
function checkRate_(deviceId) {
  var minute = Utilities.formatDate(new Date(), TZ, 'yyyyMMddHHmm');
  var c = cache_();
  var devKey = 'w_' + deviceId + '_' + minute;
  var allKey = 'w_all_' + minute;
  if (Number(c.get(devKey) || 0) >= LIMITS.writePerMin) fail_('RATE_LIMIT');
  if (Number(c.get(allKey) || 0) >= LIMITS.writeGlobalPerMin) fail_('RATE_LIMIT');
  incr_(devKey, 120);
  incr_(allKey, 120);
}

/** 없는 계단 코드를 계속 묻는 기기는 10분 잠근다(코드 맞히기 막기). */
function checkLookupLock_(deviceId) {
  var c = cache_();
  var hour = Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
  if (Number(c.get('lf_' + deviceId) || 0) >= LIMITS.lookupFailPerDevice) fail_('LOCKED_OUT');
  if (Number(c.get('lf_all_' + hour) || 0) >= LIMITS.lookupFailGlobalPerHour) fail_('LOCKED_OUT');
}

function countLookupFail_(deviceId) {
  var hour = Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
  incr_('lf_' + deviceId, LIMITS.lookupWindowSec);
  incr_('lf_all_' + hour, 3600);
}

// ---------- 입력 검사 ----------

function deviceId_(v) {
  var s = String(v || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) fail_('INVALID', 'device_id');
  return s;
}

function requestId_(v) {
  var s = String(v || '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) fail_('INVALID', 'request_id');
  return s;
}

/**
 * 계단 코드는 띄어쓰기나 - 없이 넣어도 받아 준다: "해바라기 4827", "해바라기4827" → "해바라기-4827".
 * 모양이 틀리면 null.
 */
function normalizeCode_(v) {
  var s = String(v || '').replace(/\s+/g, '');
  var m = s.match(/^([가-힣]{1,6})-?(\d{4})$/);
  return m ? m[1] + '-' + m[2] : null;
}

function code_(v) {
  var c = normalizeCode_(v);
  if (!c) fail_('INVALID', 'code');
  return c;
}

/** 불러 줄 이름. 앞뒤 공백을 지우고, 줄바꿈과 제어 문자를 빼고, 12자까지. */
function nickname_(v) {
  if (v == null) return '';
  var s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (Array.from(s).length > LIMITS.nicknameMax) fail_('INVALID', 'nickname');
  return s;
}

/** 기기가 보낸 시각. 모양이 틀리면 거르고, 서버 시각보다 하루 넘게 앞서면 서버 시각으로 둔다. */
function at_(v, now) {
  var s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(s)) fail_('INVALID', 'at');
  var t = Date.parse(s);
  if (!isFinite(t)) fail_('INVALID', 'at');
  if (t > Date.now() + 24 * 3600 * 1000) return now;
  return s;
}

function mark_(m, now) {
  if (!m || typeof m !== 'object') fail_('INVALID', 'mark');
  var id = Number(m.verse_id);
  if (!(id >= 1 && id <= VERSE_COUNT && Math.floor(id) === id)) fail_('INVALID', 'verse_id');
  if (!ACTION_LABEL[m.action]) fail_('INVALID', 'action');
  return { verse_id: id, action: m.action, at: at_(m.at, now), request_id: requestId_(m.request_id), round: round_(m.round) };
}

/** 바퀴 번호. 없으면 1(바퀴를 모르는 옛 화면이 보낸 기록). */
function round_(v) {
  if (v == null || v === '') return 1;
  var r = Number(v);
  if (!(r >= 1 && r <= ROUND_MAX && Math.floor(r) === r)) fail_('INVALID', 'round');
  return r;
}
