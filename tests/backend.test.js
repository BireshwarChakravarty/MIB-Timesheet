// Runs backend/Code.gs against in-memory stubs of the Google services.
// Usage: node tests/backend.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

/* ---------- Google service stubs ---------- */
function makeSheet(name) {
  const data = []; // array of rows
  const sheet = {
    name,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(0, ...data.map(r => r.length)),
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    appendRow: (row) => { data.push(row.slice()); },
    deleteRow: (n) => { data.splice(n - 1, 1); },
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: (vals) => {
        for (let i = 0; i < nr; i++) {
          while (data.length < r - 1 + i + 1) data.push([]);
          for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = vals[i][j];
        }
      },
      setValue: (v) => {
        while (data.length < r) data.push([]);
        data[r - 1][c - 1] = v;
      },
      setNumberFormat: () => {},
    }),
    _data: data,
  };
  return sheet;
}
const sheets = {};
const SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getId: () => 'stub',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
  }),
};
const toSigned = (buf) => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
const toBuf = (a) => Buffer.from(a.map(b => (b + 256) % 256));
const Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' },
  getUuid: () => crypto.randomUUID(),
  newBlob: (s) => ({ getBytes: () => toSigned(Buffer.from(s, 'utf8')) }),
  computeDigest: (alg, input) => {
    const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : toBuf(input);
    return toSigned(crypto.createHash('sha256').update(buf).digest());
  },
  formatDate: (d, tz) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return parts;
  },
};
const cacheStore = {};
const CacheService = { getScriptCache: () => ({
  get: (k) => (k in cacheStore ? cacheStore[k] : null),
  put: (k, v) => { cacheStore[k] = v; },
  remove: (k) => { delete cacheStore[k]; },
}) };
const LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
const ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
};
const Session = { getScriptTimeZone: () => 'Asia/Kolkata' };
const Logger = { log: () => {} };

