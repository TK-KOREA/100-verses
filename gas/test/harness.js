// Apps Script 코드를 Node에서 돌려 보는 흉내 환경. 시트·캐시·속성·잠금을 메모리로 흉내 낸다.
// 실제 시트 동작(서식, 따옴표)은 0단계에서 확인했고, 여기서는 API 논리만 본다.
// 실행: node gas/test/run.js
// five-people-garden/gas/test/harness.js에서 가져와 이 앱의 파일 목록에 맞췄다.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const sh = {
    name,
    rows: 1000,
    cols: 26,
    data: [], // data[r][c], 0부터
    formats: [],
    getName: () => name,
    getMaxRows: () => sh.rows,
    getMaxColumns: () => sh.cols,
    getLastRow() {
      for (let r = sh.data.length - 1; r >= 0; r--) {
        if ((sh.data[r] || []).some((v) => v !== '' && v != null)) return r + 1;
      }
      return 0;
    },
    insertRowsAfter: (after, n) => { sh.rows += n; },
    insertColumnsAfter: (after, n) => { sh.cols += n; },
    deleteColumns: (from, n) => { sh.cols -= n; },
    insertSheet: null,
    setFrozenRows() {},
    setColumnWidth() {},
    getRange(r, c, nr, nc) {
      return makeRange(sh, r, c, nr || 1, nc || 1);
    },
  };
  return sh;
}

// 시트에 쓸 때: '로 시작하면 떼고 글로, 그 밖의 글은 그대로(테스트에서는 따옴표 없는 글이 들어오면 표시).
function store(v) {
  if (typeof v === 'string' && v.charAt(0) === "'") return v.slice(1);
  if (typeof v === 'string' && v !== '') return { unquoted: v };
  return v;
}

function makeRange(sh, r, c, nr, nc) {
  if (r + nr - 1 > sh.rows) throw new Error(`range past max rows: ${sh.name} ${r}+${nr} > ${sh.rows}`);
  const range = {
    getValue() {
      return range.getValues()[0][0];
    },
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = [];
        for (let j = 0; j < nc; j++) {
          const v = ((sh.data[r - 1 + i] || [])[c - 1 + j]);
          row.push(v == null ? '' : (v && v.unquoted !== undefined ? v.unquoted : v));
        }
        out.push(row);
      }
      return out;
    },
    setValues(vals) {
      if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues size mismatch');
      for (let i = 0; i < nr; i++) {
        sh.data[r - 1 + i] = sh.data[r - 1 + i] || [];
        for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = store(vals[i][j]);
      }
      return range;
    },
    setNumberFormats() { return range; },
    setNumberFormat() { return range; },
    setFontWeight() { return range; },
    setDataValidation() { return range; },
    protect() { return { setDescription() { return { setWarningOnly() {} }; } }; },
    clearContent() {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
        if (sh.data[r - 1 + i]) sh.data[r - 1 + i][c - 1 + j] = '';
      }
      return range;
    },
  };
  return range;
}

function makeEnv({ realClock = false } = {}) {
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getId: () => 'SHEET',
    getName: () => '테스트 시트',
    getSheets: () => Object.values(sheets),
    deleteSheet: (sh) => { delete sheets[sh.name]; },
  };
  const cache = new Map();
  const props = new Map();
  const mails = [];
  const triggers = [];
  const fetches = [];
  let fetchReply = () => [200, '{}'];
  let clock = Date.parse('2026-10-10T10:00:00+09:00');

  function fmt(d, tz, pattern) {
    const k = new Date(d.getTime() + 9 * 3600 * 1000).toISOString(); // KST로 옮긴 ISO
    const Y = k.slice(0, 4), M = k.slice(5, 7), D = k.slice(8, 10), h = k.slice(11, 13), m = k.slice(14, 16), s = k.slice(17, 19);
    switch (pattern) {
      case "yyyy-MM-dd'T'HH:mm:ssXXX": return `${Y}-${M}-${D}T${h}:${m}:${s}+09:00`;
      case 'yyyy-MM-dd': return `${Y}-${M}-${D}`;
      case 'yyyyMMdd': return `${Y}${M}${D}`;
      case 'yyyyMMddHH': return `${Y}${M}${D}${h}`;
      case 'yyyyMMddHHmm': return `${Y}${M}${D}${h}${m}`;
      default: throw new Error('pattern ' + pattern);
    }
  }

  const RealDate = Date;
  const nowMs = () => (realClock ? RealDate.now() : clock);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(nowMs()); }
    static now() { return nowMs(); }
  }

  const ctx = {
    Date: FakeDate,
    console,
    JSON, Math, Object, Array, String, Number, RegExp, Error, isFinite,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush() {},
      newDataValidation() {
        const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) };
        return b;
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { if (String(k).length > 250) throw new Error('cache key too long'); cache.set(k, String(v)); },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate: fmt,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => ({ content: s }) }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    Logger: { log() {} },
    ScriptApp: {
      getOAuthToken: () => 'test_oauth_token',
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger(t) { triggers.splice(triggers.indexOf(t), 1); },
      WeekDay: { MONDAY: 'MONDAY' },
      newTrigger: (fn) => {
        const t = { timeBased: () => t, after: () => t, onWeekDay: () => t, atHour: () => t, everyDays: () => t, getHandlerFunction: () => fn, create: () => { triggers.push(t); return t; } };
        return t;
      },
    },
    UrlFetchApp: {
      fetch: (url, opt) => {
        fetches.push({ url, opt });
        const [code, body] = fetchReply(url, opt);
        return { getResponseCode: () => code, getContentText: () => body };
      },
    },
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'app');
  for (const f of ['Config.gs', 'Store.gs', 'Guard.gs', 'Api.gs', 'Progress.gs', 'Setup.gs', 'Push.gs']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }

  // 요청마다 표 캐시를 비운다(실제로는 요청마다 새 실행).
  function fresh() {
    vm.runInContext('tableCache_ = {};', ctx);
  }
  return {
    ctx, sheets, cache, props, mails, triggers, fetches,
    replyFetch(fn) { fetchReply = fn; },
    tick(ms) { clock += ms; },
    get(params) { fresh(); return JSON.parse(ctx.doGet({ parameter: params }).content); },
    post(body) { fresh(); return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content); },
    call(fn) { fresh(); return ctx[fn](); },
    rawGet(params) { fresh(); return ctx.doGet({ parameter: params }).content; },
    rawPost(body) { fresh(); return ctx.doPost({ postData: { contents: body } }).content; },
  };
}

module.exports = { makeEnv };
