# MIB Workload Log

Timesheet-style workload tracker for the MIB team. Members sign in with a personal user ID and password, log tasks and hours, and see only their own entries. The account director sees all entries, workload against capacity, and manages accounts.

Stack: static frontend (GitHub Pages) + Google Apps Script backend + Google Sheet as database. No paid services.

```
frontend/   HTML, CSS, JS. Publish this folder on GitHub Pages.
backend/    Code.gs. Paste into Apps Script, bound to the Google Sheet.
tests/      backend.test.js (privacy and auth rules) and ui.test.py (demo-mode UI).
```

## Try it first (demo mode)

Open `frontend/index.html` in a browser with `API_URL` empty in `config.js`. Sample data is stored in that browser only.

| View | User ID | Password |
|---|---|---|
| Director | admin | Admin@123 |
| Member | mib01 to mib07 | Welcome@01 |
| First sign-in flow | mib08 | Welcome@01 |

## Go live

Use a fresh Google account that only you control.

1. **Create the sheet.** New Google Sheet named `MIB Workload Log`. Do not share it with anyone.
2. **Add the backend.** Extensions > Apps Script. Replace the default file with `backend/Code.gs`. Save.
3. **Run setup.** Select `setup` and click Run. Accept the permission prompts. This creates the Users, Entries, Roster and Credentials tabs and the `admin` account. The admin temporary password is on the Credentials tab.
4. **Add the team.** On the Roster tab enter one member per row (name, teamRole). Run `createUsersFromRoster`. Accounts `mib01`, `mib02` and so on are created, and their temporary passwords are written to the Credentials tab.
5. **Distribute credentials privately**, then delete the Credentials tab. Everyone must set a new password at first sign-in.
6. **Time the hashing.** Run `benchmarkHash` and read the log. If one hash takes more than about 700 ms, lower `PBKDF_ROUNDS` at the top of `Code.gs`.
7. **Deploy.** Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the Web app URL. After any later change to `Code.gs`, use Deploy > Manage deployments > Edit > New version.
8. **Connect the frontend.** In `frontend/config.js` set `API_URL` to that URL.
9. **Add the logo.** Save the official logo as `frontend/assets/logo.svg`. Until then a text wordmark shows.
10. **Publish.** In the GitHub repo go to Settings > Pages > Source and pick GitHub Actions. `.github/workflows/pages.yml` then publishes `/frontend` on every push to `main` that changes it (or run it by hand from the Actions tab).
11. **Backups.** In Apps Script add a time-driven trigger for `weeklyBackup` (weekly).

## How privacy works

Members never touch the sheet. Every member action runs in the script, which reads the caller's identity from a server-side session and filters rows by that user ID. A member request has no parameter that selects another user. Admin actions are rejected unless the Users sheet says the caller is an admin. `tests/backend.test.js` runs `Code.gs` against stubbed Google services and checks these rules, including attempts to read, edit and delete another member's entries.

Other controls: salted, iterated SHA-256 password hashes, lockout after 5 failed sign-ins for 15 minutes, 6-hour sessions, forced password change on first sign-in and after a reset, sessions revoked on password change, reset or deactivation, text cells stored as plain text so entries cannot run as spreadsheet formulas, and spreadsheet-safe CSV export.

## Rules you can change

`CFG` at the top of `Code.gs`: categories, platforms, statuses, edit window (7 days), lockout. `config.js`: daily capacity (8 hours) and weekly target (40 hours). Utilisation flags are in `drawOverview` and `memberStats` in `app.js`: over capacity above 110 percent, below 60 percent flagged low.

## Known limits

- Google Apps Script has no bcrypt. The hashing is below industry standard but proportionate for an internal timesheet.
- Each request takes one to two seconds. Daily Apps Script quota limits apply. Check the current limits for your account type.
- Sessions live in the script cache and can expire earlier than 6 hours.
- The sheet reads all entries per request. Expect it to stay comfortable for a 21-person team for a year or more. Archive old rows if it slows down.
- Free GitHub Pages needs a public repository. Code is public. No secrets are in it. The Apps Script URL is not a secret.
- The director can read every entry. Tell the team before rollout.
- This holds MIB team work data in a Google account outside Avian We. systems. Get internal approval before rollout.

## Tests

```
node tests/backend.test.js
python3 tests/ui.test.py     # needs: pip install playwright && playwright install chromium
```

Set `CHROMIUM_PATH` to use an existing Chromium binary instead of the Playwright download. Screenshots go to `tests/shots/` (ignored by git). `.github/workflows/tests.yml` runs both suites on every push and pull request.