const ctx = vm.createContext({ SpreadsheetApp, Utilities, CacheService, LockService, ContentService, Session, Logger, Date, JSON, Math, Number, String, Object, Array, isNaN, isFinite, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Reports.gs'), 'utf8'), ctx);

/* ---------- helpers ---------- */
function call(action, payload, token) {
  const out = ctx.doPost({ postData: { contents: JSON.stringify({ action, payload, token }) } });
  return JSON.parse(out.getContent());
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
}
const today = Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysAgo = (n) => {
  const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
};
const entry = (over) => Object.assign({ date: today, task: 'Draft press note', category: 'Content writing (English)', platform: 'X', hours: 2, status: 'Completed', notes: '' }, over || {});

/* ---------- setup: admin + roster ---------- */
ctx.setup();
sheets['Roster'].appendRow(['Member A', 'Content Lead']);
sheets['Roster'].appendRow(['Member B', 'Graphic Designer']);
ctx.createUsersFromRoster();
const creds = {};
sheets['Credentials']._data.slice(1).forEach(r => { creds[r[0]] = r[1]; });
check('admin, mib01 and mib02 created with temporary passwords', creds.admin && creds.mib01 && creds.mib02);

/* ---------- login and forced password change ---------- */
check('wrong password rejected', call('login', { userId: 'mib01', password: 'nope' }).ok === false);
check('unknown user gives the same message as wrong password',
  call('login', { userId: 'ghost', password: 'x' }).message === call('login', { userId: 'mib01', password: 'bad' }).message);
let a = call('login', { userId: 'mib01', password: creds.mib01 });
check('member A logs in with temp password', a.ok && a.data.user.mustChange === true);
check('actions blocked until password is changed', call('myEntries', {}, a.data.token).error === 'must_change');
check('weak password rejected', call('changePassword', { currentPassword: creds.mib01, newPassword: 'short1' }, a.data.token).error === 'weak_password');
let ch = call('changePassword', { currentPassword: creds.mib01, newPassword: 'MemberA-Pass-2026' }, a.data.token);
check('password change succeeds', ch.ok === true);
check('old token is dead after password change', call('myEntries', {}, a.data.token).error === 'auth');
const tokA = ch.data.token;

let b = call('login', { userId: 'mib02', password: creds.mib02 });
const tokB = call('changePassword', { currentPassword: creds.mib02, newPassword: 'MemberB-Pass-2026' }, b.data.token).data.token;
let ad = call('login', { userId: 'admin', password: creds.admin });
const tokAdmin = call('changePassword', { currentPassword: creds.admin, newPassword: 'Director-Pass-2026' }, ad.data.token).data.token;
check('three sessions established', tokA && tokB && tokAdmin);

/* ---------- entries and privacy ---------- */
const addA = call('addEntry', entry({ task: 'A private task', hours: 3 }), tokA);
const addB = call('addEntry', entry({ task: 'B private task', hours: 5 }), tokB);
check('A and B can each add an entry', addA.ok && addB.ok);

const listA = call('myEntries', {}, tokA).data.entries;
const listB = call('myEntries', {}, tokB).data.entries;
check('A sees only A\'s entry', listA.length === 1 && listA[0].task === 'A private task');
check('B sees only B\'s entry', listB.length === 1 && listB[0].task === 'B private task');
check('member list responses carry no userId of anyone else', !JSON.stringify(listA).includes('B private') && !JSON.stringify(listA).includes('mib02'));

check('A cannot update B\'s entry', call('updateEntry', Object.assign(entry({ task: 'hijack' }), { entryId: addB.data.entryId }), tokA).error === 'not_found');
check('A cannot delete B\'s entry', call('deleteEntry', { entryId: addB.data.entryId }, tokA).error === 'not_found');
check('B\'s entry unchanged after attacks', call('myEntries', {}, tokB).data.entries[0].task === 'B private task');

for (const act of ['adminEntries', 'adminUsers', 'adminCreateUser', 'adminResetPassword', 'adminSetActive']) {
  check('member blocked from ' + act, call(act, { userId: 'mib02', name: 'X' }, tokA).error === 'forbidden');
}
check('forged role in payload does not elevate', call('adminEntries', { role: 'admin' }, tokA).error === 'forbidden');
check('no token rejected', call('myEntries', {}, '').error === 'auth');
check('garbage token rejected', call('myEntries', {}, 'abc').error === 'auth');

/* ---------- admin visibility ---------- */
const all = call('adminEntries', {}, tokAdmin).data.entries;
check('admin sees both members\' entries with names', all.length === 2 && all.some(e => e.name === 'Member A') && all.some(e => e.name === 'Member B'));
check('admin can list users', call('adminUsers', {}, tokAdmin).data.users.length === 3);

/* ---------- validation ---------- */
check('future date rejected', call('addEntry', entry({ date: daysAgo(-1) }), tokA).ok === false);
check('date older than window rejected', call('addEntry', entry({ date: daysAgo(10) }), tokA).ok === false);
check('hours step enforced', call('addEntry', entry({ hours: 1.3 }), tokA).ok === false);
check('hours max enforced', call('addEntry', entry({ hours: 17 }), tokA).ok === false);
check('unknown category rejected', call('addEntry', entry({ category: 'Hacking' }), tokA).ok === false);
check('daily 24 hour cap enforced', (() => {
  call('addEntry', entry({ hours: 16, task: 'long one' }), tokA);
  return call('addEntry', entry({ hours: 8, task: 'overflow one' }), tokA).ok === false;
})());
check('formula-style text is stored as text, not rejected, and returned verbatim', (() => {
  const r = call('addEntry', entry({ task: '=HYPERLINK("x")', date: daysAgo(1), hours: 1 }), tokA);
  const found = call('myEntries', {}, tokA).data.entries.find(e => e.task.startsWith('='));
  return r.ok && found && found.task === '=HYPERLINK("x")';
})());

/* ---------- update / delete own ---------- */
check('A can update own entry', call('updateEntry', Object.assign(entry({ task: 'A edited', hours: 4 }), { entryId: addA.data.entryId }), tokA).ok);
check('update persisted', call('myEntries', {}, tokA).data.entries.some(e => e.task === 'A edited' && e.hours === 4));
check('A can delete own entry', call('deleteEntry', { entryId: addA.data.entryId }, tokA).ok);
check('deleted entry gone', !call('myEntries', {}, tokA).data.entries.some(e => e.task === 'A edited'));

/* ---------- lockout ---------- */
for (let i = 0; i < 5; i++) call('login', { userId: 'mib02', password: 'wrong' + i });
const locked = call('login', { userId: 'mib02', password: 'MemberB-Pass-2026' });
check('account locks after 5 failures, even with the right password', locked.error === 'locked');

/* ---------- admin user management ---------- */
const created = call('adminCreateUser', { name: 'Member C', teamRole: 'Video Editor' }, tokAdmin);
check('admin creates user with next id', created.ok && created.data.userId === 'mib03' && created.data.tempPassword.length === 12);
check('duplicate id rejected', call('adminCreateUser', { name: 'Dup', userId: 'mib03' }, tokAdmin).ok === false);
const reset = call('adminResetPassword', { userId: 'mib01' }, tokAdmin);
check('reset returns new temp password', reset.ok && reset.data.tempPassword);
check('A\'s old session dies after reset', call('myEntries', {}, tokA).error === 'auth');
check('A can log in with the new temp password and must change it', call('login', { userId: 'mib01', password: reset.data.tempPassword }).data.user.mustChange === true);
check('admin deactivates B', call('adminSetActive', { userId: 'mib02', active: false }, tokAdmin).ok);
check('B\'s session dies on deactivation', call('myEntries', {}, tokB).error === 'auth');
check('admin cannot deactivate self', call('adminSetActive', { userId: 'admin', active: false }, tokAdmin).ok === false);
check('malformed request does not crash', call('', null, null).ok === false);

/* ---------- reports workbook data ---------- */
{
  const r = ctx.reportRange_('week', '2026-10-08'); // a Thursday
  check('report range this week runs Monday to today', r.from === '2026-10-05' && r.to === '2026-10-08');
  const lw = ctx.reportRange_('lastweek', '2026-10-08');
  check('report range last week is the full previous Monday to Sunday', lw.from === '2026-09-28' && lw.to === '2026-10-04');
  check('report range this month starts on the 1st', ctx.reportRange_('month', '2026-10-08').from === '2026-10-01');

  const users = sheets['Users']._data.slice(1).map(row => Object.fromEntries(ctx.USER_COLS.map((c, i) => [c, row[i]])));
  const rows = [
    { entryId: 'e1', userId: 'mib01', date: '2026-10-05', task: '=HYPERLINK("http://x")', category: 'Graphic design', platform: 'X', hours: 9, status: 'Completed', notes: '' },
    { entryId: 'e2', userId: 'mib01', date: '2026-10-06', task: 'Posts', category: 'Social media posting', platform: 'X', hours: 9, status: 'Blocked', notes: '' },
    { entryId: 'e3', userId: 'mib03', date: '2026-10-06', task: 'Edit', category: 'Video editing', platform: 'YouTube', hours: 2, status: 'Completed', notes: '' },
    { entryId: 'e4', userId: 'mib03', date: '2026-09-15', task: 'Old', category: 'Video editing', platform: 'YouTube', hours: 4, status: 'Completed', notes: '' }
  ];
  const d = ctx.buildReportData_(rows, users, ctx.reportRange_('week', '2026-10-08'), '2026-10-08');
  const json = JSON.stringify(d);
  check('report data carries no password salt or hash', !users.some(u => json.includes(String(u.hash)) || json.includes(String(u.salt))));
  check('report period total counts only entries in range', d.kpi.total === 20);
  const a = d.members.find(m => m.userId === 'mib01');
  check('report capacity matches web rules (3 completed workdays x 8h)', a && a.cap === 24 && Math.abs(a.util - 0.75) < 1e-9);
  const c = d.members.find(m => m.userId === 'mib03');
  check('report flags low utilisation', c && c.flag === 'Below 60 percent');
  check('report excludes deactivated members from workload', !d.members.some(m => m.userId === 'mib02'));
  check('report category shares add up to 1', Math.abs(d.categories.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  check('report day series covers Monday to Thursday', d.days.length === 4 && d.days[1].hours === 11);
  const sep = d.monthly.months.indexOf('2026-09'), oct = d.monthly.months.indexOf('2026-10');
  const cm = d.monthly.rows.find(x => x.name === 'Member C');
  check('monthly matrix has 12 months ending this month', d.monthly.months.length === 12 && oct === 11);
  check('monthly matrix sums hours per member per month', cm && cm.values[sep] === 4 && cm.values[oct] === 2 && cm.total === 6);
  check('export list is newest first', d.entries[0].date === '2026-10-06' && d.entries[d.entries.length - 1].date === '2026-09-15');
  check('formula-like text is neutralised for the sheet', ctx.safeText_('=HYPERLINK("x")') === "'=HYPERLINK(\"x\")" && ctx.safeText_('Plain') === 'Plain');
  check('load bar scales to 20 blocks', ctx.loadBar_(1.4, 1.4).length === 20 && ctx.loadBar_(0, 1.4) === '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
