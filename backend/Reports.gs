/**
 * MIB Workload Log - reports workbook
 *
 * Add this as a second script file next to Code.gs (Apps Script editor: + > Script, name it Reports).
 *
 * Builds a separate Google Sheet called "MIB Workload Reports" in the same Drive. It holds
 * only work data (entries, names, roles), never the Users tab, so it can be opened, downloaded
 * as Excel or shared view-only without exposing password hashes. The data sheet stays private.
 *
 * Tabs: Dashboard (figures, tables, charts), Monthly (member by month heat map),
 * Attendance (In office, WFH, On leave by day), All entries (flat, filterable table for export),
 * Read me (definitions).
 *
 * Refresh from the "MIB Workload" menu in the data sheet, or run installTriggers() once to
 * refresh every hour and back up weekly.
 */

var RPT = {
  NAME: 'MIB Workload Reports',
  PROP_ID: 'REPORTS_SPREADSHEET_ID',
  DAILY_CAPACITY: 8,          // keep in step with DAILY_CAPACITY in frontend/config.js
  OVER: 1.1,                  // above 110 percent of capacity is flagged over capacity
  LOW: 0.6,                   // below 60 percent is flagged low
  MONTHS: 12,                 // months shown on the Monthly tab
  FONT: 'Roboto',             // any font offered in Sheets; Roboto renders the same in Excel exports as a fallback
  C: {
    crimson: '#a50550', maroon: '#7f043b', ink: '#363636', muted: '#6e6a72', line: '#ebe8ee',
    rose: '#fbeaf1', roseSoft: '#fdf4f8', white: '#ffffff', head: '#faf8f9',
    ok: '#17784f', okT: '#e3f4ec', warn: '#a15c00', warnT: '#fdf0da', bad: '#c0262d', badT: '#fde8e8',
    over: '#e08a2c', none: '#f0eef2'
  }
};

/* ------------------------------------------------------------------ */
/* Menu and triggers                                                   */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MIB Workload')
    .addItem('Refresh reports: this week', 'reportsThisWeek')
    .addItem('Refresh reports: last week', 'reportsLastWeek')
    .addItem('Refresh reports: this month', 'reportsThisMonth')
    .addItem('Refresh reports: last 30 days', 'reportsLast30')
    .addSeparator()
    .addItem('Open reports workbook', 'showReportsLink')
    .addToUi();
}

function reportsThisWeek() { refreshReports_('week', true); }
function reportsLastWeek() { refreshReports_('lastweek', true); }
function reportsThisMonth() { refreshReports_('month', true); }
function reportsLast30() { refreshReports_('30', true); }

/** Used by the hourly trigger. Always reports the current week. */
function refreshReports() { refreshReports_('week', false); }

/** Run once from the editor. Refreshes reports every hour and backs up the data sheet every Monday. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'refreshReports' || fn === 'weeklyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshReports').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  Logger.log('Triggers installed: hourly report refresh, weekly backup on Mondays.');
}

function showReportsLink() {
  var ss = reportsSpreadsheet_();
  var url = ss.getUrl();
  var xlsx = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">' +
    '<p><a href="' + url + '" target="_blank">Open MIB Workload Reports</a></p>' +
    '<p><a href="' + xlsx + '" target="_blank">Download as Excel (.xlsx)</a></p>' +
    '<p style="color:#6e6a72">Both links work only for the account that owns the file.</p></div>'
  ).setWidth(360).setHeight(160);
  SpreadsheetApp.getUi().showModalDialog(html, 'MIB Workload Reports');
}

/* ------------------------------------------------------------------ */
/* Refresh                                                             */
/* ------------------------------------------------------------------ */

function refreshReports_(preset, interactive) {
  var today = todayStr_();
  var range = reportRange_(preset, today);
  var users = readTable_('Users').rows;
  var entries = readTable_('Entries').rows;
  var data = buildReportData_(entries, users, range, today, attendanceRows_());
  var ss = reportsSpreadsheet_();
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy, HH:mm');
  writeDashboard_(sheetFor_(ss, 'Dashboard', 0), data, stamp);
  writeMonthly_(sheetFor_(ss, 'Monthly', 1), data, stamp);
  writeAttendance_(sheetFor_(ss, 'Attendance', 2), data, stamp);
  writeEntries_(sheetFor_(ss, 'All entries', 3), data, stamp);
  writeReadMe_(sheetFor_(ss, 'Read me', 4), ss, stamp);
  ss.setActiveSheet(ss.getSheetByName('Dashboard'));

  if (interactive) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Reports refreshed for ' + range.label.toLowerCase() + '.', 'MIB Workload', 5);
  }
  return ss.getUrl();
}

function reportsSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(RPT.PROP_ID);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* deleted or moved to trash: create a new one */ }
  }
  var ss = SpreadsheetApp.create(RPT.NAME);
  props.setProperty(RPT.PROP_ID, ss.getId());
  return ss;
}

/** Returns an empty sheet with this name at this position, clearing anything left from the last refresh. */
function sheetFor_(ss, name, index) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (index === 0 && first && ss.getSheets().length === 1 && first.getLastRow() === 0 && first.getName() !== name) {
      sh = first.setName(name);
    } else {
      sh = ss.insertSheet(name, index);
    }
  }
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.getBandings().forEach(function (b) { b.remove(); });
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clearConditionalFormatRules();
  var all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart();
  sh.clear();
  all.setFontFamily(RPT.FONT).setFontSize(10).setFontColor(RPT.C.ink).setVerticalAlignment('middle');
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(0);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(index + 1);
  return sh;
}

/* ------------------------------------------------------------------ */
/* Data (pure functions, covered by tests/backend.test.js)             */
/* ------------------------------------------------------------------ */

function reportRange_(preset, today) {
  var dow = new Date(today + 'T00:00:00Z').getUTCDay();
  var monday = addDays_(today, dow === 0 ? -6 : 1 - dow);
  if (preset === 'lastweek') {
    var m = addDays_(monday, -7);
    return { from: m, to: addDays_(m, 6), label: 'Last week' };
  }
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today, label: 'This month' };
  if (preset === '30') return { from: addDays_(today, -29), to: today, label: 'Last 30 days' };
  return { from: monday, to: today, label: 'This week' };
}

