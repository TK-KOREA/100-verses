/**
 * 계단 코드 만들기, 진도 주고받기, 코드로 불러오기.
 * 기록은 지우지 않고 쌓는다. 구절마다 가장 늦은 기록(at, 같으면 saved_at)을 따른다.
 */

/** POST register {device_id, request_id, nickname?} → {code, nickname, marks: []} */
function postRegister_(b) {
  var dev = deviceId_(b.device_id);
  var rid = requestId_(b.request_id);
  var nickname = nickname_(b.nickname);
  return withLock_(function () {
    var children = table_('children');
    for (var i = 0; i < children.length; i++) {
      if (children[i].request_id === rid) return state_(children[i]); // 같은 요청을 다시 받음
    }
    checkRate_(dev);
    var now = kstNow_();
    var child = { code: newCode_(children), nickname: nickname, created_at: now, updated_at: now, request_id: rid };
    appendRows_('children', [child]);
    return state_(child);
  });
}

/**
 * POST sync {code, device_id, marks: [{verse_id, action: done|undo, at, request_id}], nickname?}
 * 새 기록을 쌓고 지금 상태를 돌려준다. 이미 받은 request_id는 다시 쌓지 않는다.
 */
function postSync_(b) {
  var dev = deviceId_(b.device_id);
  var code = code_(b.code);
  var list = b.marks == null ? [] : b.marks;
  if (!Array.isArray(list) || list.length > LIMITS.marksPerRequest) fail_('INVALID', 'marks');
  var now = kstNow_();
  var clean = list.map(function (m) { return mark_(m, now); });
  var hasNickname = Object.prototype.hasOwnProperty.call(b, 'nickname');
  var nickname = hasNickname ? nickname_(b.nickname) : null;

  return withLock_(function () {
    var child = findChild_(code);
    if (!child) fail_('NOT_FOUND');
    var nameChanged = hasNickname && nickname !== child.nickname;
    if (!clean.length && !nameChanged) return state_(child);

    checkRate_(dev);
    var seen = {};
    table_('marks').forEach(function (r) { seen[r.request_id] = true; });
    var add = [];
    clean.forEach(function (m) {
      if (seen[m.request_id]) return;
      seen[m.request_id] = true;
      add.push({ code: code, verse_id: m.verse_id, action: ACTION_LABEL[m.action], at: m.at, saved_at: now, request_id: m.request_id });
    });
    appendRows_('marks', add);
    if (add.length || nameChanged) {
      if (nameChanged) child.nickname = nickname;
      child.updated_at = now;
      saveRow_('children', child);
    }
    return state_(child);
  });
}

/** GET load {code, device_id} → 다른 기기에서 계단 코드로 불러오기 */
function getLoad_(p) {
  var dev = deviceId_(p.device_id);
  checkLookupLock_(dev);
  var code = normalizeCode_(p.code);
  var child = code ? findChild_(code) : null;
  if (!child) {
    countLookupFail_(dev);
    fail_('NOT_FOUND');
  }
  return state_(child);
}

function findChild_(code) {
  var rows = table_('children');
  for (var i = 0; i < rows.length; i++) if (rows[i].code === code) return rows[i];
  return null;
}

/** 구절마다 가장 늦은 기록 하나. marks = [{verse_id, done, at}] (at 순) */
function state_(child) {
  var latest = {};
  table_('marks').forEach(function (r) {
    if (r.code !== child.code) return;
    var cur = latest[r.verse_id];
    if (!cur || r.at > cur.at || (r.at === cur.at && r.saved_at >= cur.saved_at)) latest[r.verse_id] = r;
  });
  var marks = Object.keys(latest).map(function (k) {
    var r = latest[k];
    return { verse_id: r.verse_id, done: r.action === ACTION_LABEL.done, at: r.at };
  });
  marks.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : a.verse_id - b.verse_id; });
  return { code: child.code, nickname: child.nickname, marks: marks };
}

/** 낱말-네 자리 숫자. 이미 있으면 다시 뽑는다. */
function newCode_(children) {
  var used = {};
  children.forEach(function (c) { used[c.code] = true; });
  for (var tries = 0; tries < 50; tries++) {
    var word = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
    var num = 1000 + Math.floor(Math.random() * 9000);
    var code = word + '-' + num;
    if (!used[code]) return code;
  }
  throw new Error('계단 코드를 만들지 못했어요.');
}
