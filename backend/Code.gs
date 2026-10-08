/**
 * MIB Workload Log - Google Apps Script backend
 *
 * Container-bound script. Create a Google Sheet, open Extensions > Apps Script,
 * paste this file, run setup(), then deploy as a Web app
 * (Execute as: Me, Who has access: Anyone).
 *
 * The sheet must never be shared with team members. This script is the only door.
 */

var CFG = {
  PBKDF_ROUNDS: 1000,       // time benchmarkHash() in the editor before raising this
  SESSION_TTL: 21600,       // seconds (6 hours, the CacheService maximum)
  MAX_FAILS: 5,             // failed logins before lockout
  LOCK_SECS: 900,           // lockout length in seconds
  EDIT_WINDOW_DAYS: 7,      // members can add, edit or delete entries this many days back
  MAX_HOURS_PER_ENTRY: 16,
  MAX_HOURS_PER_DAY: 24,
  CATEGORIES: [
    'Content writing (English)', 'Content writing (Hindi)', 'Graphic design',
    'Video editing', 'Community Notes', 'Social media posting',
    'Monitoring and reporting', 'Client coordination', 'Internal and admin', 'Other'
  ],
  PLATFORMS: [
    'X', 'Instagram', 'Facebook', 'YouTube', 'WhatsApp channel',
    'Website', 'Multiple platforms', 'Not applicable'
  ],
  STATUSES: ['Completed', 'In progress', 'Blocked'],
  MODES: ['In office', 'WFH', 'On leave']   // work mode a member ticks for each day
};

var USER_COLS = ['userId', 'name', 'role', 'teamRole', 'salt', 'hash', 'active',
  'mustChange', 'sessionEpoch', 'createdAt', 'lastLogin'];
var ENTRY_COLS = ['entryId', 'userId', 'date', 'task', 'category', 'platform',
  'hours', 'status', 'notes', 'createdAt', 'updatedAt'];
var ATT_COLS = ['userId', 'date', 'mode', 'updatedAt'];

/* ------------------------------------------------------------------ */
/* One-time setup (run from the editor)                                */
/* ------------------------------------------------------------------ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, 'Users', USER_COLS);
  ensureSheet_(ss, 'Entries', ENTRY_COLS);
  ensureSheet_(ss, 'Roster', ['name', 'teamRole']);
  ensureSheet_(ss, 'Attendance', ATT_COLS);

  var users = readTable_('Users');
  var hasAdmin = users.rows.some(function (r) { return r.userId === 'admin'; });
  if (!hasAdmin) {
    var temp = tempPassword_();
    appendUser_({ userId: 'admin', name: 'Bireshwar Chakravarty', role: 'admin', teamRole: 'Account Director' }, temp);
    writeCredentials_([['admin', temp]]);
    Logger.log('Admin created. Temporary password is on the Credentials tab. Delete that tab after use.');
  }
}

/**
 * Reads the Roster tab (name, teamRole) and creates one member account per row.
 * Temporary passwords are written to a Credentials tab. Distribute them, then delete the tab.
 */
function createUsersFromRoster() {
  var roster = readTable_('Roster').rows;
  var users = readTable_('Users').rows;
  var existingNames = {};
  users.forEach(function (u) { existingNames[String(u.name).toLowerCase()] = true; });

  var creds = [];
  roster.forEach(function (r) {
    var name = String(r.name || '').trim();
    if (!name || existingNames[name.toLowerCase()]) return;
    var id = nextUserId_();
    var temp = tempPassword_();
    appendUser_({ userId: id, name: name, role: 'member', teamRole: String(r.teamRole || '').trim() }, temp);
    creds.push([id, temp, name]);
    existingNames[name.toLowerCase()] = true;
  });
  if (creds.length) writeCredentials_(creds);
  Logger.log(creds.length + ' accounts created.');
}

/** Run once to see how long one password hash takes in your account. */
function benchmarkHash() {
  var t = Date.now();
  hashPassword_('Benchmark#12345', 'salt');
  Logger.log('One hash took ' + (Date.now() - t) + ' ms at ' + CFG.PBKDF_ROUNDS + ' rounds.');
}