function isWeekday_(d) { var w = new Date(d + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6; }

function workdays_(from, to) {
  var n = 0;
  for (var c = from; c <= to; c = addDays_(c, 1)) if (isWeekday_(c)) n++;
  return n;
}

/**
 * Turns raw Users and Entries rows into everything the workbook shows. Mirrors the capacity
 * rules of the director view in frontend/app.js so the numbers match the web dashboard.
 * Only names, roles and work fields are carried over. Salts and hashes never leave Users.
 */
function buildReportData_(entries, users, range, today, attendance) {
  var modeOf = {};
  (attendance || []).forEach(function (a) { modeOf[a.userId + '|' + a.date] = String(a.mode); });
  var people = {};
  users.forEach(function (u) {
    people[u.userId] = { userId: String(u.userId), name: String(u.name), role: String(u.teamRole || ''),
      member: u.role === 'member', active: isTrue_(u.active) };
  });
  var clean = entries.map(function (e) {
    var p = people[e.userId] || { name: String(e.userId), role: '' };
    return { date: String(e.date), userId: String(e.userId), name: p.name, role: p.role, category: String(e.category),
      platform: String(e.platform), task: String(e.task), hours: Number(e.hours) || 0, status: String(e.status),
      notes: String(e.notes || ''), createdAt: String(e.createdAt || ''), updatedAt: String(e.updatedAt || '') };
  });
  var inRange = clean.filter(function (e) { return e.date >= range.from && e.date <= range.to; });

  var through = range.to >= today ? addDays_(today, -1) : range.to;
  var baseDays = through >= range.from ? workdays_(range.from, through) : 0;
  var activeMembers = Object.keys(people).map(function (k) { return people[k]; })
    .filter(function (p) { return p.member && p.active; });

  var members = activeMembers.map(function (p) {
    var baseLeave = 0;
    var es = inRange.filter(function (e) { return e.userId === p.userId; });
    var hours = es.reduce(function (s, e) { return s + e.hours; }, 0);
    var days = {};
    es.forEach(function (e) { days[e.date] = 1; });
    var todayCounts = range.to >= today && range.from <= today && isWeekday_(today) &&
      es.some(function (e) { return e.date === today; }) && modeOf[p.userId + '|' + today] !== 'On leave';
    // Leave days come out of capacity, so a member on leave is not flagged as underloaded.
    var leaveDays = 0, wfhDays = 0, officeDays = 0;
    for (var c0 = range.from; c0 <= range.to && c0 <= today; c0 = addDays_(c0, 1)) {
      var m0 = modeOf[p.userId + '|' + c0];
      if (m0 === 'On leave') { leaveDays++; if (isWeekday_(c0) && c0 <= through) baseLeave++; }
      else if (m0 === 'WFH') wfhDays++;
      else if (m0 === 'In office') officeDays++;
    }
    var capDays = Math.max(0, baseDays - baseLeave) + (todayCounts ? 1 : 0);
    if (hours > 0 && capDays === 0) capDays = 1;
    var cap = capDays * RPT.DAILY_CAPACITY;
    var util = cap ? hours / cap : 0;
    var flag = hours === 0 ? 'Nothing logged' : util > RPT.OVER ? 'Over capacity' : util < RPT.LOW ? 'Below 60 percent' : 'Within range';
    if (hours === 0 && leaveDays > 0) flag = 'On leave';
    return { name: p.name, role: p.role, userId: p.userId, hours: hours, cap: cap, util: util,
      days: Object.keys(days).length, entries: es.length, flag: flag,
      leaveDays: leaveDays, wfhDays: wfhDays, officeDays: officeDays };
  }).sort(function (a, b) { return b.util - a.util || a.name.localeCompare(b.name); });

  var total = inRange.reduce(function (s, e) { return s + e.hours; }, 0);
  var memberDays = members.reduce(function (s, m) { return s + m.days; }, 0);

  function groupBy(key) {
    var g = {};
    inRange.forEach(function (e) { g[e[key]] = (g[e[key]] || 0) + e.hours; });
    return Object.keys(g).map(function (k) { return { label: k, hours: g[k], share: total ? g[k] / total : 0 }; })
      .sort(function (a, b) { return b.hours - a.hours; });
  }

  var dayTotals = {};
  inRange.forEach(function (e) { dayTotals[e.date] = (dayTotals[e.date] || 0) + e.hours; });
  var days = [];
  for (var c = range.from; c <= range.to; c = addDays_(c, 1)) {
    if (isWeekday_(c) || dayTotals[c]) days.push({ date: c, hours: dayTotals[c] || 0 });
  }

  // Monthly: last N months up to the current one, every person with an active account or any hours.
  var months = [];
  var y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
  for (var i = RPT.MONTHS - 1; i >= 0; i--) {
    var yy = y, mm = mo - i;
    while (mm < 1) { mm += 12; yy--; }
    months.push(yy + '-' + ('0' + mm).slice(-2));
  }
  var byPerson = {};
  clean.forEach(function (e) {
    var k = e.date.slice(0, 7);
    if (months.indexOf(k) < 0) return;
    byPerson[e.userId] = byPerson[e.userId] || {};
    byPerson[e.userId][k] = (byPerson[e.userId][k] || 0) + e.hours;
  });
  var monthlyRows = Object.keys(people).map(function (k) { return people[k]; })
    .filter(function (p) { return (p.member && p.active) || byPerson[p.userId]; })
    .map(function (p) {
      var vals = months.map(function (m) { return (byPerson[p.userId] || {})[m] || 0; });
      return { name: p.name, role: p.role, values: vals, total: vals.reduce(function (s, v) { return s + v; }, 0) };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });

  var all = clean.slice().sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name);
  });

  var attDays = [];
  for (var c2 = range.from; c2 <= range.to; c2 = addDays_(c2, 1)) if (isWeekday_(c2) || dayTotals[c2]) attDays.push(c2);
  var attRows = activeMembers.map(function (p) {
    return { name: p.name, role: p.role, modes: attDays.map(function (d) { return modeOf[p.userId + '|' + d] || ''; }) };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  return {
    range: range,
    attendance: { days: attDays, rows: attRows, today: {
      office: activeMembers.filter(function (p) { return modeOf[p.userId + '|' + today] === 'In office'; }).length,
      wfh: activeMembers.filter(function (p) { return modeOf[p.userId + '|' + today] === 'WFH'; }).length,
      leave: activeMembers.filter(function (p) { return modeOf[p.userId + '|' + today] === 'On leave'; }).length
    } },
    kpi: {
      total: total,
      logging: members.filter(function (m) { return m.hours > 0; }).length,
      members: members.length,
      avgDay: memberDays ? total / memberDays : 0,
      over: members.filter(function (m) { return m.flag === 'Over capacity'; }).length
    },
    members: members,
    categories: groupBy('category'),
    platforms: groupBy('platform'),
    statuses: groupBy('status'),
    days: days,
    teamCapacity: activeMembers.length * RPT.DAILY_CAPACITY,
    monthly: { months: months, rows: monthlyRows },
    entries: all
  };
}

/** Text that starts with = + - or @ would run as a formula once written to a cell. A leading quote keeps it text. */
function safeText_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function toDate_(ymd) {
  var p = String(ymd).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function fmtYmd_(ymd, pattern) {
  return Utilities.formatDate(toDate_(ymd), Session.getScriptTimeZone(), pattern || 'd MMM yyyy');
}

/** A bar of block characters scaled so that max fills 20 blocks. Plain text, so it survives Excel and CSV export. */
function loadBar_(value, max) {
  var n = max > 0 ? Math.max(0, Math.min(20, Math.round(value / max * 20))) : 0;
  return n ? new Array(n + 1).join('█') : '';
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function banner_(sh, title, subtitle, width) {
  sh.setRowHeight(1, 54);
  sh.getRange(1, 1, 1, width).merge().setValue('   ' + title).setBackground(RPT.C.crimson).setFontColor(RPT.C.white)
    .setFontSize(18).setFontWeight('bold').setHorizontalAlignment('left').setVerticalAlignment('middle');
  sh.setRowHeight(2, 26);
  sh.getRange(2, 1, 1, width).merge().setValue('   ' + subtitle).setBackground(RPT.C.maroon).setFontColor('#f6d9e6')
    .setFontSize(10);
  sh.setRowHeight(3, 14);
}

function section_(sh, row, col, width, text) {
  sh.setRowHeight(row, 30);
  sh.getRange(row, col, 1, width).merge().setValue(text).setFontSize(12).setFontWeight('bold')
    .setFontColor(RPT.C.maroon).setVerticalAlignment('bottom')
    .setBorder(null, null, true, null, null, null, RPT.C.crimson, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

function tableHeader_(sh, row, col, labels) {
  sh.getRange(row, col, 1, labels.length).setValues([labels]).setBackground(RPT.C.head).setFontColor(RPT.C.muted)
    .setFontSize(9).setFontWeight('bold')
    .setBorder(null, null, true, null, null, null, RPT.C.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(row, 26);
}

function flagColours_(flag) {
  if (flag === 'Over capacity') return [RPT.C.badT, RPT.C.bad];
  if (flag === 'On leave') return [RPT.C.roseSoft, RPT.C.maroon];
  if (flag === 'Below 60 percent') return [RPT.C.warnT, RPT.C.warn];
  if (flag === 'Nothing logged') return [RPT.C.none, RPT.C.muted];
  return [RPT.C.okT, RPT.C.ok];
}

function writeDashboard_(sh, d, stamp) {
  var W = 9, C = RPT.C, r = d.range;
  [180, 160, 80, 80, 90, 150, 60, 130, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setColumnWidth(10, 24);
  for (var k = 11; k <= 18; k++) sh.setColumnWidth(k, 90);
  banner_(sh, 'MIB Workload Report', 'Avian We.  |  ' + r.label + ': ' + fmtYmd_(r.from) + ' to ' + fmtYmd_(r.to) +
    '  |  Refreshed ' + stamp, 18);

  // KPI tiles: label row and figure row, two columns each.
  var tiles = [
    ['Hours logged', d.kpi.total, 'General'],
    ['Members with entries', d.kpi.logging + ' of ' + d.kpi.members, '@'],
    ['Avg hours per member per logged day', d.kpi.avgDay, '0.00'],
    ['Members over capacity', d.kpi.over, '0']
  ];
  sh.setRowHeight(4, 24); sh.setRowHeight(5, 44); sh.setRowHeight(6, 16);
  tiles.forEach(function (t, i) {
    var col = 1 + i * 2, alert = i === 3 && d.kpi.over > 0;
    var bg = alert ? C.crimson : C.roseSoft, fg = alert ? C.white : C.ink;
    sh.getRange(4, col, 1, 2).merge().setValue('  ' + t[0]).setBackground(bg).setFontColor(alert ? '#f6d9e6' : C.muted).setFontSize(9);
    sh.getRange(5, col, 1, 2).merge().setValue(t[1]).setNumberFormat(t[2]).setBackground(bg).setFontColor(fg)
      .setFontSize(22).setFontWeight('bold').setHorizontalAlignment('left');
    sh.getRange(4, col, 2, 2).setBorder(true, true, true, true, null, null, C.white, SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  // Workload by member.
  var row = 7;
  section_(sh, row, 1, W, 'Workload by member');
  tableHeader_(sh, row + 1, 1, ['MEMBER', 'ROLE', 'HOURS', 'CAPACITY', 'UTILISATION', 'LOAD (full bar = 140%)', 'DAYS', 'FLAG', 'OFFICE / WFH / LEAVE']);
  var mStart = row + 2;
  if (d.members.length) {
    sh.getRange(mStart, 1, d.members.length, W).setValues(d.members.map(function (m) {
      return [safeText_(m.name), safeText_(m.role), m.hours, m.cap, m.util, loadBar_(m.util, 1.4), m.days, m.flag,
        m.officeDays + ' / ' + m.wfhDays + ' / ' + m.leaveDays];
    }));
    sh.getRange(mStart, 3, d.members.length, 2).setNumberFormat('General');
    sh.getRange(mStart, 5, d.members.length, 1).setNumberFormat('0%');
    sh.getRange(mStart, 1, d.members.length, 1).setFontWeight('bold');
    sh.getRange(mStart, 2, d.members.length, 1).setFontColor(C.muted);
    d.members.forEach(function (m, i) {
      var fc = flagColours_(m.flag);
      sh.getRange(mStart + i, 6).setFontColor(m.flag === 'Over capacity' ? C.over : C.crimson).setFontSize(8);
      sh.getRange(mStart + i, 8).setBackground(fc[0]).setFontColor(fc[1]).setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center');
      sh.setRowHeight(mStart + i, 26);
    });
    sh.getRange(mStart, 1, d.members.length, W)
      .setBorder(null, null, true, null, null, true, C.line, SpreadsheetApp.BorderStyle.SOLID);
  } else {
    sh.getRange(mStart, 1, 1, W).merge().setValue('No active members yet.').setFontColor(C.muted);
  }
  var mRows = Math.max(1, d.members.length);
  row = mStart + mRows + 1;

  // Hours by category.
  section_(sh, row, 1, 4, 'Hours by category');
  tableHeader_(sh, row + 1, 1, ['CATEGORY', 'HOURS', 'SHARE', '']);
  var cStart = row + 2, cats = d.categories.length ? d.categories : [{ label: 'No entries in this period', hours: 0, share: 0 }];
  sh.getRange(cStart, 1, cats.length, 4).setValues(cats.map(function (c) {
    return [safeText_(c.label), c.hours, c.share, loadBar_(c.share, cats[0].share)];
  }));
  sh.getRange(cStart, 2, cats.length, 1).setNumberFormat('General');
  sh.getRange(cStart, 3, cats.length, 1).setNumberFormat('0%');
  sh.getRange(cStart, 4, cats.length, 1).setFontColor(C.crimson).setFontSize(8);

  // Hours by status, beside category.
  section_(sh, row, 6, 3, 'Hours by status');
  tableHeader_(sh, row + 1, 6, ['STATUS', 'HOURS', 'SHARE']);
  var stats = d.statuses.length ? d.statuses : [{ label: 'None', hours: 0, share: 0 }];
  sh.getRange(cStart, 6, stats.length, 3).setValues(stats.map(function (s) { return [safeText_(s.label), s.hours, s.share]; }));
  sh.getRange(cStart, 7, stats.length, 1).setNumberFormat('General');
  sh.getRange(cStart, 8, stats.length, 1).setNumberFormat('0%');
  row = cStart + Math.max(cats.length, stats.length) + 1;

  // Hours per day.
  section_(sh, row, 1, 4, 'Hours per day');
  tableHeader_(sh, row + 1, 1, ['DAY', 'TEAM HOURS', 'TEAM CAPACITY', '']);
  var dStart = row + 2, days = d.days.length ? d.days : [{ date: d.range.to, hours: 0 }];
  sh.getRange(dStart, 1, days.length, 3).setValues(days.map(function (x) {
    return [fmtYmd_(x.date, 'EEE d MMM'), x.hours, d.teamCapacity];
  }));
  sh.getRange(dStart, 2, days.length, 2).setNumberFormat('General');
  sh.getRange(dStart, 3, days.length, 1).setFontColor(C.muted);

  // Charts on the right, in brand colours.
  // Charts stack in column J, placed by pixel offset from row 4 so they never overlap.
  var anchorCol = 11, offset = 0, gap = 24;
  var memberChartH = Math.max(260, 60 + d.members.length * 28);
  if (d.members.length) {
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(sh.getRange(mStart - 1, 1, d.members.length + 1, 1))
      .addRange(sh.getRange(mStart - 1, 3, d.members.length + 1, 1))
      .setNumHeaders(1).setPosition(4, anchorCol, 0, offset)
      .setOption('title', 'Hours by member').setOption('colors', [C.crimson]).setOption('legend', { position: 'none' })
      .setOption('fontName', RPT.FONT).setOption('titleTextStyle', { color: C.maroon, fontSize: 13, bold: true })
      .setOption('width', 720).setOption('height', memberChartH)
      .setOption('hAxis', { gridlines: { color: C.line }, textStyle: { color: C.muted } })
      .setOption('vAxis', { textStyle: { color: C.ink } })
      .build());
    offset += memberChartH + gap;
  }
  if (d.categories.length) {
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.PIE)
      .addRange(sh.getRange(cStart - 1, 1, d.categories.length + 1, 2))
      .setNumHeaders(1).setPosition(4, anchorCol, 0, offset)
      .setOption('title', 'Share of hours by category').setOption('pieHole', 0.55)
      .setOption('colors', [C.crimson, C.maroon, '#c8357a', '#e889b0', '#5a0a2c', '#f3b6cf', '#8f5a72', '#d4a5b8', C.ink, '#b9b4bd'])
      .setOption('fontName', RPT.FONT).setOption('titleTextStyle', { color: C.maroon, fontSize: 13, bold: true })
      .setOption('pieSliceText', 'percentage').setOption('legend', { position: 'right', textStyle: { color: C.ink } })
      .setOption('width', 720).setOption('height', 300)
      .build());
    offset += 300 + gap;
  }
  if (d.days.length) {
    sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COMBO)
      .addRange(sh.getRange(dStart - 1, 1, d.days.length + 1, 3))
      .setNumHeaders(1).setPosition(4, anchorCol, 0, offset)
      .setOption('title', 'Team hours per day against capacity')
      .setOption('seriesType', 'bars')
      .setOption('series', { 0: { color: C.crimson }, 1: { type: 'line', color: C.ink, lineDashStyle: [6, 4] } })
      .setOption('fontName', RPT.FONT).setOption('titleTextStyle', { color: C.maroon, fontSize: 13, bold: true })
      .setOption('legend', { position: 'bottom' })
      .setOption('vAxis', { gridlines: { color: C.line }, minValue: 0 })
      .setOption('width', 720).setOption('height', 300)
      .build());
  }
  sh.setFrozenRows(2);
}

function writeMonthly_(sh, d, stamp) {
  var C = RPT.C, months = d.monthly.months, rows = d.monthly.rows, width = months.length + 3;
  sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 160);
  for (var i = 0; i < months.length; i++) sh.setColumnWidth(3 + i, 66);
  sh.setColumnWidth(3 + months.length, 80);
  banner_(sh, 'Monthly hours by member', 'Last ' + months.length + ' months, all entries  |  Darker cells mean more hours  |  Refreshed ' + stamp, width);
  tableHeader_(sh, 4, 1, ['MEMBER', 'ROLE'].concat(months.map(function (m) {
    return Utilities.formatDate(toDate_(m + '-01'), Session.getScriptTimeZone(), 'MMM yy').toUpperCase();
  })).concat(['TOTAL']));
  if (!rows.length) {
    sh.getRange(5, 1, 1, width).merge().setValue('No members yet.').setFontColor(C.muted);
    return;
  }
  // Zero months are left blank so the heat map only colours months with hours.
  var blank = function (v) { return v || ''; };
  sh.getRange(5, 1, rows.length, width).setValues(rows.map(function (r) {
    return [safeText_(r.name), safeText_(r.role)].concat(r.values.map(blank)).concat([blank(r.total)]);
  }));
  var totals = ['Team total', ''];
  for (var c = 0; c < months.length; c++) totals.push(blank(rows.reduce(function (s, r) { return s + r.values[c]; }, 0)));
  totals.push(blank(rows.reduce(function (s, r) { return s + r.total; }, 0)));
  var tRow = 5 + rows.length;
  sh.getRange(tRow, 1, 1, width).setValues([totals]).setFontWeight('bold').setBackground(C.roseSoft)
    .setBorder(true, null, null, null, null, null, C.crimson, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange(5, 3, rows.length + 1, months.length + 1).setNumberFormat('General').setHorizontalAlignment('center');
  sh.getRange(5, 1, rows.length, 1).setFontWeight('bold');
  sh.getRange(5, 2, rows.length, 1).setFontColor(C.muted);
  sh.getRange(5, 3 + months.length, rows.length, 1).setFontWeight('bold').setFontColor(C.maroon);
  for (var r = 0; r <= rows.length; r++) sh.setRowHeight(5 + r, 26);

  var heat = sh.getRange(5, 3, rows.length, months.length);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue(C.white, SpreadsheetApp.InterpolationType.NUMBER, '0')
      .setGradientMidpointWithValue('#f3b6cf', SpreadsheetApp.InterpolationType.PERCENTILE, '50')
      .setGradientMaxpointWithValue(C.crimson, SpreadsheetApp.InterpolationType.MAX, '')
      .setRanges([heat]).build()
  ]);
  sh.setFrozenRows(4);
  sh.setFrozenColumns(2);
}

function writeAttendance_(sh, d, stamp) {
  var C = RPT.C, days = d.attendance.days, rows = d.attendance.rows, width = days.length + 2, t = d.attendance.today;
  sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 160);
  for (var i = 0; i < days.length; i++) sh.setColumnWidth(3 + i, 74);
  banner_(sh, 'Attendance', d.range.label + '  |  Today: ' + t.office + ' in office, ' + t.wfh + ' WFH, ' + t.leave + ' on leave  |  Refreshed ' + stamp, Math.max(width, 6));
  tableHeader_(sh, 4, 1, ['MEMBER', 'ROLE'].concat(days.map(function (x) { return fmtYmd_(x, 'EEE d').toUpperCase(); })));
  if (!rows.length || !days.length) {
    sh.getRange(5, 1, 1, Math.max(width, 2)).merge().setValue('No members or days in this period.').setFontColor(C.muted);
    return;
  }
  var label = { 'In office': 'Office', 'WFH': 'WFH', 'On leave': 'Leave' };
  sh.getRange(5, 1, rows.length, width).setValues(rows.map(function (r) {
    return [safeText_(r.name), safeText_(r.role)].concat(r.modes.map(function (m) { return label[m] || ''; }));
  }));
  sh.getRange(5, 1, rows.length, 1).setFontWeight('bold');
  sh.getRange(5, 2, rows.length, 1).setFontColor(C.muted);
  var grid = sh.getRange(5, 3, rows.length, days.length).setHorizontalAlignment('center').setFontWeight('bold').setFontSize(9);
  for (var r0 = 0; r0 < rows.length; r0++) sh.setRowHeight(5 + r0, 26);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Office').setBackground(C.okT).setFontColor(C.ok).setRanges([grid]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('WFH').setBackground('#e6eefb').setFontColor('#2556a8').setRanges([grid]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Leave').setBackground(C.rose).setFontColor(C.maroon).setRanges([grid]).build()
  ]);
  sh.getRange(5, 1, rows.length, width).setBorder(null, null, true, null, null, true, C.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(4);
  sh.setFrozenColumns(2);
}

function writeEntries_(sh, d, stamp) {
  var C = RPT.C;
  var headers = ['Date', 'Member', 'User ID', 'Role', 'Category', 'Platform', 'Task', 'Hours', 'Status', 'Notes', 'Logged at', 'Updated at'];
  [100, 170, 80, 150, 170, 130, 320, 60, 100, 280, 140, 140].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  banner_(sh, 'All entries', d.entries.length + ' entries  |  Use Data > Create a filter, or File > Download for Excel or CSV  |  Refreshed ' + stamp, headers.length);
  var hRow = 4;
  sh.getRange(hRow, 1, 1, headers.length).setValues([headers]);
  if (!d.entries.length) {
    sh.getRange(hRow + 1, 1, 1, headers.length).merge().setValue('No entries yet.').setFontColor(C.muted);
    return;
  }
  var n = d.entries.length, start = hRow + 1;
  // Text columns are set to plain text first, so nothing typed by a member can run as a formula.
  [2, 3, 4, 5, 6, 7, 9, 10].forEach(function (c) { sh.getRange(start, c, n, 1).setNumberFormat('@'); });
  sh.getRange(start, 1, n, headers.length).setValues(d.entries.map(function (e) {
    return [toDate_(e.date), safeText_(e.name), safeText_(e.userId), safeText_(e.role), safeText_(e.category),
      safeText_(e.platform), safeText_(e.task), e.hours, safeText_(e.status), safeText_(e.notes),
      e.createdAt ? new Date(e.createdAt) : '', e.updatedAt ? new Date(e.updatedAt) : ''];
  }));
  sh.getRange(start, 1, n, 1).setNumberFormat('d mmm yyyy');
  sh.getRange(start, 8, n, 1).setNumberFormat('General').setFontWeight('bold').setFontColor(C.maroon);
  sh.getRange(start, 11, n, 2).setNumberFormat('d mmm yyyy hh:mm').setFontColor(C.muted);
  sh.getRange(start, 7, n, 1).setWrap(true);
  sh.getRange(start, 10, n, 1).setWrap(true).setFontColor(C.muted);

  var table = sh.getRange(hRow, 1, n + 1, headers.length);
  var band = table.applyRowBanding(SpreadsheetApp.BandingTheme.PINK, true, false);
  band.setHeaderRowColor(C.maroon).setFirstRowColor(C.white).setSecondRowColor(C.roseSoft);
  sh.getRange(hRow, 1, 1, headers.length).setFontColor(C.white).setFontWeight('bold').setFontSize(9);
  sh.setRowHeight(hRow, 28);
  table.createFilter();

  var statusCol = sh.getRange(start, 9, n, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Completed').setFontColor(C.ok).setBold(true).setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('In progress').setFontColor(C.warn).setBold(true).setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Blocked').setFontColor(C.bad).setBold(true).setRanges([statusCol]).build()
  ]);
  sh.setFrozenRows(hRow);
}

