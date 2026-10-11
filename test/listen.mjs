// 말해 보기 맞춰 보기 규칙 시험. 실행: node test/listen.mjs
import { matchSpoken } from '../web/js/listen.js';
const v = '여러분의 모든 염려를 하나님께 맡기십시오. 왜냐하면 하나님께서 여러분을 돌보시기 때문입니다.';
const words = v.split(' ').map((text, idx) => ({ idx, text }));
const cases = [
  ['전부 바르게', '여러분의 모든 염려를 하나님께 맡기십시오 왜냐하면 하나님께서 여러분을 돌보시기 때문입니다', 10],
  ['앞부분만', '여러분의 모든 염려를', 3],
  ['띄어쓰기 다름', '여러분의모든 염려를하나님께', 4],
  ['끝말 다르게 들림', '여러분의 모든 염려를 하나님께 맡기십시요', 5],
  ['한 어절 빠뜨림', '여러분의 염려를 하나님께', 3],
  ['뒤쪽 말만', '하나님께서 여러분을 돌보시기 때문입니다', 4],
  ['엉뚱한 말', '오늘 날씨가 좋아요', 0],
  ['말하는 중(첫 어절)', '여러분의', 1],
  ['말하는 중(둘째에서 끊김)', '여러분의 모든 염', 1],
  ['하나님께서만 말함', '하나님께서', 1],
];
let fail = 0;
for (const [name, spoken, want] of cases) {
  const got = matchSpoken(words, spoken);
  const ok = got.length === want;
  if (!ok) fail++;
  console.log(ok ? '✓' : '✗', name, '→', got.length, 'of', words.length, ok ? '' : `(기대 ${want}) ${JSON.stringify(got)}`);
}
// 뒤쪽 말만 했을 때 앞쪽 "여러분의"(0번)가 열리면 안 된다
const back = matchSpoken(words, '하나님께서 여러분을 돌보시기 때문입니다');
console.log(back.includes(0) ? '✗ 뒤쪽 여러분을이 앞 여러분의를 엶' : '✓ 앞 빈칸 안 열림', JSON.stringify(back));
const only = matchSpoken(words, '하나님께서');
console.log(JSON.stringify(only) === '[6]' ? '✓ 하나님께서 → 6번만' : '✗ 하나님께서 → ' + JSON.stringify(only));
const ps = '하늘에 주님 외에 누가 제게 있겠습니까?\n땅에서도 주님 외에 바랄 것 없습니다.'.split(/\s+/).map((text, idx) => ({ idx, text }));
const all = matchSpoken(ps, '하늘에 주님 외에 누가 제게 있겠습니까 땅에서도 주님 외에 바랄 것 없습니다');
const line2 = matchSpoken(ps, '땅에서도 주님 외에 바랄 것 없습니다');
console.log(all.length === 12 ? '✓ 시편 전부 12' : '✗ 시편 전부 ' + all.length);
console.log(JSON.stringify(line2) === '[6,7,8,9,10,11]' ? '✓ 시편 뒷줄만 → 뒷줄만 열림' : '✗ 시편 뒷줄 ' + JSON.stringify(line2));
const mid = matchSpoken(ps, '하늘에 주님 외에');
console.log(JSON.stringify(mid) === '[0,1,2]' ? '✓ 시편 앞 세 어절' : '✗ 시편 앞 세 어절 ' + JSON.stringify(mid));
process.exit(fail);