/** Optional: schedule weekly with a time-driven trigger. Keeps 8 weekly copies. */
function weeklyBackup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var file = DriveApp.getFileById(ss.getId());
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  file.makeCopy('MIB Workload Log backup ' + stamp);
  var all = [];
  var it = DriveApp.searchFiles('title contains "MIB Workload Log backup" and trashed = false');
  while (it.hasNext()) all.push(it.next());
  all.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  all.slice(8).forEach(function (f) { f.setTrashed(true); });
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                                */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, data: 'MIB Workload Log API' });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = route_(req);
  } catch (err) {
    Logger.log('doPost error: ' + err);
    out = fail_('server', 'The request could not be processed.');
  }
  return json_(out);
}

function route_(req) {
  var action = String(req.action || '');
  var p = req.payload || {};

  if (action === 'login') return login_(p);

  var sess = getSession_(req.token);
  if (!sess) return fail_('auth', 'Session expired. Sign in again.');

  var user = getUser_(sess.userId);
  if (!user || !isTrue_(user.active) || Number(user.sessionEpoch) !== sess.epoch) {
    return fail_('auth', 'Session expired. Sign in again.');
  }

  if (isTrue_(user.mustChange) && ['changePassword', 'logout', 'me'].indexOf(action) < 0) {
    return fail_('must_change', 'Change your temporary password to continue.');
  }

  var isAdmin = user.role === 'admin';
  switch (action) {
    case 'me': return ok_({ user: publicUser_(user), options: options_() });
    case 'logout': CacheService.getScriptCache().remove(sessKey_(req.token)); return ok_({});
    case 'changePassword': return changePassword_(user, req.token, p);
    case 'myEntries': return myEntries_(user, p);
    case 'addEntry': return withLock_(function () { return addEntry_(user, p); });
    case 'updateEntry': return withLock_(function () { return updateEntry_(user, p); });
    case 'deleteEntry': return withLock_(function () { return deleteEntry_(user, p); });
    case 'setMyDay': return withLock_(function () { return setMyDay_(user, p); });
  }

  // Admin-only actions. The role is read from the Users sheet, never from the client.
  if (!isAdmin) return fail_('forbidden', 'This action is not available for your account.');
  switch (action) {
    case 'adminEntries': return adminEntries_(p);
    case 'adminUsers': return adminUsers_();
    case 'adminCreateUser': return withLock_(function () { return adminCreateUser_(p); });
    case 'adminResetPassword': return withLock_(function () { return adminResetPassword_(p); });
    case 'adminSetActive': return withLock_(function () { return adminSetActive_(user, p); });
  }
  return fail_('bad_action', 'Unknown action.');
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

function login_(p) {
  var id = String(p.userId || '').trim().toLowerCase();
  var pw = String(p.password || '');
  var cache = CacheService.getScriptCache();
  var failKey = 'f:' + id;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= CFG.MAX_FAILS) {
    return fail_('locked', 'Too many failed attempts. Try again in 15 minutes.');
  }

  var user = id ? getUser_(id) : null;
  var salt = user ? String(user.salt) : 'no-such-user-salt';
  var hash = hashPassword_(pw, salt);
  var good = user && isTrue_(user.active) && safeEqual_(hash, String(user.hash));

  if (!good) {
    cache.put(failKey, String(fails + 1), CFG.LOCK_SECS);
    return fail_('login', 'User ID or password is incorrect.');
  }
  cache.remove(failKey);

  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put(sessKey_(token), JSON.stringify({ userId: user.userId, epoch: Number(user.sessionEpoch) }), CFG.SESSION_TTL);
  setUserField_(user._row, 'lastLogin', new Date().toISOString());
  return ok_({ token: token, user: publicUser_(user), options: options_() });
}

function changePassword_(user, token, p) {
  var cur = String(p.currentPassword || '');
  var next = String(p.newPassword || '');
  if (!safeEqual_(hashPassword_(cur, String(user.salt)), String(user.hash))) {
    return fail_('login', 'Current password is incorrect.');
  }
  var problem = passwordProblem_(next);
  if (problem) return fail_('weak_password', problem);
  if (next === cur) return fail_('weak_password', 'The new password must differ from the current one.');

  var salt = Utilities.getUuid() + Utilities.getUuid();
  var epoch = Number(user.sessionEpoch) + 1;
  setUserFields_(user._row, {
    salt: salt, hash: hashPassword_(next, salt), mustChange: false, sessionEpoch: epoch
  });
  // Old sessions die with the epoch bump. Issue a fresh session for this browser.
  CacheService.getScriptCache().remove(sessKey_(token));
  var newToken = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put(sessKey_(newToken),
    JSON.stringify({ userId: user.userId, epoch: epoch }), CFG.SESSION_TTL);
  return ok_({ token: newToken });
}

