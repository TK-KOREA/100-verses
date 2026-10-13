/**
 * 웹 앱 입구. 응답은 항상 {ok, data, error}.
 * 화면은 헤더 없이 요청한다. POST 본문은 JSON 문자열 하나(text/plain, CORS 사전 요청 피하기).
 */

function getActions_() {
  return { load: getLoad_ };
}

function postActions_() {
  return { register: postRegister_, sync: postSync_, push0: postPush0_ };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  return run_(function () {
    var fn = getActions_()[p.action];
    if (!fn) fail_('INVALID', 'action');
    return fn(p);
  });
}

function doPost(e) {
  return run_(function () {
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      fail_('INVALID', 'json');
    }
    if (!body || typeof body !== 'object') fail_('INVALID', 'json');
    var fn = postActions_()[body.action];
    if (!fn) fail_('INVALID', 'action');
    return fn(body);
  });
}

function run_(fn) {
  var out;
  try {
    out = { ok: true, data: fn(), error: null };
  } catch (err) {
    if (err instanceof ApiError) {
      out = { ok: false, data: null, error: { code: err.code, message: err.message } };
    } else {
      console.error(err && err.stack || err);
      out = { ok: false, data: null, error: { code: 'SERVER', message: String(err && err.message || err) } };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