function writeReadMe_(sh, ss, stamp) {
  var C = RPT.C;
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 620);
  banner_(sh, 'How to read this workbook', 'Refreshed ' + stamp + '  |  Built from the private MIB Workload Log data sheet', 2);
  var rows = [
    ['Dashboard', 'Figures, workload by member, category and status split, hours per day, and charts for the period named in the banner.'],
    ['Monthly', 'Hours per member per month for the last 12 months. Darker cells mean more hours.'],
    ['Attendance', 'In office, WFH or On leave as ticked by each member for each day of the period. Blank means not ticked.'],
    ['All entries', 'Every entry as a flat table with a filter on each column. Best tab for exporting.'],
    ['Hours', 'Decimal hours in quarter steps: 0.25 = 15 min, 0.5 = 30 min, 0.75 = 45 min. So 3.75 means 3 hours 45 minutes.'],
    ['Capacity', RPT.DAILY_CAPACITY + ' hours per working day (Monday to Friday) up to yesterday, minus days the member ticked On leave. Today counts once a member has logged today.'],
    ['Utilisation', 'Hours logged divided by capacity.'],
    ['Over capacity', 'Utilisation above ' + Math.round(RPT.OVER * 100) + ' percent.'],
    ['Below 60 percent', 'Utilisation under ' + Math.round(RPT.LOW * 100) + ' percent.'],
    ['Refresh', 'Hourly when installTriggers() has been run. Any time from the MIB Workload menu in the data sheet, which also lets you choose last week, this month or the last 30 days.'],
    ['Excel', 'File > Download > Microsoft Excel (.xlsx). Direct link for the owner: https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx'],
    ['CSV', 'Open All entries, then File > Download > Comma separated values.'],
    ['Privacy', 'This workbook has no passwords or login data. Every row is work data that the director can already see. Share it view-only, only with people who may see every member\'s entries.'],
    ['Edits', 'Changes made here are overwritten on the next refresh. Make a copy to annotate.']
  ];
  sh.getRange(4, 1, rows.length, 2).setValues(rows).setWrap(true).setVerticalAlignment('top');
  sh.getRange(4, 1, rows.length, 1).setFontWeight('bold').setFontColor(C.maroon);
  for (var i = 0; i < rows.length; i++) sh.setRowHeight(4 + i, 40);
  sh.getRange(4, 1, rows.length, 2).setBorder(null, null, true, null, null, true, C.line, SpreadsheetApp.BorderStyle.SOLID);
}
