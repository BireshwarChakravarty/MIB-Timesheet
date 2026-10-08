(function () {
  'use strict';

  var CFG = Object.assign({ API_URL: '', TITLE: 'Ministry of Information & Broadcasting Timesheet', SHORT_TITLE: 'MIB Timesheet', DAILY_CAPACITY: 8, WEEKLY_TARGET: 40 }, window.APP_CONFIG || {});
  var DEMO = !CFG.API_URL;
  var TOKEN_KEY = 'mib.token';

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dow(s) { return parse(s).getDay(); } // 0 Sun
  function isWeekday(s) { var d = dow(s); return d !== 0 && d !== 6; }
  function mondayOf(s) { var d = dow(s); return addDays(s, d === 0 ? -6 : 1 - d); }
  function today() { return ymd(new Date()); }
  function workdays(from, to) {
    var n = 0, c = from;
    while (c <= to) { if (isWeekday(c)) n++; c = addDays(c, 1); }
    return n;
  }
  function fmtDay(s) { return parse(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtShort(s) { return parse(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  function h(n) { return String(+Number(n).toFixed(2)); }
  // Hours are stored as decimals in quarter steps (3.75 = 3 hours 45 minutes). Show them as hours and minutes.
  function hm(n) {
    var mins = Math.round(Number(n) * 60), hh = Math.floor(mins / 60), mm = mins % 60;
    if (!mins) return '0h';
    return (hh ? hh + 'h' : '') + (hh && mm ? ' ' : '') + (mm ? mm + 'm' : '');
  }
  function sum(arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    if (p.length > 1 && /^\d+$/.test(p[p.length - 1])) return p[p.length - 1].slice(-2);
    return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function greeting() {
    var hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  }
  function statusClass(s) { return s === 'Completed' ? 'ok' : s === 'Blocked' ? 'bad' : 'warn'; }
  function statusBadge(s) {
    var cls = statusClass(s);
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Demo backend. Simulates the Apps Script API in this browser only.   */
  /* The real rules are enforced and tested in backend/Code.gs.          */
  /* ------------------------------------------------------------------ */
  var Mock = (function () {
    var KEY = 'mibdemo.v3'; // bump to give every browser fresh sample data
    var OPTIONS = {
      categories: ['Content writing (English)', 'Content writing (Hindi)', 'Graphic design', 'Video editing',
        'Community Notes', 'Social media posting', 'Monitoring and reporting', 'Client coordination',
        'Internal and admin', 'Other'],
      platforms: ['X', 'Instagram', 'Facebook', 'YouTube', 'WhatsApp channel', 'Website', 'Multiple platforms', 'Not applicable'],
      statuses: ['Completed', 'In progress', 'Blocked'],
      modes: ['In office', 'WFH', 'On leave'],
      editWindowDays: 7
    };
    var ROLES = ['Team Lead', 'Content Lead', 'Social Media Executive', 'English Content Writer',
      'Hindi Content Writer', 'Graphic Designer', 'Video Editor', 'Social Media Executive'];
    var TASKS = {
      'Team Lead': [['Reviewed weekly content calendar', 'Internal and admin', 'Not applicable'], ['Approval round on scheduled posts', 'Client coordination', 'Multiple platforms'], ['Prepared status update for ministry', 'Monitoring and reporting', 'Not applicable']],
      'Content Lead': [['Edited and approved post copy', 'Content writing (English)', 'X'], ['Briefed writers on campaign theme', 'Internal and admin', 'Not applicable'], ['Reviewed Hindi and English versions', 'Content writing (Hindi)', 'Multiple platforms']],
      'Social Media Executive': [['Scheduled and published posts', 'Social media posting', 'X'], ['Responded to mentions and queries', 'Social media posting', 'Instagram'], ['Compiled daily monitoring report', 'Monitoring and reporting', 'Multiple platforms']],
      'English Content Writer': [['Drafted post copy for calendar', 'Content writing (English)', 'X'], ['Wrote explainer thread', 'Content writing (English)', 'X'], ['Drafted Community Note proposals', 'Community Notes', 'X']],
      'Hindi Content Writer': [['Hindi adaptation of post copy', 'Content writing (Hindi)', 'X'], ['Drafted Hindi caption set', 'Content writing (Hindi)', 'Instagram'], ['Proofread Hindi creatives', 'Content writing (Hindi)', 'Multiple platforms']],
      'Graphic Designer': [['Designed carousel for campaign', 'Graphic design', 'Instagram'], ['Resized creatives for platforms', 'Graphic design', 'Multiple platforms'], ['Revised graphics after feedback', 'Graphic design', 'X']],
      'Video Editor': [['Edited reel for approval', 'Video editing', 'Instagram'], ['Added subtitles to video', 'Video editing', 'YouTube'], ['Exported and uploaded final cut', 'Video editing', 'YouTube']]
    };
    var db, rng;

    function mulberry(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    function seed() {
      rng = mulberry(20261009);
      var users = [{ userId: 'admin', name: 'Bireshwar Chakravarty', role: 'admin', teamRole: 'Account Director', password: 'Admin@123', active: true, mustChange: false, lastLogin: '' }];
      var load = { mib03: 10.8, mib06: 4.2, mib05: 8.6 };
      for (var i = 1; i <= 8; i++) {
        var id = 'mib' + pad(i);
        users.push({ userId: id, name: 'Team Member ' + pad(i), role: 'member', teamRole: ROLES[i - 1],
          password: 'Welcome@01', active: true, mustChange: i === 8,
          lastLogin: i === 8 ? '' : new Date(Date.now() - (i * 5 + 1) * 3600000).toISOString() });
      }
      var entries = [], attendance = [], t = today(), n = 0;
      // Sample leave: one member is on leave today, another took a day off two weeks ago.
      var leave = {}; leave['mib07|' + t] = 1; leave['mib02|' + addDays(mondayOf(t), -14)] = 1;
      users.forEach(function (u) {
        if (u.role !== 'member' || u.mustChange) return;
        var key = ROLES[0] && u.teamRole;
        var pool = TASKS[key] || TASKS['Social Media Executive'];
        for (var d = 27; d >= 0; d--) {
          var day = addDays(t, -d);
          if (!isWeekday(day)) continue;
          if (leave[u.userId + '|' + day]) { attendance.push({ userId: u.userId, date: day, mode: 'On leave' }); continue; }
          if (day === t && rng() < 0.5) continue;
          attendance.push({ userId: u.userId, date: day, mode: rng() < 0.24 ? 'WFH' : 'In office' });
          var target = (load[u.userId] || 7.4) + (rng() - 0.5) * 1.6;
          var parts = Math.min(pool.length, 2 + Math.floor(rng() * 2)), left = Math.round(target * 4) / 4;
          var order = pool.map(function (_, ix) { return ix; }).sort(function () { return rng() - 0.5; });
          for (var p = 0; p < parts && left > 0.24; p++) {
            var hrs = p === parts - 1 ? left : Math.max(0.5, Math.round(left / (parts - p) * 4) / 4);
            hrs = Math.min(hrs, left); left = Math.round((left - hrs) * 4) / 4;
            var task = pool[order[p]];
            var st = rng() < 0.82 ? 'Completed' : rng() < 0.7 ? 'In progress' : 'Blocked';
            entries.push({ entryId: 'e' + (++n), userId: u.userId, date: day, task: task[0], category: task[1],
              platform: task[2], hours: hrs, status: st, notes: '' });
          }
        }
      });
      return { seedDay: t, users: users, entries: entries, attendance: attendance, sessions: {}, fails: {}, nextEntry: n + 1 };
    }
    function load() {
      try { localStorage.removeItem('mibdemo.v1'); localStorage.removeItem('mibdemo.v2'); } catch (e) { /* ignore */ }
      try {
        var r = JSON.parse(localStorage.getItem(KEY));
        if (r && r.seedDay === today()) return r;
      } catch (e) { /* ignore */ }
      return seed();
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
    function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } db = seed(); save(); }
    function rand(len) { var s = ''; var c = 'abcdefghjkmnpqrstuvwxyz23456789'; for (var i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
    function tempPw() { return 'Tp' + rand(8) + 'A7'; }
    function ok(d) { return { ok: true, data: d }; }
    function fail(c, m) { return { ok: false, error: c, message: m }; }
    function pub(u) { return { userId: u.userId, name: u.name, role: u.role, teamRole: u.teamRole, mustChange: !!u.mustChange }; }
    function pubEntry(e) { return { entryId: e.entryId, date: e.date, task: e.task, category: e.category, platform: e.platform, hours: e.hours, status: e.status, notes: e.notes }; }
    function userBy(id) { return db.users.filter(function (u) { return u.userId === id; })[0]; }
    function pwProblem(pw) {
      if (pw.length < 10) return 'Use at least 10 characters.';
      if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number.';
      return '';
    }
    function validate(p) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) return { error: 'Enter a valid date.' };
      var task = String(p.task || '').trim();
      if (task.length < 3 || task.length > 200) return { error: 'Describe the work in 3 to 200 characters.' };
      var notes = String(p.notes || '').trim();
      if (notes.length > 500) return { error: 'Notes can be up to 500 characters.' };
      var hrs = Number(p.hours);
      if (!isFinite(hrs) || hrs < 0.25 || hrs > 16 || Math.round(hrs * 4) !== hrs * 4) return { error: 'Hours must be between 0.25 and 16, in steps of 0.25.' };
      if (OPTIONS.categories.indexOf(p.category) < 0) return { error: 'Choose a category.' };
      if (OPTIONS.platforms.indexOf(p.platform) < 0) return { error: 'Choose a platform.' };
      if (OPTIONS.statuses.indexOf(p.status) < 0) return { error: 'Choose a status.' };
      return { entry: { date: p.date, task: task, category: p.category, platform: p.platform, hours: hrs, status: p.status, notes: notes } };
    }
    function windowErr(date) {
      var t = today();
      if (date > t) return 'The date cannot be in the future.';
      if (date < addDays(t, -OPTIONS.editWindowDays)) return 'Entries can only be added or changed for the last ' + OPTIONS.editWindowDays + ' days.';
      return '';
    }
    function dayTotal(uid, date, except) {
      return sum(db.entries.filter(function (e) { return e.userId === uid && e.date === date && e.entryId !== except; }), function (e) { return e.hours; });
    }

    function handle(action, p, token) {
      p = p || {};
      if (!db) db = load();
      if (action === 'login') {
        var id = String(p.userId || '').trim().toLowerCase();
        if ((db.fails[id] || 0) >= 5) return fail('locked', 'Too many failed attempts. Try again in 15 minutes.');
        var u = userBy(id);
        if (!u || !u.active || u.password !== String(p.password || '')) {
          db.fails[id] = (db.fails[id] || 0) + 1; save();
          return fail('login', 'User ID or password is incorrect.');
        }
        delete db.fails[id];
        u.lastLogin = new Date().toISOString();
        var tk = rand(40); db.sessions[tk] = u.userId; save();
        return ok({ token: tk, user: pub(u), options: OPTIONS });
      }
      var uid = db.sessions[token];
      var user = uid && userBy(uid);
      if (!user || !user.active) return fail('auth', 'Session expired. Sign in again.');
      if (user.mustChange && ['changePassword', 'logout', 'me'].indexOf(action) < 0) return fail('must_change', 'Change your temporary password to continue.');
      var admin = user.role === 'admin', e, list;
      switch (action) {
        case 'me': return ok({ user: pub(user), options: OPTIONS });
        case 'logout': delete db.sessions[token]; save(); return ok({});
        case 'changePassword':
          if (user.password !== String(p.currentPassword || '')) return fail('login', 'Current password is incorrect.');
          var prob = pwProblem(String(p.newPassword || ''));
          if (prob) return fail('weak_password', prob);
          if (p.newPassword === p.currentPassword) return fail('weak_password', 'The new password must differ from the current one.');
          user.password = p.newPassword; user.mustChange = false; save();
          return ok({ token: token });
        case 'myEntries':
          list = db.entries.filter(function (x) { return x.userId === user.userId && x.date >= (p.from || '0000') && x.date <= (p.to || '9999'); });
          return ok({ entries: list.map(pubEntry), attendance: db.attendance.filter(function (x) {
            return x.userId === user.userId && x.date >= (p.from || '0000') && x.date <= (p.to || '9999');
          }).map(function (x) { return { date: x.date, mode: x.mode }; }) });
        case 'setMyDay': {
          var md = String(p.date || ''), mm = String(p.mode || '');
          if (mm && OPTIONS.modes.indexOf(mm) < 0) return fail('invalid', 'Choose In office, WFH or On leave.');
          var mwe = windowErr(md); if (mwe) return fail('invalid', mwe);
          db.attendance = db.attendance.filter(function (x) { return !(x.userId === user.userId && x.date === md); });
          if (mm) db.attendance.push({ userId: user.userId, date: md, mode: mm });
          save(); return ok({ date: md, mode: mm });
        }
        case 'addEntry': {
          var v = validate(p); if (v.error) return fail('invalid', v.error);
          var we = windowErr(v.entry.date); if (we) return fail('invalid', we);
          if (dayTotal(user.userId, v.entry.date, null) + v.entry.hours > 24) return fail('invalid', 'Total for one day cannot exceed 24 hours.');
          e = Object.assign({ entryId: 'e' + (db.nextEntry++), userId: user.userId }, v.entry);
          db.entries.push(e); save(); return ok({ entryId: e.entryId });
        }
        case 'updateEntry': {
          e = db.entries.filter(function (x) { return x.entryId === p.entryId && x.userId === user.userId; })[0];
          if (!e) return fail('not_found', 'Entry not found.');
          if (windowErr(e.date)) return fail('locked', 'Entries older than ' + OPTIONS.editWindowDays + ' days cannot be changed.');
          var v2 = validate(p); if (v2.error) return fail('invalid', v2.error);
          var we2 = windowErr(v2.entry.date); if (we2) return fail('invalid', we2);
          if (dayTotal(user.userId, v2.entry.date, e.entryId) + v2.entry.hours > 24) return fail('invalid', 'Total for one day cannot exceed 24 hours.');
          Object.assign(e, v2.entry); save(); return ok({});
        }
        case 'deleteEntry': {
          e = db.entries.filter(function (x) { return x.entryId === p.entryId && x.userId === user.userId; })[0];
          if (!e) return fail('not_found', 'Entry not found.');
          if (windowErr(e.date)) return fail('locked', 'Entries older than ' + OPTIONS.editWindowDays + ' days cannot be changed.');
          db.entries = db.entries.filter(function (x) { return x !== e; }); save(); return ok({});
        }
      }
      if (!admin) return fail('forbidden', 'This action is not available for your account.');
      switch (action) {
        case 'adminEntries':
          list = db.entries.filter(function (x) { return x.date >= (p.from || '0000') && x.date <= (p.to || '9999'); }).map(function (x) {
            var o = pubEntry(x); o.userId = x.userId; o.name = (userBy(x.userId) || {}).name || x.userId; return o;
          });
          return ok({ entries: list, attendance: db.attendance.filter(function (x) { return x.date >= (p.from || '0000') && x.date <= (p.to || '9999'); }) });
        case 'adminUsers':
          return ok({ users: db.users.map(function (x) { var o = pub(x); o.active = x.active; o.lastLogin = x.lastLogin; return o; }) });
        case 'adminCreateUser': {
          var name = String(p.name || '').trim();
          if (name.length < 2) return fail('invalid', 'Enter the member name.');
          var nid = String(p.userId || '').trim().toLowerCase();
          if (!nid) { var mx = 0; db.users.forEach(function (x) { var m = /^mib(\d+)$/.exec(x.userId); if (m) mx = Math.max(mx, +m[1]); }); nid = 'mib' + pad(mx + 1); }
          if (!/^[a-z0-9._-]{3,30}$/.test(nid)) return fail('invalid', 'User ID: 3 to 30 characters, letters, numbers, dot, dash or underscore.');
          if (userBy(nid)) return fail('invalid', 'That user ID already exists.');
          var tp = tempPw();
          db.users.push({ userId: nid, name: name, role: 'member', teamRole: String(p.teamRole || '').trim(), password: tp, active: true, mustChange: true, lastLogin: '' });
          save(); return ok({ userId: nid, tempPassword: tp });
        }
        case 'adminResetPassword': {
          var ru = userBy(String(p.userId || '').toLowerCase());
          if (!ru) return fail('not_found', 'User not found.');
          ru.password = tempPw(); ru.mustChange = true;
          Object.keys(db.sessions).forEach(function (k) { if (db.sessions[k] === ru.userId) delete db.sessions[k]; });
          save(); return ok({ userId: ru.userId, tempPassword: ru.password });
        }
        case 'adminSetActive': {
          var au = userBy(String(p.userId || '').toLowerCase());
          if (!au) return fail('not_found', 'User not found.');
          if (au.userId === user.userId) return fail('invalid', 'You cannot deactivate your own account.');
          au.active = !!p.active;
          if (!au.active) Object.keys(db.sessions).forEach(function (k) { if (db.sessions[k] === au.userId) delete db.sessions[k]; });
          save(); return ok({});
        }
      }
      return fail('bad_action', 'Unknown action.');
    }
    return { handle: function (a, p, t) { return new Promise(function (res) { setTimeout(function () { res(handle(a, p, t)); }, 120); }); }, reset: reset };
  })();

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */
  function api(action, payload) {
    var token = sessionStorage.getItem(TOKEN_KEY) || '';
    var call;
    if (DEMO) {
      call = Mock.handle(action, payload, token);
    } else {
      call = fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {}, token: token })
      }).then(function (r) { return r.json(); }).catch(function () {
        return { ok: false, error: 'network', message: 'Cannot reach the server. Check your connection and try again.' };
      });
    }
    return call.then(function (res) {
      if (!res.ok && res.error === 'auth' && action !== 'login') { signOutLocal('Session expired. Sign in again.'); }
      return res;
    });
  }

  /* ------------------------------------------------------------------ */
  /* State and shell                                                     */
  /* ------------------------------------------------------------------ */
  var S = { user: null, options: null, admin: null, member: null };
  var app = $('#app');

  function signOutLocal(msg) {
    sessionStorage.removeItem(TOKEN_KEY);
    S.user = null; S.admin = null; S.member = null;
    renderLogin(msg || '');
  }

  function logoImg(kind) {
    return '<img class="logo-' + (kind || 'mark') + '" src="assets/' + (kind === 'full' ? 'logo.png' : 'logo-mark.png') + '" alt="Avian We." onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'">' +
      '<span class="lockup" style="display:none"><span class="lk-avian">AVIAN</span><span class="lk-we">We.</span></span>';
  }

  function header() {
    var u = S.user;
    return '<header class="topbar"><div class="topbar-inner">' +
      '<div class="brand">' + logoImg('mark') + '<span class="brand-sep"></span><span class="brand-title"><span class="t-full">' + esc(CFG.TITLE) + '</span><span class="t-short">' + esc(CFG.SHORT_TITLE) + '</span></span></div>' +
      '<div class="who"><span class="avatar" aria-hidden="true">' + esc(initials(u.name)) + '</span>' +
      '<div><strong>' + esc(u.name) + '</strong><span>' + esc(u.teamRole || (u.role === 'admin' ? 'Director' : 'Member')) + '</span></div>' +
      '<button class="linkbtn" id="btnPw" type="button">Change password</button>' +
      '<button class="btn small secondary" id="btnOut" type="button">Sign out</button></div></div></header>';
  }

  function bindHeader() {
    $('#btnOut').addEventListener('click', function () {
      api('logout').then(function () { signOutLocal(''); });
    });
    $('#btnPw').addEventListener('click', function () { renderChangePassword(false); });
  }

  /* ------------------------------------------------------------------ */
  /* Login and password screens                                          */
  /* ------------------------------------------------------------------ */
  function renderLogin(msg) {
    var demo = DEMO ? '<div class="demo-note"><b>Demo mode</b>Sample data, stored only in this browser.' +
      '<ul><li>Director view: <code>admin</code> / <code>Admin@123</code></li>' +
      '<li>Member view: <code>mib01</code> to <code>mib07</code> / <code>Welcome@01</code></li>' +
      '<li>First sign-in flow: <code>mib08</code> / <code>Welcome@01</code></li></ul>' +
      '<button class="linkbtn" id="btnReset" type="button" style="color:var(--plum)">Reset demo data</button></div>' : '';
    app.innerHTML = '<div class="login">' +
      '<aside class="login-aside"><div class="aside-tag"><b>Ministry of Information &amp; Broadcasting</b><span>Government Practice</span><span>Avian We.</span></div>' +
      '<div class="aside-copy"><h1>Log the work.<br>See the load.</h1><p>Log your daily tasks and time. Your entries stay private.</p></div>' +
      '<div class="glass" aria-hidden="true"><div class="glass-top"><div><small>This week</small><b>166 h</b></div><span class="glass-pill">On track</span></div>' +
      '<div class="glass-bars">' + [['Mon', 62], ['Tue', 80], ['Wed', 74], ['Thu', 91], ['Fri', 48]].map(function (b) {
        return '<div><i style="height:' + b[1] + '%"></i><span>' + b[0] + '</span></div>'; }).join('') + '</div>' +
      '<div class="glass-foot"><span class="glass-faces"><em>TL</em><em>CW</em><em>GD</em><em>VE</em></span><small>21 members logging</small></div></div>' +
      '<small>Ministry of Information &amp; Broadcasting Timesheet &copy;Avian We.</small></aside>' +
      '<main class="login-main"><form class="login-box" id="loginForm" novalidate>' +
      '<div class="login-logo">' + logoImg('full') + '</div>' +
      '<p class="eyebrow">Ministry of Information &amp; Broadcasting Timesheet</p><h2>Sign in</h2><p class="muted login-sub">Enter your user ID and password to continue.</p>' +
      '<div class="field"><label for="uid">User ID</label><input id="uid" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>' +
      '<div class="field"><label for="pw">Password</label><div class="pw-wrap"><input id="pw" type="password" autocomplete="current-password" required>' +
      '<button class="pw-toggle" id="pwToggle" type="button" aria-label="Show password" aria-pressed="false"></button></div></div>' +
      '<p class="err" id="loginErr" role="alert">' + esc(msg || '') + '</p>' +
      '<button class="btn" type="submit" id="loginBtn">Sign in</button>' + demo +
      '</form></main></div>';
    var uid = $('#uid'); uid.focus();
    $('#pwToggle').addEventListener('click', function () {
      var f = $('#pw'), show = f.type === 'password';
      f.type = show ? 'text' : 'password';
      this.setAttribute('aria-pressed', show); this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    var rb = $('#btnReset');
    if (rb) rb.addEventListener('click', function () { Mock.reset(); toast('Demo data reset'); });
    $('#loginForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var b = $('#loginBtn'), er = $('#loginErr');
      if (!uid.value.trim() || !$('#pw').value) { er.textContent = 'Enter your user ID and password.'; return; }
      b.disabled = true; b.textContent = 'Signing in';
      api('login', { userId: uid.value, password: $('#pw').value }).then(function (res) {
        b.disabled = false; b.textContent = 'Sign in';
        if (!res.ok) { er.textContent = res.message; return; }
        sessionStorage.setItem(TOKEN_KEY, res.data.token);
        S.user = res.data.user; S.options = res.data.options;
        if (S.user.mustChange) renderChangePassword(true); else renderHome();
      });
    });
  }

  function renderChangePassword(forced) {
    app.innerHTML = (forced ? '' : header()) + '<div class="' + (forced ? 'login-main' : 'page') + '"' + (forced ? ' style="min-height:100vh"' : '') + '>' +
      '<form class="login-box" id="pwForm" novalidate style="' + (forced ? '' : 'max-width:420px') + '">' +
      (forced ? '<div class="login-logo">' + logoImg('full') + '</div>' : '') +
      '<h2>' + (forced ? 'Set your password' : 'Change password') + '</h2>' +
      (forced ? '<p class="muted" style="margin:6px 0 16px">Replace the temporary password before you continue.</p>' : '<div style="height:12px"></div>') +
      '<div class="field"><label for="cp">' + (forced ? 'Temporary password' : 'Current password') + '</label><input id="cp" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" required><div class="hint">At least 10 characters, with letters and numbers.</div></div>' +
      '<div class="field"><label for="np2">Repeat new password</label><input id="np2" type="password" autocomplete="new-password" required></div>' +
      '<p class="err" id="pwErr" role="alert"></p>' +
      '<div class="form-actions"><button class="btn" type="submit">Save password</button>' +
      (forced ? '' : '<button class="btn secondary" type="button" id="pwCancel">Cancel</button>') + '</div></form></div>';
    if (!forced) bindHeader();
    $('#cp').focus();
    var c = $('#pwCancel'); if (c) c.addEventListener('click', renderHome);
    $('#pwForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var er = $('#pwErr');
      if ($('#np').value !== $('#np2').value) { er.textContent = 'The new passwords do not match.'; return; }
      api('changePassword', { currentPassword: $('#cp').value, newPassword: $('#np').value }).then(function (res) {
        if (!res.ok) { er.textContent = res.message; return; }
        sessionStorage.setItem(TOKEN_KEY, res.data.token);
        S.user.mustChange = false; toast('Password saved'); renderHome();
      });
    });
  }

  function renderHome() { if (S.user.role === 'admin') renderAdmin(); else renderMember(); }

  /* ------------------------------------------------------------------ */
  /* Member view                                                         */
  /* ------------------------------------------------------------------ */
  function optionList(arr, sel, placeholder) {
    return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      arr.map(function (o) { return '<option' + (o === sel ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }

  function renderMember() {
    S.member = S.member || { editing: null, entries: [], attendance: [], view: '7', modeDay: today() };
    var t = today(), win = S.options.editWindowDays;
    app.innerHTML = header() + '<main class="page"><div class="page-head"><div><p class="eyebrow">' + esc(greeting() + ', ' + firstName(S.user.name)) + '</p><h1>Log your work</h1>' +
      '<p>Record each task and the time it took. Only you and the account director can see your entries.</p></div>' +
      '<span class="date-chip">' + esc(fmtDay(t)) + '</span></div>' +
      '<div class="m-top"><section class="panel mode-card" id="modeCard" aria-label="Work mode"></section><div class="m-figs" id="weekBox"></div></div>' +
      '<div class="grid-member"><div class="stack">' +
      '<section class="panel" aria-labelledby="formTitle"><div class="panel-head"><h2 id="formTitle">New entry</h2></div><div class="panel-body">' +
      '<div id="again"></div>' +
      '<form id="entryForm" novalidate>' +
      '<div class="row2"><div class="field"><label for="f_date">Date</label><input id="f_date" type="date" max="' + t + '" min="' + addDays(t, -win) + '" value="' + t + '" required></div>' +
      '<div class="field"><label for="f_hours">Hours</label><input id="f_hours" type="number" min="0.25" max="16" step="0.25" inputmode="decimal" required><div class="hint" id="f_hoursHint">Quarter hours: 0.25 = 15 min, 0.5 = 30 min, 0.75 = 45 min</div></div></div>' +
      '<div class="quick" role="group" aria-label="Quick hours"><span>Quick add</span>' +
      [[0.5, '30m'], [1, '1h'], [2, '2h'], [4, '4h'], [8, '8h']].map(function (q) {
        return '<button type="button" class="chip" data-q="' + q[0] + '">' + q[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="field"><label for="f_task">What did you work on</label><input id="f_task" type="text" maxlength="200" required></div>' +
      '<div class="field"><label for="f_cat">Category</label><select id="f_cat" required>' + optionList(S.options.categories, '', 'Choose a category') + '</select></div>' +
      '<div class="row2"><div class="field"><label for="f_plat">Platform</label><select id="f_plat" required>' + optionList(S.options.platforms, '', 'Choose') + '</select></div>' +
      '<div class="field"><label for="f_status">Status</label><select id="f_status" required>' + optionList(S.options.statuses, 'Completed') + '</select></div></div>' +
      '<div class="field"><label for="f_notes">Notes (optional)</label><textarea id="f_notes" maxlength="500"></textarea></div>' +
      '<p class="err" id="formErr" role="alert"></p>' +
      '<div class="form-actions"><button class="btn" type="submit" id="saveBtn">Save entry</button><button class="btn secondary" type="button" id="cancelEdit" hidden>Cancel</button></div>' +
      '</form></div></section>' +
      '<section class="panel insights" aria-labelledby="insTitle"><div class="panel-head"><h2 id="insTitle">Your week at a glance</h2></div><div id="insights"></div></section></div>' +
      '<section class="panel entries-panel" aria-labelledby="mineTitle"><div class="panel-head"><h2 id="mineTitle">Your entries</h2>' +
      '<div class="seg" role="group" aria-label="Show entries for">' +
      [['7', 'Last 7 days'], ['week', 'This week'], ['28', '4 weeks']].map(function (v) {
        return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (S.member.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div id="listSum"></div><div id="entryList"></div></section></div></main>';
    bindHeader();
    $('#entryForm').addEventListener('submit', onSaveEntry);
    $('#cancelEdit').addEventListener('click', function () { S.member.editing = null; resetForm(); });
    $('#f_hours').addEventListener('input', hoursHint);
    $all('[data-q]').forEach(function (b) {
      b.addEventListener('click', function () { $('#f_hours').value = b.getAttribute('data-q'); hoursHint(); });
    });
    $all('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        S.member.view = b.getAttribute('data-view');
        $all('[data-view]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        renderList();
      });
    });
    loadMine();
  }

  function firstName(n) {
    var p = String(n || '').trim().split(/\s+/);
    return p.length > 1 && !/^\d+$/.test(p[p.length - 1]) ? p[0] : String(n || '');
  }

  function hoursHint() {
    var v = Number($('#f_hours').value), el = $('#f_hoursHint');
    var good = v >= 0.25 && v <= 16 && Math.round(v * 4) === v * 4;
    el.textContent = $('#f_hours').value === '' ? 'Quarter hours: 0.25 = 15 min, 0.5 = 30 min, 0.75 = 45 min' : good ? '= ' + hm(v) : 'Use quarter hours, for example 1.25 or 3.75';
    el.className = 'hint' + (good ? ' hint-ok' : '');
  }

  function resetForm() {
    var t = today();
    $('#f_date').value = t; $('#f_hours').value = ''; $('#f_task').value = ''; $('#f_cat').value = '';
    $('#f_plat').value = ''; $('#f_status').value = 'Completed'; $('#f_notes').value = '';
    $('#formErr').textContent = ''; $('#saveBtn').textContent = 'Save entry';
    $('#formTitle').textContent = 'New entry'; $('#cancelEdit').hidden = true;
    hoursHint();
  }

  function onSaveEntry(ev) {
    ev.preventDefault();
    var er = $('#formErr'), b = $('#saveBtn');
    var payload = { date: $('#f_date').value, hours: $('#f_hours').value, task: $('#f_task').value, category: $('#f_cat').value,
      platform: $('#f_plat').value, status: $('#f_status').value, notes: $('#f_notes').value };
    var editing = S.member.editing;
    if (editing) payload.entryId = editing;
    b.disabled = true;
    api(editing ? 'updateEntry' : 'addEntry', payload).then(function (res) {
      b.disabled = false;
      if (!res.ok) { er.textContent = res.message; return; }
      toast(editing ? 'Changes saved' : 'Entry saved');
      S.member.editing = null; resetForm(); loadMine();
    });
  }

  function loadMine() {
    var t = today();
    api('myEntries', { from: addDays(t, -27), to: t }).then(function (res) {
      if (!res.ok) return;
      S.member.entries = res.data.entries;
      S.member.attendance = res.data.attendance || [];
      renderMine();
    });
  }

  function myMode(d) {
    var m = (S.member.attendance || []).filter(function (x) { return x.date === d; })[0];
    return m ? m.mode : '';
  }

  function renderMine() {
    var t = today(), list = S.member.entries;
    var wkStart = mondayOf(t);
    var wk = sum(list.filter(function (e) { return e.date >= wkStart; }), function (e) { return e.hours; });
    var td = sum(list.filter(function (e) { return e.date === t; }), function (e) { return e.hours; });
    var pct = Math.min(100, wk / CFG.WEEKLY_TARGET * 100);
    var streak = 0;
    for (var c = isWeekday(t) && !list.some(function (e) { return e.date === t; }) ? addDays(t, -1) : t, k = 0; k < 28; k++, c = addDays(c, -1)) {
      if (!isWeekday(c)) continue;
      if (list.some(function (e) { return e.date === c; }) || myMode(c) === 'On leave') streak++; else break;
    }
    $('#weekBox').innerHTML =
      '<div class="fig"><i class="ico ico-sun"></i><b>' + hm(td) + '</b><span>Logged today</span></div>' +
      '<div class="fig wide"><i class="ico ico-cal"></i><b>' + hm(wk) + ' <small>of ' + CFG.WEEKLY_TARGET + 'h</small></b><span>' + (wk >= CFG.WEEKLY_TARGET ? 'Weekly target reached' : hm(CFG.WEEKLY_TARGET - wk) + ' left this week') + '</span>' +
      '<div class="meter' + (wk > CFG.WEEKLY_TARGET ? ' over' : '') + '" role="img" aria-label="' + hm(wk) + ' of ' + CFG.WEEKLY_TARGET + ' hours this week"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="fig"><i class="ico ico-avg"></i><b>' + streak + ' day' + (streak === 1 ? '' : 's') + '</b><span>Logging streak</span></div>';
    renderModeCard();
    renderAgain(list);
    renderInsights(list, t, wkStart);
    renderList();
  }

  function renderModeCard() {
    var t = today(), win = S.options.editWindowDays, d = S.member.modeDay || t;
    if (d > t || d < addDays(t, -win)) d = S.member.modeDay = t;
    var cur = myMode(d);
    var icons = { 'In office': '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4"/>',
      'WFH': '<path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-6h4v6"/>',
      'On leave': '<path d="M12 3v2M5.6 5.6 7 7M3 12h2M17 7l1.4-1.4M19 12h2M8 12a4 4 0 0 1 8 0M3 17h18M6 21h12"/>' };
    $('#modeCard').innerHTML =
      '<div class="mode-head"><div><h2>Work mode</h2><span class="muted">Tick where you are working</span></div>' +
      '<div class="mode-nav"><button type="button" class="nav-btn" id="modePrev" aria-label="Previous day"' + (d <= addDays(t, -win) ? ' disabled' : '') + '>&lsaquo;</button>' +
      '<b>' + (d === t ? 'Today' : esc(fmtDay(d))) + '</b>' +
      '<button type="button" class="nav-btn" id="modeNext" aria-label="Next day"' + (d >= t ? ' disabled' : '') + '>&rsaquo;</button></div></div>' +
      '<div class="mode-opts" role="radiogroup" aria-label="Work mode for ' + esc(fmtDay(d)) + '">' +
      S.options.modes.map(function (m) {
        var on = cur === m;
        return '<button type="button" role="radio" aria-checked="' + on + '" class="mode-opt ' + MODE_CLS[m] + (on ? ' on' : '') + '" data-mode="' + esc(m) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[m] + '</svg>' +
          '<span>' + esc(m) + '</span><i class="tick" aria-hidden="true"></i></button>';
      }).join('') + '</div>';
    $('#modePrev').addEventListener('click', function () { S.member.modeDay = addDays(d, -1); renderModeCard(); });
    $('#modeNext').addEventListener('click', function () { S.member.modeDay = addDays(d, 1); renderModeCard(); });
    $all('[data-mode]', $('#modeCard')).forEach(function (b) {
      b.addEventListener('click', function () {
        var m = b.getAttribute('data-mode'), next = cur === m ? '' : m;
        api('setMyDay', { date: d, mode: next }).then(function (res) {
          if (!res.ok) { toast(res.message); return; }
          S.member.attendance = (S.member.attendance || []).filter(function (x) { return x.date !== d; });
          if (next) S.member.attendance.push({ date: d, mode: next });
          toast(next ? 'Marked ' + next + (d === t ? ' for today' : ' for ' + fmtDay(d)) : 'Mark cleared');
          renderMine();
        });
      });
    });
  }

  function renderAgain(list) {
    var seen = {}, recent = [];
    list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (e) {
      var k = e.task + '|' + e.category + '|' + e.platform;
      if (!seen[k] && recent.length < 4) { seen[k] = 1; recent.push(e); }
    });
    $('#again').innerHTML = recent.length ? '<div class="again"><span>Log again</span>' + recent.map(function (e, i) {
      return '<button type="button" class="again-item" data-again="' + i + '" title="' + esc(e.category + ', ' + e.platform) + '">' + esc(e.task) + '</button>';
    }).join('') + '</div>' : '';
    $all('[data-again]').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = recent[+b.getAttribute('data-again')];
        $('#f_task').value = e.task; $('#f_cat').value = e.category; $('#f_plat').value = e.platform;
        $('#f_hours').focus(); hoursHint();
      });
    });
  }

  // One colour per category, used for the day bars, row dots and legend.
  var CAT_COLORS = ['#a50550', '#d4508a', '#7f043b', '#e08a2c', '#2f9a6d', '#2f6fd1', '#8e5fb3', '#d9a03f', '#3f8f9b', '#9a8f9e'];
  function catColor(c) {
    var i = (S.options.categories || []).indexOf(c);
    return CAT_COLORS[(i < 0 ? CAT_COLORS.length - 1 : i) % CAT_COLORS.length];
  }

  function renderList() {
    var t = today(), win = S.options.editWindowDays, list = S.member.entries, v = S.member.view;
    var from = v === 'week' ? mondayOf(t) : v === '28' ? addDays(t, -27) : addDays(t, -6);
    var shown = list.filter(function (e) { return e.date >= from; });
    var hrs = sum(shown, function (e) { return e.hours; }), daysLogged = {}, cats = {};
    shown.forEach(function (e) { daysLogged[e.date] = 1; cats[e.category] = (cats[e.category] || 0) + e.hours; });
    var nDays = Object.keys(daysLogged).length;
    var catKeys = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    $('#listSum').innerHTML = '<div class="sumstrip">' +
      '<div><b>' + shown.length + '</b><span>Entries</span></div>' +
      '<div><b>' + hm(hrs) + '</b><span>Total time</span></div>' +
      '<div><b>' + nDays + '</b><span>Days logged</span></div>' +
      '<div><b>' + hm(nDays ? hrs / nDays : 0) + '</b><span>Average per day</span></div></div>' +
      (catKeys.length ? '<div class="cat-legend">' + catKeys.map(function (c) {
        return '<span><i style="background:' + catColor(c) + '"></i>' + esc(c) + ' <b>' + hm(cats[c]) + '</b></span>';
      }).join('') + '</div>' : '');
    var byDay = {};
    shown.forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
    var days = [];
    for (var c = t; c >= from; c = addDays(c, -1)) if (isWeekday(c) || byDay[c]) days.push(c);
    var edit = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>';
    var del = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    var tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var cap = CFG.DAILY_CAPACITY;
    var html = days.map(function (d) {
      var es = byDay[d] || [], total = sum(es, function (e) { return e.hours; }), editable = d >= addDays(t, -win), m = myMode(d);
      var scale = Math.max(cap, total);
      var head = '<header class="dhead"><div class="dh-left"><b>' + esc(d === t ? 'Today' : parse(d).toLocaleDateString('en-IN', { weekday: 'long' })) + '</b>' +
        '<span>' + esc(fmtShort(d)) + '</span>' + modeTag(m) + '</div>' +
        '<div class="dh-right"><b>' + hm(total) + '</b><span>of ' + cap + 'h</span></div></header>';
      if (!es.length) {
        return '<section class="dblock empty-day">' + head + '<div class="day-empty">' + (m === 'On leave' ? 'On leave' : d === t ? 'Nothing logged yet today' : 'Nothing logged') +
          (editable && m !== 'On leave' ? '<button type="button" class="chip" data-logday="' + d + '">Log time</button>' : '') + '</div></section>';
      }
      var bar = '<div class="sbar" role="img" aria-label="' + esc(hm(total) + ' logged against ' + cap + ' hours') + '">' +
        es.map(function (e) {
          return '<span style="width:' + (e.hours / scale * 100) + '%;background:' + catColor(e.category) + '" title="' + esc(e.task + ': ' + hm(e.hours)) + '"></span>';
        }).join('') + (total < cap ? '<span class="gap" style="width:' + ((cap - total) / scale * 100) + '%"></span>' : '') +
        (total > cap ? '<i class="cap-mark" style="left:' + (cap / scale * 100) + '%"></i>' : '') + '</div>';
      return '<section class="dblock">' + head + bar + es.map(function (e) {
        var st = statusClass(e.status);
        return '<article class="entry trow s-' + st + '"><i class="cdot" style="background:' + catColor(e.category) + '"></i>' +
          '<b class="t-h">' + hm(e.hours) + '</b>' +
          '<div class="t-main"><span class="t-task">' + esc(e.task) + '</span><span class="t-meta">' + esc(e.category) + ' &middot; ' + esc(e.platform) + '</span>' +
          (e.notes ? '<span class="t-note">' + esc(e.notes) + '</span>' : '') + '</div>' +
          (st === 'ok' ? '<span class="t-ok" title="Completed" aria-label="Completed">' + tick + '</span>' : statusBadge(e.status)) +
          (editable ? '<div class="entry-actions"><button class="icon-btn" data-edit="' + esc(e.entryId) + '" type="button" aria-label="Edit entry" title="Edit">' + edit + '</button>' +
            '<button class="icon-btn del" data-del="' + esc(e.entryId) + '" type="button" aria-label="Delete entry" title="Delete">' + del + '</button></div>' : '<span class="locked" title="Older than ' + win + ' days">Locked</span>') +
          '</article>';
      }).join('') + '</section>';
    }).join('');
    var box = $('#entryList');
    box.innerHTML = html ? '<div class="dblocks">' + html + '</div>' : '<div class="empty">No entries yet. Add your first task using the form.</div>';
    $all('[data-edit]', box).forEach(function (b) { b.addEventListener('click', function () { startEdit(b.getAttribute('data-edit')); }); });
    $all('[data-logday]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        S.member.editing = null; resetForm(); $('#f_date').value = b.getAttribute('data-logday');
        $('#entryForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#f_hours').focus();
      });
    });
    $all('[data-del]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('Delete this entry?')) return;
        api('deleteEntry', { entryId: b.getAttribute('data-del') }).then(function (res) {
          if (!res.ok) { toast(res.message); return; }
          toast('Entry deleted'); loadMine();
        });
      });
    });
  }

  function renderInsights(list, t, wkStart) {
    var cap = CFG.DAILY_CAPACITY, days = [], max = cap;
    for (var i = 0; i < 7; i++) {
      var d = addDays(wkStart, i), v = sum(list.filter(function (e) { return e.date === d; }), function (e) { return e.hours; });
      days.push({ d: d, v: v, m: myMode(d) }); if (v > max) max = v;
    }
    max = max * 1.1;
    var recent = list.filter(function (e) { return e.date >= addDays(t, -13); });
    var cats = {}, stat = { Completed: 0, 'In progress': 0, Blocked: 0 }, total = 0;
    recent.forEach(function (e) { cats[e.category] = (cats[e.category] || 0) + e.hours; stat[e.status] = (stat[e.status] || 0) + 1; total += e.hours; });
    var catRows = Object.keys(cats).map(function (k) { return [k, cats[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5);
    var labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // Four-week calendar, Monday to Friday, oldest week first.
    var calStart = addDays(wkStart, -21), cal = '';
    for (var w = 0; w < 4; w++) {
      cal += '<span class="cal-wk">' + esc(fmtShort(addDays(calStart, w * 7))) + '</span>';
      for (var j = 0; j < 5; j++) {
        var cd = addDays(calStart, w * 7 + j), cv = sum(list.filter(function (e) { return e.date === cd; }), function (e) { return e.hours; }), cm = myMode(cd);
        var lv = cd > t ? 'future' : cm === 'On leave' && !cv ? 'kleave' : !cv ? 'k0' : cv > cap * 1.1 ? 'kover' : cv >= cap * 0.75 ? 'k4' : cv >= cap * 0.4 ? 'k3' : 'k2';
        cal += '<span class="cal-cell ' + lv + (cm === 'WFH' ? ' wfh' : '') + (cd === t ? ' today' : '') + '" title="' + esc(fmtDay(cd) + ': ' + hm(cv) + (cm ? ', ' + cm : '')) + '"></span>';
      }
    }
    $('#insights').innerHTML =
      '<div class="wk-chart" role="img" aria-label="Your hours per day this week">' +
      '<div class="wk-target" style="bottom:' + (cap / max * 100) + '%"><span>' + cap + 'h day</span></div>' +
      days.map(function (x, i) {
        var cls = (x.d === t ? ' today' : '') + (x.d > t ? ' future' : '') + (x.v > cap * 1.1 ? ' over' : '') + (x.m === 'On leave' ? ' leave' : '');
        return '<div class="wk-col' + cls + '" title="' + esc(fmtDay(x.d)) + ': ' + hm(x.v) + (x.m ? ', ' + x.m : '') + '">' +
          '<em>' + (x.v ? hm(x.v) : x.m === 'On leave' ? 'Leave' : '') + '</em><div style="height:' + (x.v / max * 100) + '%"></div><span>' + labels[i] + '</span>' +
          (x.m ? '<i class="wk-mode ' + MODE_CLS[x.m] + '" title="' + esc(x.m) + '"></i>' : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="wk-legend"><span><i class="wk-mode office"></i>Office</span><span><i class="wk-mode wfh"></i>WFH</span><span><i class="wk-mode leave"></i>Leave</span></div>' +
      '<div class="ins-block"><h3>Last four weeks <small>darker means more hours</small></h3>' +
      '<div class="cal"><span></span>' + ['M', 'T', 'W', 'T', 'F'].map(function (x) { return '<span class="cal-day">' + x + '</span>'; }).join('') + cal + '</div></div>' +
      '<div class="ins-block"><h3>Where your time went <small>last 14 days</small></h3>' +
      (catRows.length ? catRows.map(function (c) {
        return '<div class="ins-row"><span><i class="cdot" style="background:' + catColor(c[0]) + '"></i>' + esc(c[0]) + '</span><b>' + hm(c[1]) + '</b>' +
          '<div class="bar"><span style="width:' + (c[1] / catRows[0][1] * 100) + '%;background:' + catColor(c[0]) + '"></span></div></div>';
      }).join('') : '<p class="muted">Nothing logged yet.</p>') + '</div>' +
      '<div class="ins-block"><h3>Task status <small>last 14 days</small></h3><div class="ins-stats">' +
      '<div class="ins-stat ok"><b>' + stat.Completed + '</b><span>Completed</span></div>' +
      '<div class="ins-stat warn"><b>' + stat['In progress'] + '</b><span>In progress</span></div>' +
      '<div class="ins-stat bad"><b>' + stat.Blocked + '</b><span>Blocked</span></div></div></div>' +
      (recent.length ? '<p class="ins-note">14-day total: <b>' + hm(total) + '</b> across <b>' + recent.length + '</b> entries.</p>' : '');
  }

  function startEdit(id) {
    var e = S.member.entries.filter(function (x) { return x.entryId === id; })[0];
    if (!e) return;
    S.member.editing = id;
    $('#f_date').value = e.date; $('#f_hours').value = e.hours; $('#f_task').value = e.task; $('#f_cat').value = e.category;
    $('#f_plat').value = e.platform; $('#f_status').value = e.status; $('#f_notes').value = e.notes || '';
    $('#formTitle').textContent = 'Edit entry'; $('#saveBtn').textContent = 'Save changes'; $('#cancelEdit').hidden = false;
    hoursHint();
    $('#formErr').textContent = ''; $('#f_task').focus();
    $('#entryForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------------------ */
  /* Admin view                                                          */
  /* ------------------------------------------------------------------ */
  function computeRange(a) {
    var t = today();
    if (a.preset === 'week') return { from: mondayOf(t), to: t };
    if (a.preset === 'lastweek') { var m = addDays(mondayOf(t), -7); return { from: m, to: addDays(m, 6) }; }
    if (a.preset === '30') return { from: addDays(t, -29), to: t };
    return { from: a.from || addDays(t, -6), to: a.to || t };
  }

  function renderAdmin() {
    S.admin = S.admin || { tab: 'overview', preset: 'week', from: '', to: '', entries: [], users: [], f: { member: '', category: '', status: '', q: '' }, cred: null };
    app.innerHTML = header() + '<main class="page"><div class="page-head"><div><p class="eyebrow">' + esc(greeting() + ', ' + firstName(S.user.name)) + '</p><h1>Team workload</h1><p>Entries from all members. Members see only their own.</p></div>' +
      '<div class="rangebar" id="rangeBar"></div></div>' +
      '<div class="tabs" role="tablist">' +
      ['overview:Overview', 'entries:Entries', 'team:Team'].map(function (x) {
        var p = x.split(':'); return '<button class="tab" role="tab" data-tab="' + p[0] + '" aria-selected="' + (S.admin.tab === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div><div id="adminBody"></div></main>';
    bindHeader();
    $all('.tab').forEach(function (b) {
      b.addEventListener('click', function () { S.admin.tab = b.getAttribute('data-tab'); $all('.tab').forEach(function (x) { x.setAttribute('aria-selected', x === b); }); drawAdmin(); });
    });
    drawRange();
    refreshAdmin();
  }

  function drawRange() {
    var a = S.admin, r = computeRange(a);
    $('#rangeBar').innerHTML = '<div class="field"><label for="preset">Period</label><select id="preset">' +
      [['week', 'This week'], ['lastweek', 'Last week'], ['30', 'Last 30 days'], ['custom', 'Custom range']].map(function (o) {
        return '<option value="' + o[0] + '"' + (a.preset === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      (a.preset === 'custom' ? '<div class="field"><label for="rf">From</label><input id="rf" type="date" value="' + r.from + '" max="' + today() + '"></div>' +
        '<div class="field"><label for="rt">To</label><input id="rt" type="date" value="' + r.to + '" max="' + today() + '"></div>' : '') +
      '<span class="muted" style="padding-bottom:10px">' + esc(fmtShort(r.from)) + ' to ' + esc(fmtShort(r.to)) + '</span>';
    $('#preset').addEventListener('change', function (e) { a.preset = e.target.value; var rr = computeRange(a); a.from = rr.from; a.to = rr.to; drawRange(); refreshAdmin(); });
    var rf = $('#rf'), rt = $('#rt');
    if (rf) { rf.addEventListener('change', function () { a.from = rf.value; refreshAdmin(); }); rt.addEventListener('change', function () { a.to = rt.value; refreshAdmin(); }); }
  }

  function refreshAdmin() {
    var a = S.admin, r = computeRange(a);
    if (r.from > r.to) { $('#adminBody').innerHTML = '<div class="empty">The start date is after the end date.</div>'; return; }
    Promise.all([api('adminEntries', { from: r.from, to: r.to }), api('adminUsers')]).then(function (rs) {
      if (!rs[0].ok || !rs[1].ok) return;
      a.entries = rs[0].data.entries; a.attendance = rs[0].data.attendance || []; a.users = rs[1].data.users; a.range = r;
      drawAdmin();
    });
  }

  function drawAdmin() {
    var a = S.admin;
    if (!a.range) return;
    if (a.tab === 'overview') drawOverview();
    else if (a.tab === 'entries') drawEntries();
    else drawTeam();
  }

  function memberStats() {
    // Capacity counts completed working days. Today counts only for members who have logged today,
    // so a half-finished day does not make someone look underloaded.
    var a = S.admin, r = a.range, t = today();
    var through = r.to >= t ? addDays(t, -1) : r.to;
    var baseDays = workdays(r.from, through);
    var mode = modeMap(a.attendance);
    var members = a.users.filter(function (u) { return u.role === 'member' && u.active; });
    return members.map(function (u) {
      var es = a.entries.filter(function (e) { return e.userId === u.userId; });
      var hours = sum(es, function (e) { return e.hours; });
      var days = {}; es.forEach(function (e) { days[e.date] = 1; });
      // Days ticked On leave come out of capacity, so leave never reads as low load.
      var leave = 0, wfh = 0, office = 0;
      for (var c = r.from; c <= r.to && c <= t; c = addDays(c, 1)) {
        var m = mode[u.userId + '|' + c];
        if (m === 'On leave') { if (isWeekday(c) && c <= through) leave++; } else if (m === 'WFH') wfh++; else if (m === 'In office') office++;
      }
      var todayCounts = r.to >= t && r.from <= t && isWeekday(t) && es.some(function (e) { return e.date === t; }) && mode[u.userId + '|' + t] !== 'On leave';
      var capDays = Math.max(0, baseDays - leave) + (todayCounts ? 1 : 0);
      if (hours > 0 && capDays === 0) capDays = 1;
      var cap = capDays * CFG.DAILY_CAPACITY;
      var util = cap ? hours / cap : 0;
      var onLeaveNow = mode[u.userId + '|' + t] === 'On leave';
      var flag = hours === 0 ? (onLeaveNow || leave ? 'leave' : 'none') : util > 1.1 ? 'over' : util < 0.6 ? 'low' : 'ok';
      return { user: u, hours: hours, days: Object.keys(days).length, entries: es.length, cap: cap, util: util, flag: flag,
        leave: leave, wfh: wfh, office: office, today: mode[u.userId + '|' + t] || '' };
    }).sort(function (x, y) { return y.util - x.util; });
  }

  function modeMap(list) {
    var m = {}; (list || []).forEach(function (x) { m[x.userId + '|' + x.date] = x.mode; }); return m;
  }
  var MODE_SHORT = { 'In office': 'Office', 'WFH': 'WFH', 'On leave': 'Leave' };
  var MODE_CLS = { 'In office': 'office', 'WFH': 'wfh', 'On leave': 'leave' };
  function modeTag(m) { return m ? '<span class="mode-tag ' + MODE_CLS[m] + '">' + esc(MODE_SHORT[m]) + '</span>' : ''; }
  function flagBadge(f) {
    if (f === 'leave') return '<span class="badge neutral">On leave</span>';
    if (f === 'over') return '<span class="badge bad">Over capacity</span>';
    if (f === 'low') return '<span class="badge warn">Below 60 percent</span>';
    if (f === 'none') return '<span class="badge neutral">Nothing logged</span>';
    return '<span class="badge ok">Within range</span>';
  }

  function drawOverview() {
    var a = S.admin, r = a.range, stats = memberStats(), t = today(), mode = modeMap(a.attendance);
    var total = sum(a.entries, function (e) { return e.hours; });
    var groups = { 'In office': [], 'WFH': [], 'On leave': [], '': [] };
    stats.forEach(function (s) { groups[s.today].push(s.user); });
    var logging = stats.filter(function (s) { return s.hours > 0; });
    var memberDays = sum(stats, function (s) { return s.days; });
    var avgDay = memberDays ? total / memberDays : 0;
    var over = stats.filter(function (s) { return s.flag === 'over'; });
    var low = stats.filter(function (s) { return s.flag === 'low'; });
    var none = stats.filter(function (s) { return s.flag === 'none'; });
    var blocked = a.entries.filter(function (e) { return e.status === 'Blocked'; });
    function groupHours(key) {
      var g = {}; a.entries.forEach(function (e) { g[e[key]] = (g[e[key]] || 0) + e.hours; });
      return Object.keys(g).map(function (k) { return [k, g[k]]; }).sort(function (x, y) { return y[1] - x[1]; });
    }
    var catRows = groupHours('category');
    var maxCat = catRows.length ? catRows[0][1] : 1;
    var platRows = groupHours('platform');
    var roleOf = {}; a.users.forEach(function (u) { roleOf[u.userId] = u.teamRole || 'Other'; });
    var roleG = {}; a.entries.forEach(function (e) { var k = roleOf[e.userId] || 'Other'; roleG[k] = (roleG[k] || 0) + e.hours; });
    var roleRows = Object.keys(roleG).map(function (k) { return [k, roleG[k]]; }).sort(function (x, y) { return y[1] - x[1]; });

    var days = [], c = r.from, dayTotals = {};
    a.entries.forEach(function (e) { dayTotals[e.date] = (dayTotals[e.date] || 0) + e.hours; });
    while (c <= r.to) { if (isWeekday(c) || dayTotals[c]) days.push(c); c = addDays(c, 1); }
    var capTotal = stats.length * CFG.DAILY_CAPACITY;
    var maxDay = Math.max(capTotal * 1.15, Math.max.apply(null, days.map(function (d) { return dayTotals[d] || 0; }).concat([1])));
    var step = days.length > 16 ? 3 : 1;

    // Needs attention: the few things a director should act on, most urgent first.
    var attn = [];
    over.forEach(function (s) { attn.push({ sev: 'bad', who: s.user, text: '<b>' + esc(s.user.name) + '</b> is at <b>' + Math.round(s.util * 100) + '%</b> of capacity (' + hm(s.hours) + ' against ' + hm(s.cap) + ').', tip: 'Consider moving work to someone below range.' }); });
    blocked.slice(0, 3).forEach(function (e) { attn.push({ sev: 'bad', who: { userId: e.userId, name: e.name }, text: '<b>' + esc(e.name) + '</b> is blocked on <b>' + esc(e.task) + '</b> (' + esc(fmtDay(e.date)) + ').', tip: esc(e.notes || e.category) }); });
    low.forEach(function (s) { attn.push({ sev: 'warn', who: s.user, text: '<b>' + esc(s.user.name) + '</b> is at <b>' + Math.round(s.util * 100) + '%</b> of capacity.', tip: 'Has room for more work, or may be under-logging.' }); });
    none.forEach(function (s) { attn.push({ sev: 'neutral', who: s.user, text: '<b>' + esc(s.user.name) + '</b> has not logged anything this period.', tip: s.user.mustChange ? 'Has not finished first sign-in yet.' : 'Send a reminder.' }); });

    var heatDays = days.filter(function (d) { return isWeekday(d); }).slice(-15);
    var cell = {}; a.entries.forEach(function (e) { var k = e.userId + '|' + e.date; cell[k] = (cell[k] || 0) + e.hours; });

    var stCount = { Completed: 0, 'In progress': 0, Blocked: 0 }, stHours = { Completed: 0, 'In progress': 0, Blocked: 0 };
    a.entries.forEach(function (e) { stCount[e.status] = (stCount[e.status] || 0) + 1; stHours[e.status] = (stHours[e.status] || 0) + e.hours; });
    var nEntries = a.entries.length || 1;

    function barList(rows) {
      var mx = rows.length ? rows[0][1] : 1;
      return rows.length ? rows.map(function (x) {
        return '<div class="cat-row"><span>' + esc(x[0]) + '</span><div class="bar"><span style="width:' + (x[1] / mx * 100) + '%"></span></div><span class="num">' + hm(x[1]) + '</span></div>';
      }).join('') + '<div style="height:10px"></div>' : '<div class="empty">No entries in this period.</div>';
    }

    $('#adminBody').innerHTML =
      '<div class="figures">' +
      '<div class="fig"><i class="ico ico-clock"></i><b>' + hm(total) + '</b><span>Hours logged</span></div>' +
      '<div class="fig"><i class="ico ico-team"></i><b>' + logging.length + ' of ' + stats.length + '</b><span>Members with entries</span></div>' +
      '<div class="fig"><i class="ico ico-avg"></i><b>' + hm(avgDay) + '</b><span>Average per member per logged day</span></div>' +
      '<div class="fig' + (over.length ? ' alert' : '') + '"><i class="ico ico-alert"></i><b>' + over.length + '</b><span>Members over capacity</span></div></div>' +

      '<div class="ov-top">' +
      '<section class="panel attn"><div class="panel-head"><h2>Needs attention</h2><span class="count-pill' + (attn.length ? '' : ' ok') + '">' + (attn.length ? attn.length + ' item' + (attn.length > 1 ? 's' : '') : 'All clear') + '</span></div>' +
      (attn.length ? '<ul class="attn-list">' + attn.slice(0, 7).map(function (x) {
        return '<li class="sev-' + x.sev + '"><span class="avatar sm" aria-hidden="true">' + esc(initials(x.who.name)) + '</span><div><p>' + x.text + '</p><small>' + x.tip + '</small></div>' +
          '<button class="linkbtn" type="button" data-member="' + esc(x.who.userId) + '">View</button></li>';
      }).join('') + '</ul>' + (attn.length > 7 ? '<p class="attn-more">' + (attn.length - 7) + ' more in the table below.</p>' : '')
        : '<div class="all-clear"><b>Everyone is within range.</b><span>No one is over capacity, below 60 percent, blocked or missing entries.</span></div>') + '</section>' +

      '<div class="stack"><section class="panel mix"><div class="panel-head"><h2>Task status</h2><span class="muted">' + a.entries.length + ' entries</span></div><div class="panel-body">' +
      '<div class="mix-bar" role="img" aria-label="Share of entries by status">' +
      ['Completed', 'In progress', 'Blocked'].map(function (k, i) {
        return '<span class="m' + i + '" style="width:' + (stCount[k] / nEntries * 100) + '%"></span>';
      }).join('') + '</div>' +
      '<div class="mix-legend">' + [['Completed', 'ok'], ['In progress', 'warn'], ['Blocked', 'bad']].map(function (k) {
        return '<div class="mix-item ' + k[1] + '"><b>' + stCount[k[0]] + '</b><span>' + k[0] + '</span><small>' + hm(stHours[k[0]]) + ' &middot; ' + Math.round(stCount[k[0]] / nEntries * 100) + '%</small></div>';
      }).join('') + '</div></div></section>' +
      '<section class="panel att"><div class="panel-head"><h2>Today\'s attendance</h2><span class="muted">' + esc(fmtDay(t)) + '</span></div><div class="att-grid">' +
      [['In office', 'office'], ['WFH', 'wfh'], ['On leave', 'leave'], ['', 'unmarked']].map(function (g) {
        var list = groups[g[0]];
        return '<div class="att-col ' + g[1] + '"><div class="att-head"><b>' + list.length + '</b><span>' + (g[0] || 'Not marked') + '</span></div>' +
          '<div class="att-faces">' + list.map(function (u) { return '<span class="avatar xs" title="' + esc(u.name) + '">' + esc(initials(u.name)) + '</span>'; }).join('') + '</div></div>';
      }).join('') + '</div></section></div></div>' +

      '<section class="panel"><div class="panel-head"><h2>Workload by member</h2><span class="muted">Capacity is ' + CFG.DAILY_CAPACITY + ' hours per working day. The line marks 100 percent. Today counts once a member has logged.</span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Member</th><th class="num">Hours</th><th>Against capacity</th><th class="num">Use</th><th class="num">Days logged</th><th>Flag</th></tr></thead><tbody>' +
      (stats.length ? stats.map(function (s) {
        var w = Math.min(s.util, 1.4) / 1.4 * 100;
        return '<tr><td class="namecell"><span class="avatar sm" aria-hidden="true">' + esc(initials(s.user.name)) + '</span><button type="button" data-member="' + esc(s.user.userId) + '">' + esc(s.user.name) + '</button><span>' + esc(s.user.teamRole) + '</span></td>' +
          '<td class="num">' + hm(s.hours) + '</td>' +
          '<td><div class="bar' + (s.flag === 'over' ? ' over' : '') + '"><span style="width:' + w + '%"></span><i style="left:' + (100 / 1.4) + '%"></i></div></td>' +
          '<td class="num">' + Math.round(s.util * 100) + '%</td><td class="num">' + s.days + '</td><td>' + flagBadge(s.flag) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">No active members yet. Add members in the Team tab.</td></tr>') +
      '</tbody></table></div></section>' +

      (stats.length && heatDays.length ? '<section class="panel" style="margin-top:28px"><div class="panel-head"><h2>Who logged when</h2>' +
        '<span class="heat-key"><i class="k0"></i>0h<i class="k2"></i>4h<i class="k4"></i>8h<i class="kover"></i>Over 8h<i class="kleave"></i>Leave<i class="kwfh"></i>WFH</span></div>' +
        '<div class="table-wrap"><div class="heatgrid" style="grid-template-columns:minmax(150px,1.4fr) repeat(' + heatDays.length + ', minmax(40px,1fr))">' +
        '<span class="hg-corner"></span>' + heatDays.map(function (d) {
          return '<span class="hg-day' + (d === t ? ' today' : '') + '">' + esc(parse(d).toLocaleDateString('en-IN', { weekday: 'short' })) + '<b>' + parse(d).getDate() + '</b></span>';
        }).join('') +
        stats.map(function (s) {
          return '<span class="hg-name">' + esc(s.user.name) + '</span>' + heatDays.map(function (d) {
            var v = cell[s.user.userId + '|' + d] || 0, future = d > t, md = mode[s.user.userId + '|' + d] || '';
            var lvl = future ? 'future' : md === 'On leave' && !v ? 'kleave' : v === 0 ? 'k0' : v > CFG.DAILY_CAPACITY * 1.1 ? 'kover' : v >= CFG.DAILY_CAPACITY * 0.75 ? 'k4' : v >= CFG.DAILY_CAPACITY * 0.4 ? 'k3' : 'k2';
            return '<span class="hg-cell ' + lvl + (md === 'WFH' ? ' wfh' : '') + '" title="' + esc(s.user.name + ', ' + fmtDay(d) + ': ' + hm(v) + (md ? ', ' + md : '')) + '">' +
              (lvl === 'kleave' ? 'Leave' : v ? hm(v).replace(' ', '') : '') + '</span>';
          }).join('');
        }).join('') + '</div></div></section>' : '') +

      '<div class="two-col">' +
      '<section class="panel"><div class="panel-head"><h2>Hours by category</h2></div>' +
      (catRows.length ? catRows.map(function (x) {
        return '<div class="cat-row"><span>' + esc(x[0]) + '</span><div class="bar"><span style="width:' + (x[1] / maxCat * 100) + '%"></span></div><span class="num">' + hm(x[1]) + '</span></div>';
      }).join('') + '<div style="height:10px"></div>' : '<div class="empty">No entries in this period.</div>') + '</section>' +
      '<section class="panel"><div class="panel-head"><h2>Hours per day</h2><span class="muted">Dashed line is team capacity, ' + hm(capTotal) + '</span></div>' +
      (days.length ? '<div class="days" role="img" aria-label="Team hours per day">' +
        '<div class="capline" style="bottom:' + (capTotal / maxDay * 176 + 0) + 'px"></div>' +
        days.map(function (d) {
          var v = dayTotals[d] || 0;
          return '<div class="day-col' + (capTotal && v > capTotal * 1.1 ? ' over' : '') + (d === t ? ' today' : '') + '" title="' + esc(fmtDay(d)) + ': ' + hm(v) + '">' +
            (days.length <= 10 && v ? '<em>' + hm(v).replace(' ', '') + '</em>' : '') + '<div style="height:' + (v / maxDay * 100) + '%"></div></div>';
        }).join('') + '</div><div class="day-labels">' +
        days.map(function (d, i) {
          return '<span>' + (i % step === 0 ? (days.length <= 10 ? esc(parse(d).toLocaleDateString('en-IN', { weekday: 'short' })) + ' ' : '') + esc(String(parse(d).getDate())) : '') + '</span>';
        }).join('') + '</div>' +
        '<div class="day-foot"><div><b>' + hm(days.length ? total / days.length : 0) + '</b><span>Average per day</span></div>' +
        '<div><b>' + (capTotal ? Math.round(total / (capTotal * Math.max(1, days.length)) * 100) : 0) + '%</b><span>Of team capacity</span></div>' +
        '<div><b>' + esc(days.length ? fmtDay(days.slice().sort(function (x, y) { return (dayTotals[y] || 0) - (dayTotals[x] || 0); })[0]) : '') + '</b><span>Busiest day</span></div></div>'
        : '<div class="empty">No working days in this period.</div>') +
      '</section></div>' +

      '<div class="two-col">' +
      '<section class="panel"><div class="panel-head"><h2>Hours by platform</h2></div>' + barList(platRows) + '</section>' +
      '<section class="panel"><div class="panel-head"><h2>Hours by team role</h2></div>' + barList(roleRows) + '</section></div>';

    $all('[data-member]').forEach(function (b) {
      b.addEventListener('click', function () { a.f.member = b.getAttribute('data-member'); a.tab = 'entries'; $all('.tab').forEach(function (x) { x.setAttribute('aria-selected', x.getAttribute('data-tab') === 'entries'); }); drawAdmin(); });
    });
  }
  function filteredEntries() {
    var f = S.admin.f, q = f.q.trim().toLowerCase();
    return S.admin.entries.filter(function (e) {
      return (!f.member || e.userId === f.member) && (!f.category || e.category === f.category) && (!f.status || e.status === f.status) &&
        (!q || (e.task + ' ' + e.notes).toLowerCase().indexOf(q) >= 0);
    }).sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : x.name.localeCompare(y.name); });
  }

  function drawEntries() {
    var a = S.admin, f = a.f;
    var members = a.users.filter(function (u) { return u.role === 'member'; });
    $('#adminBody').innerHTML = '<section class="panel"><div class="filters">' +
      '<div class="field"><label for="fm">Member</label><select id="fm"><option value="">All members</option>' +
      members.map(function (u) { return '<option value="' + esc(u.userId) + '"' + (f.member === u.userId ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="fc">Category</label><select id="fc">' + optionList(S.options.categories, f.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="fs">Status</label><select id="fs">' + optionList(S.options.statuses, f.status, 'All statuses') + '</select></div>' +
      '<div class="field"><label for="fq">Search</label><input id="fq" type="text" value="' + esc(f.q) + '" placeholder="Task or notes"></div>' +
      '<div style="margin-left:auto"><button class="btn secondary" id="btnCsv" type="button">Export CSV</button></div></div>' +
      '<div class="sumstrip" id="entSum" aria-live="polite"></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Member</th><th>Category</th><th>Task</th><th>Platform</th><th class="num">Hours</th><th>Status</th></tr></thead><tbody id="entRows"></tbody></table></div></section>';
    function rows() {
      var list = filteredEntries();
      var hrs = sum(list, function (e) { return e.hours; }), who = {}, days = {}, st = { Completed: 0, 'In progress': 0, Blocked: 0 };
      list.forEach(function (e) { who[e.userId] = 1; days[e.date] = 1; st[e.status] = (st[e.status] || 0) + 1; });
      var n = list.length || 1;
      $('#entSum').innerHTML =
        '<div><b>' + list.length + '</b><span>Entries</span></div>' +
        '<div><b>' + hm(hrs) + '</b><span>Total time</span></div>' +
        '<div><b>' + Object.keys(who).length + '</b><span>Members</span></div>' +
        '<div><b>' + hm(list.length ? hrs / list.length : 0) + '</b><span>Average per entry</span></div>' +
        '<div class="sum-mix"><div class="mix-bar small">' + ['Completed', 'In progress', 'Blocked'].map(function (k, i) {
          return '<span class="m' + i + '" style="width:' + (st[k] / n * 100) + '%"></span>'; }).join('') + '</div>' +
        '<span>' + st.Completed + ' completed, ' + st['In progress'] + ' in progress, ' + st.Blocked + ' blocked</span></div>';
      $('#entRows').innerHTML = list.length ? list.map(function (e) {
        return '<tr class="s-' + statusClass(e.status) + '"><td>' + esc(fmtDay(e.date)) + '</td><td><span class="who"><span class="avatar xs" aria-hidden="true">' + esc(initials(e.name)) + '</span>' + esc(e.name) + '</span></td><td>' + esc(e.category) + '</td><td>' + esc(e.task) +
          (e.notes ? '<div class="muted" style="font-size:.84rem">' + esc(e.notes) + '</div>' : '') + '</td><td>' + esc(e.platform) +
          '</td><td class="num">' + hm(e.hours) + '</td><td>' + statusBadge(e.status) + '</td></tr>';
      }).join('') + '<tr class="total-row"><td colspan="5"><strong>Total</strong></td><td class="num"><strong>' + hm(hrs) + '</strong></td><td></td></tr>'
        : '<tr><td colspan="7" class="empty">No entries match these filters.</td></tr>';
    }
    rows();
    [['fm', 'member'], ['fc', 'category'], ['fs', 'status']].forEach(function (p) { $('#' + p[0]).addEventListener('change', function (e) { f[p[1]] = e.target.value; rows(); }); });
    $('#fq').addEventListener('input', function (e) { f.q = e.target.value; rows(); });
    $('#btnCsv').addEventListener('click', exportCsv);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var list = filteredEntries(), r = S.admin.range;
    var lines = [['Date', 'User ID', 'Member', 'Category', 'Platform', 'Task', 'Hours', 'Status', 'Notes']].concat(list.map(function (e) {
      return [e.date, e.userId, e.name, e.category, e.platform, e.task, e.hours, e.status, e.notes];
    })).map(function (row) { return row.map(csvCell).join(','); });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'mib-workload-' + r.from + '-to-' + r.to + '.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    toast('CSV exported');
  }

  function fmtLogin(iso) {
    if (!iso) return '<span class="muted">Never</span>';
    var d = new Date(iso), mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (isNaN(mins)) return '<span class="muted">Unknown</span>';
    if (mins < 60) return mins <= 1 ? 'Just now' : mins + ' min ago';
    if (mins < 1440) return Math.round(mins / 60) + ' h ago';
    return esc(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
  }

  function drawTeam() {
    var a = S.admin;
    var hrsBy = {}; a.entries.forEach(function (e) { hrsBy[e.userId] = (hrsBy[e.userId] || 0) + e.hours; });
    var members = a.users.filter(function (u) { return u.role === 'member'; });
    var active = members.filter(function (u) { return u.active; });
    var pending = members.filter(function (u) { return u.active && (u.mustChange || !u.lastLogin); });
    var roles = {}; active.forEach(function (u) { var k = u.teamRole || 'Other'; roles[k] = (roles[k] || 0) + 1; });
    var roleRows = Object.keys(roles).map(function (k) { return [k, roles[k]]; }).sort(function (x, y) { return y[1] - x[1] || x[0].localeCompare(y[0]); });
    var maxRole = roleRows.length ? roleRows[0][1] : 1;
    var maxHrs = Math.max.apply(null, [1].concat(Object.keys(hrsBy).map(function (k) { return hrsBy[k]; })));
    var credHtml = a.cred ? '<div class="cred-box" role="status"><p><strong>' + esc(a.cred.title) + '</strong></p>' +
      '<p>User ID <code>' + esc(a.cred.userId) + '</code> Temporary password <code>' + esc(a.cred.pw) + '</code></p>' +
      '<p class="muted">Shown once. Share it with the member privately. They must set a new password at first sign-in.</p>' +
      '<div class="form-actions"><button class="btn small" id="btnCopy" type="button">Copy details</button><button class="btn small secondary" id="btnCredClose" type="button">Done</button></div></div>' : '';
    $('#adminBody').innerHTML = credHtml +
      '<div class="team-stats">' +
      '<div><b>' + active.length + '</b><span>Active members</span></div>' +
      '<div><b>' + (members.length - active.length) + '</b><span>Deactivated</span></div>' +
      '<div><b>' + roleRows.length + '</b><span>Roles covered</span></div>' +
      '<div class="' + (pending.length ? 'warn' : '') + '"><b>' + pending.length + '</b><span>Yet to sign in</span></div></div>' +
      '<div class="grid-member" style="grid-template-columns:340px minmax(0,1fr)"><div class="stack">' +
      '<section class="panel"><div class="panel-head"><h2>Add member</h2></div><div class="panel-body"><form id="addForm" novalidate>' +
      '<div class="field"><label for="nm">Name</label><input id="nm" type="text" required></div>' +
      '<div class="field"><label for="tr">Role in team</label><input id="tr" type="text" placeholder="Graphic Designer"></div>' +
      '<div class="field"><label for="ni">User ID (optional)</label><input id="ni" type="text" autocapitalize="none"><div class="hint">Left empty, the next ID such as mib09 is assigned.</div></div>' +
      '<p class="err" id="addErr" role="alert"></p><button class="btn" type="submit">Create account</button></form></div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Team make-up</h2><span class="muted">Active members by role</span></div>' +
      (roleRows.length ? roleRows.map(function (x) {
        return '<div class="cat-row role-row"><span>' + esc(x[0]) + '</span><div class="bar"><span style="width:' + (x[1] / maxRole * 100) + '%"></span></div><span class="num">' + x[1] + '</span></div>';
      }).join('') + '<div style="height:10px"></div>' : '<div class="empty">No members yet.</div>') +
      (pending.length ? '<div class="ins-block"><h3>Yet to sign in</h3><div class="chips">' + pending.map(function (u) {
        return '<span class="pchip"><span class="avatar xs" aria-hidden="true">' + esc(initials(u.name)) + '</span>' + esc(u.name) + '</span>'; }).join('') + '</div></div>' : '') +
      '</section></div>' +
      '<section class="panel"><div class="panel-head"><h2>Accounts</h2><span class="muted">' + a.users.length + ' total | hours for ' + esc(fmtShort(a.range.from)) + ' to ' + esc(fmtShort(a.range.to)) + '</span></div><div class="table-wrap"><table><thead><tr><th>Member</th><th>This period</th><th>Last sign-in</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      a.users.map(function (u) {
        var self = u.userId === S.user.userId;
        return '<tr><td class="namecell"><span class="avatar sm" aria-hidden="true">' + esc(initials(u.name)) + '</span><strong>' + esc(u.name) + '</strong><span><code class="uid">' + esc(u.userId) + '</code> ' + esc(u.teamRole || u.role) + '</span></td>' +
          '<td>' + (u.role === 'member' ? '<div class="mini-hours"><b>' + hm(hrsBy[u.userId] || 0) + '</b><div class="bar"><span style="width:' + ((hrsBy[u.userId] || 0) / maxHrs * 100) + '%"></span></div></div>' : '<span class="muted">Director</span>') + '</td>' +
          '<td>' + fmtLogin(u.lastLogin) + '</td>' +
          '<td>' + (u.active ? (u.mustChange ? '<span class="badge warn">First sign-in pending</span>' : '<span class="badge ok">Active</span>') : '<span class="badge neutral">Inactive</span>') + '</td><td class="actions">' +
          '<button class="btn small secondary" data-reset="' + esc(u.userId) + '" type="button">Reset password</button> ' +
          (self ? '' : '<button class="btn small ' + (u.active ? 'danger' : 'secondary') + '" data-active="' + esc(u.userId) + '" data-to="' + (!u.active) + '" type="button">' + (u.active ? 'Deactivate' : 'Reactivate') + '</button>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div></section></div>';

    var cp = $('#btnCopy');
    if (cp) {
      cp.addEventListener('click', function () {
        var txt = 'User ID: ' + a.cred.userId + '\nTemporary password: ' + a.cred.pw;
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Details copied'); });
      });
      $('#btnCredClose').addEventListener('click', function () { a.cred = null; drawTeam(); });
    }
    $('#addForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      api('adminCreateUser', { name: $('#nm').value, teamRole: $('#tr').value, userId: $('#ni').value }).then(function (res) {
        if (!res.ok) { $('#addErr').textContent = res.message; return; }
        a.cred = { title: 'Account created', userId: res.data.userId, pw: res.data.tempPassword };
        refreshAdmin();
      });
    });
    $all('[data-reset]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('Reset the password for ' + b.getAttribute('data-reset') + '? Their current sessions end.')) return;
        api('adminResetPassword', { userId: b.getAttribute('data-reset') }).then(function (res) {
          if (!res.ok) { toast(res.message); return; }
          a.cred = { title: 'Password reset', userId: res.data.userId, pw: res.data.tempPassword }; drawTeam();
        });
      });
    });
    $all('[data-active]').forEach(function (b) {
      b.addEventListener('click', function () {
        var to = b.getAttribute('data-to') === 'true';
        api('adminSetActive', { userId: b.getAttribute('data-active'), active: to }).then(function (res) {
          if (!res.ok) { toast(res.message); return; }
          toast(to ? 'Account reactivated' : 'Account deactivated'); refreshAdmin();
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  function boot() {
    if (!sessionStorage.getItem(TOKEN_KEY)) { renderLogin(''); return; }
    api('me').then(function (res) {
      if (!res.ok) { signOutLocal(''); return; }
      S.user = res.data.user; S.options = res.data.options;
      if (S.user.mustChange) renderChangePassword(true); else renderHome();
    });
  }
  boot();
})();
