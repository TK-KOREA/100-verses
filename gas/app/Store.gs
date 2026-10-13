/**
 * 시트 읽기·쓰기. five-people-garden 0단계 결과를 따른다:
 * appendRow를 쓰지 않고, 행 범위에 서식(@)을 건 뒤 setValues로 쓰며, 글 앞에는 '를 붙인다(수식 주입 막기).
 */

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스크립트가 시트에 붙어 있지 않아요.');
  return ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('탭이 없어요: ' + name + ' (setupAll을 실행해 주세요)');
  return sh;
}

/** 탭 전체를 객체 배열로 읽는다. 각 행에 _row(시트 행 번호)를 붙인다. 한 요청에서 한 번만 읽는다. */
var tableCache_ = {};
function table_(name) {
  if (tableCache_[name]) return tableCache_[name];
  var sh = sheet_(name);
  var cols = SCHEMA[name];
  var last = sh.getLastRow();
  var rows = [];
  if (last >= 2) {
    // 나중에 더한 열이 아직 시트에 없으면 있는 열까지만 읽는다(없는 칸은 빈 값).
    var width = Math.min(cols.length, sh.getMaxColumns());
    var values = sh.getRange(2, 1, last - 1, width).getValues();
    for (var i = 0; i < values.length; i++) {
      var obj = { _row: i + 2 };
      for (var c = 0; c < cols.length; c++) obj[cols[c][0]] = readCell_(values[i][c], cols[c][1]);
      rows.push(obj);
    }
  }
  tableCache_[name] = rows;
  return rows;
}

function readCell_(v, type) {
  if (type === 'n') return Number(v) || 0;
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return v == null ? '' : String(v);
}

function writeCell_(v, type) {
  if (type === 'n') return Number(v) || 0;
  var s = v == null ? '' : String(v);
  return s === '' ? '' : "'" + s;
}

function formats_(name) {
  return SCHEMA[name].map(function (c) { return c[1] === 'n' ? '0' : '@'; });
}

/** 새 행들을 맨 아래에 한 번에 쓴다. 표 캐시에도 넣는다. */
function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var cols = SCHEMA[name];
  // 나중에 더한 열(marks의 round)은 setupAll을 다시 돌리지 않아도 처음 쓸 때 머리글을 붙인다.
  if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  if (sh.getRange(1, cols.length).getValue() === '') writeHead_(sh, name);
  var start = sh.getLastRow() + 1;
  var need = start + objs.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  var fmt = formats_(name);
  var range = sh.getRange(start, 1, objs.length, cols.length);
  range.setNumberFormats(objs.map(function () { return fmt; }));
  range.setValues(objs.map(function (o) {
    return cols.map(function (c) { return writeCell_(o[c[0]], c[1]); });
  }));
  if (tableCache_[name]) {
    objs.forEach(function (o, i) { o._row = start + i; tableCache_[name].push(o); });
  }
}

/** 이미 읽은 행 객체(_row 있음)를 통째로 다시 쓴다. */
function saveRow_(name, obj) {
  var sh = sheet_(name);
  var cols = SCHEMA[name];
  var range = sh.getRange(obj._row, 1, 1, cols.length);
  range.setNumberFormats([formats_(name)]);
  range.setValues([cols.map(function (c) { return writeCell_(obj[c[0]], c[1]); })]);
}

function kstNow_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function cache_() {
  return CacheService.getScriptCache();
}
