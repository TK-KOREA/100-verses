// 흉내 서버: Apps Script 코드를 메모리 시트로 돌려 화면을 내 컴퓨터에서 시험한다.
// 실행: node gas/test/server.js  →  http://localhost:8100/web/?api=http://localhost:8731/exec
// DELAY=밀리초 로 응답을 늦출 수 있고, FAIL=0.3 처럼 주면 그 비율만큼 구글 오류 페이지를 흉내 낸다.
'use strict';

const http = require('http');
const { makeEnv } = require('./harness');

const env = makeEnv({ realClock: true });
env.call('setupAll');

const PORT = Number(process.env.PORT || 8731);
const DELAY = Number(process.env.DELAY || 300);
const FAIL = Number(process.env.FAIL || 0);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (out) => {
    if (Math.random() < FAIL) {
      res.writeHead(404, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
      res.end('<html>Google 404</html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(out);
  };
  if (url.pathname === '/dump') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ children: env.sheets.children.data, marks: env.sheets.marks.data }));
    return;
  }
  if (req.method === 'GET') {
    const params = Object.fromEntries(url.searchParams);
    setTimeout(() => send(env.rawGet(params)), DELAY);
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => setTimeout(() => send(env.rawPost(body)), DELAY));
  } else {
    res.writeHead(405);
    res.end();
  }
}).listen(PORT, () => console.log(`흉내 서버: http://localhost:${PORT}/exec  (시트 보기: /dump)`));
