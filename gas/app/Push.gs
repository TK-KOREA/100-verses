/**
 * 알림 0단계(기획서 "말씀 알림"): 시험용 홈 화면 앱(web/push0)이 받은 FCM 토큰으로 시험 알림을 보낸다.
 * 보내기는 Firebase Cloud Messaging HTTP v1이다. Apps Script에는 웹 알림의 서명·암호화 기능이 없어서 FCM을 거친다.
 * 인증은 이 스크립트를 실행하는 계정(TK)의 OAuth 토큰이고, x-goog-user-project로 사용량을 Firebase 프로젝트에 단다.
 * 0단계에서 확인할 것: 이 방식으로 아이폰(홈 화면 앱)과 안드로이드에 알림이 오는지, 앱을 닫아도 오는지.
 */

var PUSH0_PENDING = 'push0_pending';

/** 편집기에서 한 번 실행해 알림에 필요한 권한(외부 요청, 트리거, Firebase 메시지)을 허용한다. */
function authorizePush() {
  ScriptApp.getOAuthToken();
  ScriptApp.getProjectTriggers();
  UrlFetchApp.fetch('https://fcm.googleapis.com/', { muteHttpExceptions: true });
  Logger.log('알림 권한 준비 끝. FCM 프로젝트: ' + (FCM_PROJECT_ID || '(아직 비어 있음)'));
}

/** POST push0 {device_id, token, delay: 0 | 60} → {sent: true} 또는 {due: 시각} */
function postPush0_(b) {
  var dev = deviceId_(b.device_id);
  var token = fcmToken_(b.token);
  var delay = Number(b.delay) === 60 ? 60 : 0;
  if (!FCM_PROJECT_ID) fail_('NOT_READY', 'FCM_PROJECT_ID');
  return withLock_(function () {
    checkRate_(dev);
    if (!delay) {
      sendPush_(token, push0Message_(false));
      return { sent: true };
    }
    // 앱을 닫은 뒤에도 오는지 보려고 1분 뒤에 보낸다. 대기 목록은 스크립트 속성에 10개까지.
    var list = push0Pending_();
    list.push({ token: token, due: Date.now() + 60 * 1000 });
    PropertiesService.getScriptProperties().setProperty(PUSH0_PENDING, JSON.stringify(list.slice(-10)));
    push0Schedule_();
    return { due: kstNow_() };
  });
}

/** 시간 트리거가 부른다. 때가 된 시험 알림을 보낸다. */
function push0Due() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'push0Due') ScriptApp.deleteTrigger(t);
  });
  var keep = [];
  push0Pending_().forEach(function (p) {
    if (p.due > Date.now() + 5000) {
      keep.push(p);
      return;
    }
    try {
      sendPush_(p.token, push0Message_(true));
    } catch (err) {
      console.error('push0Due ' + (err && err.message || err));
    }
  });
  PropertiesService.getScriptProperties().setProperty(PUSH0_PENDING, JSON.stringify(keep));
  if (keep.length) push0Schedule_();
}

function push0Schedule_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'push0Due'; });
  if (!has) ScriptApp.newTrigger('push0Due').timeBased().after(60 * 1000).create();
}

function push0Pending_() {
  try {
    var v = JSON.parse(PropertiesService.getScriptProperties().getProperty(PUSH0_PENDING) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (err) {
    return [];
  }
}

/** 시험 알림 글. url은 시험 앱 안의 상대 주소(서비스 워커가 자기 범위에 붙인다). */
function push0Message_(later) {
  return later
    ? { title: '1분 뒤 시험 알림', body: '앱을 닫아도 알림이 와요! 눌러서 열어 보세요.', url: '?opened=later' }
    : { title: '시험 알림', body: '알림이 잘 와요! 눌러서 열어 보세요.', url: '?opened=now' };
}

/**
 * FCM HTTP v1로 한 기기에 보낸다. 글은 data에만 담고, 알림은 서비스 워커가 띄운다(값은 모두 글이어야 한다).
 * 실패하면 PUSH_FAILED(구글이 준 이유 앞부분을 붙인다).
 */
function sendPush_(token, data) {
  var res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT_ID + '/messages:send', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': FCM_PROJECT_ID },
    payload: JSON.stringify({
      message: { token: token, webpush: { headers: { Urgency: 'high', TTL: '3600' }, data: data } }
    })
  });
  var code = res.getResponseCode();
  if (code === 200) return true;
  var text = String(res.getContentText() || '').replace(/\s+/g, ' ').slice(0, 300);
  console.error('FCM ' + code + ' ' + text);
  fail_('PUSH_FAILED', code + ' ' + text);
}

/** FCM 등록 토큰. 모양만 본다(글자 종류와 길이). */
function fcmToken_(v) {
  var s = String(v || '');
  if (s.length < 20 || s.length > 4096 || !/^[A-Za-z0-9_:\-]+$/.test(s)) fail_('INVALID', 'token');
  return s;
}