function passwordProblem_(pw) {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number.';
  return '';
}

function hashPassword_(pw, salt) {
  var bytes = Utilities.newBlob(salt + ':' + pw).getBytes();
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  for (var i = 0; i < CFG.PBKDF_ROUNDS; i++) {
    d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d.concat(bytes));
  }
  return d.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessKey_(token) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token));
  return 's:' + d.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function getSession_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get(sessKey_(token));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function tempPassword_() {
  var upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnpqrstuvwxyz', digits = '23456789';
  var all = upper + lower + digits;
  for (var attempt = 0; attempt < 50; attempt++) {
    var seed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Date.now());
    var out = '';
    for (var i = 0; i < 12; i++) out += all.charAt(((seed[i] + 256) % 256) % all.length);
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[0-9]/.test(out)) return out;
  }
  return 'Temp' + Math.floor(Math.random() * 1e8) + 'xK';
}

/* ------------------------------------------------------------------ */
/* Member actions. Every query is filtered by the caller's userId.     */
/* ------------------------------------------------------------------ */

function myEntries_(user, p) {
  var from = String(p.from || '0000-01-01'), to = String(p.to || '9999-12-31');
  var rows = readTable_('Entries').rows.filter(function (r) {
    return r.userId === user.userId && r.date >= from && r.date <= to;
  });
  var att = attendanceRows_().filter(function (r) {
    return r.userId === user.userId && r.date >= from && r.date <= to;
  }).map(function (r) { return { date: r.date, mode: r.mode }; });
  return ok_({ entries: rows.map(publicEntry_), attendance: att });
}

/** Ticks In office, WFH or On leave for one of the caller's own days. An empty mode clears it. */
function setMyDay_(user, p) {
  var date = String(p.date || ''), mode = String(p.mode || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail_('invalid', 'Enter a valid date.');
  if (mode && CFG.MODES.indexOf(mode) < 0) return fail_('invalid', 'Choose In office, WFH or On leave.');
  var winErr = checkWindow_(date);
  if (winErr) return fail_('invalid', winErr);
  var sheet = attendanceSheet_();
  var t = readTable_('Attendance');
  var row = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (t.rows[i].userId === user.userId && t.rows[i].date === date) { row = t.rows[i]; break; }
  }
  var now = new Date().toISOString();
  if (row && !mode) sheet.deleteRow(row._row);
  else if (row) sheet.getRange(row._row, 1, 1, ATT_COLS.length).setValues([[user.userId, date, mode, now]]);
  else if (mode) sheet.appendRow([user.userId, date, mode, now]);
  return ok_({ date: date, mode: mode });
}

function attendanceSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName('Attendance') || ensureSheet_(ss, 'Attendance', ATT_COLS);
}

function attendanceRows_() {
  attendanceSheet_();
  return readTable_('Attendance').rows;
}

function addEntry_(user, p) {
  var v = validateEntry_(p);
  if (v.error) return fail_('invalid', v.error);
  var dayErr = checkWindow_(v.entry.date);
  if (dayErr) return fail_('invalid', dayErr);
  var dayTotal = sumHoursForDay_(user.userId, v.entry.date, null) + v.entry.hours;
  if (dayTotal > CFG.MAX_HOURS_PER_DAY) return fail_('invalid', 'Total for one day cannot exceed ' + CFG.MAX_HOURS_PER_DAY + ' hours.');

  var now = new Date().toISOString();
  var e = v.entry;
  var id = Utilities.getUuid();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Entries');
  sheet.appendRow([id, user.userId, e.date, e.task, e.category, e.platform, e.hours, e.status, e.notes, now, now]);
  return ok_({ entryId: id });
}

