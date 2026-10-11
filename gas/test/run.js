// 서버 논리 시험. 실행: node gas/test/run.js
'use strict';

const { makeEnv } = require('./harness');

let pass = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n    ' + (e && e.stack || e));
  }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg || '') + ' 기대 ' + B + ', 실제 ' + A);
}
function ok(v, msg) { if (!v) throw new Error(msg || '참이 아님'); }

const DEV = 'device_aaaaaaaa';
let n = 0;
const rid = () => 'req_' + String(++n).padStart(8, '0');
const at = (s) => '2026-10-10T' + s + '+09:00';

function fresh() {
  const env = makeEnv();
  env.call('setupAll');
  return env;
}
function register(env, extra = {}) {
  const r = env.post({ action: 'register', device_id: DEV, request_id: rid(), ...extra });
  ok(r.ok, JSON.stringify(r));
  return r.data;
}
function mark(id, action, time) {
  return { verse_id: id, action, at: at(time), request_id: rid() };
}

console.log('계단 코드');
test('setupAll이 탭과 머리글을 만든다', () => {
  const env = fresh();
  eq(env.sheets.children.data[0], ['code', 'nickname', 'created_at', 'updated_at', 'request_id']);
  eq(env.sheets.marks.data[0], ['code', 'verse_id', 'action', 'at', 'saved_at', 'request_id']);
});
test('register는 낱말-네 자리 코드를 만든다', () => {
  const env = fresh();
  const d = register(env, { nickname: ' 하늘이 ' });
  ok(/^[가-힣]+-\d{4}$/.test(d.code), d.code);
  eq(d.nickname, '하늘이');
  eq(d.marks, []);
});
test('같은 request_id로 두 번 등록해도 하나만 만든다', () => {
  const env = fresh();
  const body = { action: 'register', device_id: DEV, request_id: 'same_request_1' };
  const a = env.post(body).data;
  const b = env.post(body).data;
  eq(a.code, b.code);
  eq(env.sheets.children.getLastRow(), 2);
});
test('별칭이 12자를 넘으면 INVALID', () => {
  const env = fresh();
  const r = env.post({ action: 'register', device_id: DEV, request_id: rid(), nickname: '가'.repeat(13) });
  eq(r.error.code, 'INVALID');
});
test('기기 키 모양이 틀리면 INVALID', () => {
  const env = fresh();
  const r = env.post({ action: 'register', device_id: 'x', request_id: rid() });
  eq(r.error.code, 'INVALID');
});
test('수식처럼 보이는 별칭도 글로 저장된다', () => {
  const env = fresh();
  const d = register(env, { nickname: '=1+1' });
  eq(d.nickname, '=1+1');
  ok(!env.sheets.children.data[1].some((v) => v && v.unquoted !== undefined), '따옴표 없이 쓴 글이 있음');
});

