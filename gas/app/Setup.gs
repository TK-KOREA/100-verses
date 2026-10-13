/**
 * 처음 한 번 편집기에서 setupAll을 실행한다. 탭과 머리글 행을 만든다. 이미 있으면 머리글만 맞춘다.
 */

function setupAll() {
  setupSheets();
  Logger.log('준비 끝: children, marks 탭');
}

/** 머리글 행을 SCHEMA대로 쓴다. */
function writeHead_(sh, name) {
  var cols = SCHEMA[name];
  var head = sh.getRange(1, 1, 1, cols.length);
  head.setNumberFormats([cols.map(function () { return '@'; })]);
  head.setValues([cols.map(function (c) { return writeCell_(c[0], 's'); })]);
  head.setFontWeight('bold');
}

function setupSheets() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = SCHEMA[name];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    writeHead_(sh, name);
    sh.setFrozenRows(1);
    // 데이터 열 서식을 미리 걸어 둔다(글 열은 일반 텍스트).
    var rows = Math.max(sh.getMaxRows() - 1, 1);
    sh.getRange(2, 1, rows, cols.length).setNumberFormats(
      Array.apply(null, Array(rows)).map(function () { return formats_(name); })
    );
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (first && ss.getSheets().length > Object.keys(SCHEMA).length && first.getLastRow() === 0) ss.deleteSheet(first);
}