function updateEntry_(user, p) {
  var t = readTable_('Entries');
  var row = findOwned_(t, user.userId, p.entryId);
  if (!row) return fail_('not_found', 'Entry not found.');
  if (checkWindow_(row.date)) return fail_('locked', 'Entries older than ' + CFG.EDIT_WINDOW_DAYS + ' days cannot be changed.');
  var v = validateEntry_(p);
  if (v.error) return fail_('invalid', v.error);
  var dayErr = checkWindow_(v.entry.date);
  if (dayErr) return fail_('invalid', dayErr);
  var dayTotal = sumHoursForDay_(user.userId, v.entry.date, row.entryId) + v.entry.hours;
  if (dayTotal > CFG.MAX_HOURS_PER_DAY) return fail_('invalid', 'Total for one day cannot exceed ' + CFG.MAX_HOURS_PER_DAY + ' hours.');

  var e = v.entry;
  var sheet = t.sheet;
  var values = [[row.entryId, user.userId, e.date, e.task, e.category, e.platform, e.hours, e.status, e.notes,
    row.createdAt, new Date().toISOString()]];
  sheet.getRange(row._row, 1, 1, ENTRY_COLS.length).setValues(values);
  return ok_({});
}

function deleteEntry_(user, p) {
  var t = readTable_('Entries');
  var row = findOwned_(t, user.userId, p.entryId);
  if (!row) return fail_('not_found', 'Entry not found.');
  if (checkWindow_(row.date)) return fail_('locked', 'Entries older than ' + CFG.EDIT_WINDOW_DAYS + ' days cannot be changed.');
  t.sheet.deleteRow(row._row);
  return ok_({});
}

function findOwned_(table, userId, entryId) {
  var id = String(entryId || '');
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    if (r.entryId === id && r.userId === userId) return r;
  }
  return null;
}

function sumHoursForDay_(userId, date, excludeEntryId) {
  return readTable_('Entries').rows.reduce(function (s, r) {
    if (r.userId === userId && r.date === date && r.entryId !== excludeEntryId) return s + Number(r.hours);
    return s;
  }, 0);
}

function validateEntry_(p) {
  var date = String(p.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime())) {
    return { error: 'Enter a valid date.' };
  }
  var task = String(p.task || '').trim();
  if (task.length < 3 || task.length > 200) return { error: 'Describe the work in 3 to 200 characters.' };
  var notes = String(p.notes || '').trim();
  if (notes.length > 500) return { error: 'Notes can be up to 500 characters.' };
  var hours = Number(p.hours);
  if (!isFinite(hours) || hours < 0.25 || hours > CFG.MAX_HOURS_PER_ENTRY || Math.round(hours * 4) !== hours * 4) {
    return { error: 'Hours must be between 0.25 and ' + CFG.MAX_HOURS_PER_ENTRY + ', in steps of 0.25.' };
  }
  if (CFG.CATEGORIES.indexOf(p.category) < 0) return { error: 'Choose a category.' };
  if (CFG.PLATFORMS.indexOf(p.platform) < 0) return { error: 'Choose a platform.' };
  if (CFG.STATUSES.indexOf(p.status) < 0) return { error: 'Choose a status.' };
  return { entry: { date: date, task: task, category: p.category, platform: p.platform,
    hours: hours, status: p.status, notes: notes } };
}

function checkWindow_(date) {
  var today = todayStr_();
  if (date > today) return 'The date cannot be in the future.';
  var limit = addDays_(today, -CFG.EDIT_WINDOW_DAYS);
  if (date < limit) return 'Entries can only be added or changed for the last ' + CFG.EDIT_WINDOW_DAYS + ' days.';
  return '';
}

/* ------------------------------------------------------------------ */
/* Admin actions                                                       */
/* ------------------------------------------------------------------ */

function adminEntries_(p) {
  var from = String(p.from || '0000-01-01'), to = String(p.to || '9999-12-31');
  var names = {};
  readTable_('Users').rows.forEach(function (u) { names[u.userId] = u.name; });
  var rows = readTable_('Entries').rows.filter(function (r) { return r.date >= from && r.date <= to; })
    .map(function (r) {
      var o = publicEntry_(r);
      o.userId = r.userId;
      o.name = names[r.userId] || r.userId;
      return o;
    });
  var att = attendanceRows_().filter(function (r) { return r.date >= from && r.date <= to; })
    .map(function (r) { return { userId: r.userId, date: r.date, mode: r.mode }; });
  return ok_({ entries: rows, attendance: att });
}