console.log('진도 주고받기');
test('외운 기록을 보내면 상태로 돌아온다', () => {
  const env = fresh();
  const { code } = register(env);
  const r = env.post({ action: 'sync', code, device_id: DEV, marks: [mark(1, 'done', '09:00:00'), mark(2, 'done', '09:05:00')] });
  ok(r.ok, JSON.stringify(r));
  eq(r.data.marks.map((m) => [m.verse_id, m.done]), [[1, true], [2, true]]);
  eq(env.sheets.marks.data[1][2], '외움');
});
test('같은 request_id는 한 번만 쌓인다', () => {
  const env = fresh();
  const { code } = register(env);
  const m = mark(3, 'done', '10:00:00');
  env.post({ action: 'sync', code, device_id: DEV, marks: [m] });
  env.post({ action: 'sync', code, device_id: DEV, marks: [m] });
  eq(env.sheets.marks.getLastRow(), 2);
});
test('구절마다 가장 늦은 기록을 따른다(취소 뒤 다시 외움)', () => {
  const env = fresh();
  const { code } = register(env);
  const r = env.post({ action: 'sync', code, device_id: DEV, marks: [
    mark(5, 'done', '09:00:00'), mark(5, 'undo', '09:01:00'), mark(6, 'done', '09:02:00'), mark(5, 'done', '09:03:00'),
  ] }).data;
  eq(r.marks.map((m) => [m.verse_id, m.done]), [[6, true], [5, true]]);
});
test('늦게 도착한 옛 기록이 새 기록을 덮지 않는다', () => {
  const env = fresh();
  const { code } = register(env);
  env.post({ action: 'sync', code, device_id: DEV, marks: [mark(7, 'undo', '12:00:00')] });
  const r = env.post({ action: 'sync', code, device_id: DEV, marks: [mark(7, 'done', '11:00:00')] }).data;
  eq(r.marks, [{ verse_id: 7, done: false, at: at('12:00:00') }]);
});
test('빈 sync는 쓰지 않고 상태만 준다', () => {
  const env = fresh();
  const { code } = register(env);
  const r = env.post({ action: 'sync', code, device_id: DEV });
  ok(r.ok);
  eq(env.sheets.marks.getLastRow(), 1);
});
test('별칭 바꾸기', () => {
  const env = fresh();
  const { code } = register(env, { nickname: '하늘' });
  const r = env.post({ action: 'sync', code, device_id: DEV, nickname: '바다' }).data;
  eq(r.nickname, '바다');
});
test('없는 계단 코드로 sync하면 NOT_FOUND', () => {
  const env = fresh();
  const r = env.post({ action: 'sync', code: '사과-1234', device_id: DEV, marks: [] });
  eq(r.error.code, 'NOT_FOUND');
});
test('구절 번호가 1~100 밖이면 INVALID', () => {
  const env = fresh();
  const { code } = register(env);
  eq(env.post({ action: 'sync', code, device_id: DEV, marks: [mark(101, 'done', '09:00:00')] }).error.code, 'INVALID');
  eq(env.post({ action: 'sync', code, device_id: DEV, marks: [mark(0, 'done', '09:00:00')] }).error.code, 'INVALID');
});
test('시각 모양이 틀리면 INVALID', () => {
  const env = fresh();
  const { code } = register(env);
  const r = env.post({ action: 'sync', code, device_id: DEV, marks: [{ verse_id: 1, action: 'done', at: 'yesterday', request_id: rid() }] });
  eq(r.error.code, 'INVALID');
});
test('하루 넘게 앞선 시각은 서버 시각으로 둔다', () => {
  const env = fresh();
  const { code } = register(env);
  const r = env.post({ action: 'sync', code, device_id: DEV, marks: [{ verse_id: 1, action: 'done', at: '2030-01-01T00:00:00+09:00', request_id: rid() }] }).data;
  eq(r.marks[0].at, '2026-10-10T10:00:00+09:00');
});
test('기기 하나가 1분에 20번 넘게 쓰면 RATE_LIMIT, 1분 지나면 풀린다', () => {
  const env = fresh();
  const { code } = register(env); // 1번
  for (let i = 0; i < 19; i++) ok(env.post({ action: 'sync', code, device_id: DEV, marks: [mark(1, i % 2 ? 'undo' : 'done', '09:00:' + String(i).padStart(2, '0'))] }).ok);
  eq(env.post({ action: 'sync', code, device_id: DEV, marks: [mark(2, 'done', '09:01:00')] }).error.code, 'RATE_LIMIT');
  env.tick(61 * 1000);
  ok(env.post({ action: 'sync', code, device_id: DEV, marks: [mark(2, 'done', '09:01:00')] }).ok);
});

console.log('계단 코드로 불러오기');
test('띄어쓰기나 - 없이 넣어도 불러온다', () => {
  const env = fresh();
  const { code } = register(env, { nickname: '별' });
  env.post({ action: 'sync', code, device_id: DEV, marks: [mark(1, 'done', '09:00:00')] });
  const [word, num] = code.split('-');
  for (const typed of [code, word + num, word + ' ' + num, ' ' + code + ' ']) {
    const r = env.get({ action: 'load', code: typed, device_id: 'other_device_1' });
    ok(r.ok, typed + ' ' + JSON.stringify(r));
    eq(r.data.code, code);
    eq(r.data.marks.length, 1);
  }
});
test('없는 코드를 10번 넘게 물으면 그 기기만 잠긴다', () => {
  const env = fresh();
  const { code } = register(env);
  for (let i = 0; i < 10; i++) eq(env.get({ action: 'load', code: '사과-' + (1000 + i), device_id: 'guess_device' }).error.code, 'NOT_FOUND');
  eq(env.get({ action: 'load', code, device_id: 'guess_device' }).error.code, 'LOCKED_OUT');
  ok(env.get({ action: 'load', code, device_id: 'honest_device' }).ok, '다른 기기는 잠기지 않음');
});

console.log('요청 모양');
test('모르는 action은 INVALID', () => {
  const env = fresh();
  eq(env.post({ action: 'nope' }).error.code, 'INVALID');
  eq(env.get({ action: 'nope' }).error.code, 'INVALID');
});
test('JSON이 아닌 본문은 INVALID', () => {
  const env = fresh();
  eq(JSON.parse(env.rawPost('not json')).error.code, 'INVALID');
});

console.log(`\n${pass}개 통과, ${failed}개 실패`);
process.exit(failed ? 1 : 0);