function adminUsers_() {
  return ok_({ users: readTable_('Users').rows.map(function (u) {
    var o = publicUser_(u);
    o.active = isTrue_(u.active);
    o.lastLogin = u.lastLogin || '';
    return o;
  }) });
}

function adminCreateUser_(p) {
  var name = String(p.name || '').trim();
  if (name.length < 2 || name.length > 80) return fail_('invalid', 'Enter the member name.');
  var teamRole = String(p.teamRole || '').trim().slice(0, 60);
  var id = String(p.userId || '').trim().toLowerCase() || nextUserId_();
  if (!/^[a-z0-9._-]{3,30}$/.test(id)) return fail_('invalid', 'User ID: 3 to 30 characters, letters, numbers, dot, dash or underscore.');
  if (getUser_(id)) return fail_('invalid', 'That user ID already exists.');
  var temp = tempPassword_();
  appendUser_({ userId: id, name: name, role: 'member', teamRole: teamRole }, temp);
  return ok_({ userId: id, tempPassword: temp });
}

function adminResetPassword_(p) {
  var u = getUser_(String(p.userId || '').toLowerCase());
  if (!u) return fail_('not_found', 'User not found.');
  var temp = tempPassword_();
  var salt = Utilities.getUuid() + Utilities.getUuid();
  setUserFields_(u._row, {
    salt: salt, hash: hashPassword_(temp, salt), mustChange: true,
    sessionEpoch: Number(u.sessionEpoch) + 1
  });
  return ok_({ userId: u.userId, tempPassword: temp });
}

function adminSetActive_(admin, p) {
  var u = getUser_(String(p.userId || '').toLowerCase());
  if (!u) return fail_('not_found', 'User not found.');
  if (u.userId === admin.userId) return fail_('invalid', 'You cannot deactivate your own account.');
  setUserFields_(u._row, { active: !!p.active, sessionEpoch: Number(u.sessionEpoch) + 1 });
  return ok_({});
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  // Plain text format everywhere so typed text such as "=SUM(A1)" is never evaluated as a formula.
  sh.getRange(1, 1, 5000, headers.length).setNumberFormat('@');
  return sh;
}

function readTable_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      var v = values[i][c];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      o[headers[c]] = v;
    }
    if (o[headers[0]] !== '' && o[headers[0]] !== undefined) rows.push(o);
  }
  return { sheet: sheet, headers: headers, rows: rows };
}

function getUser_(userId) {
  var rows = readTable_('Users').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].userId) === userId) return rows[i];
  return null;
}

function appendUser_(u, tempPw) {
  var salt = Utilities.getUuid() + Utilities.getUuid();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  sheet.appendRow([u.userId, u.name, u.role, u.teamRole || '', salt, hashPassword_(tempPw, salt),
    true, true, 1, new Date().toISOString(), '']);
}

function setUserField_(row, field, value) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  sheet.getRange(row, USER_COLS.indexOf(field) + 1).setValue(value);
}

function setUserFields_(row, fields) {
  Object.keys(fields).forEach(function (k) { setUserField_(row, k, fields[k]); });
}

function nextUserId_() {
  var max = 0;
  readTable_('Users').rows.forEach(function (u) {
    var m = /^mib(\d+)$/.exec(String(u.userId));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'mib' + ('0' + (max + 1)).slice(-2);
}

function writeCredentials_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Credentials') || ss.insertSheet('Credentials');
  if (sh.getLastRow() === 0) sh.appendRow(['userId', 'temporaryPassword', 'name']);
  rows.forEach(function (r) { sh.appendRow(r); });
}

function publicUser_(u) {
  return { userId: u.userId, name: u.name, role: u.role, teamRole: u.teamRole, mustChange: isTrue_(u.mustChange) };
}

function publicEntry_(r) {
  return { entryId: r.entryId, date: r.date, task: r.task, category: r.category, platform: r.platform,
    hours: Number(r.hours), status: r.status, notes: r.notes };
}

function options_() {
  return { categories: CFG.CATEGORIES, platforms: CFG.PLATFORMS, statuses: CFG.STATUSES,
    modes: CFG.MODES, editWindowDays: CFG.EDIT_WINDOW_DAYS };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function isTrue_(v) { return v === true || String(v).toLowerCase() === 'true'; }
function ok_(data) { return { ok: true, data: data }; }
function fail_(code, message) { return { ok: false, error: code, message: message }; }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function addDays_(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
