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

Use a fresh Google account that only you control. Its Drive holds all data. See "Connect a new Google Drive" below if you are moving to another account later.

1. **Create the sheet.** Sign in to the Google account, open Google Drive, New > Google Sheets. Name it `MIB Workload Log`. Do not share it with anyone.
2. **Add the backend.** In the sheet: Extensions > Apps Script. Replace the default file with `backend/Code.gs`. Then + > Script, name it `Reports`, and paste `backend/Reports.gs`. Save.
3. **Run setup.** Select `setup` and click Run. Accept the permission prompts (Sheets, Drive, triggers). This creates the Users, Entries, Roster, Attendance and Credentials tabs and the `admin` account (named Bireshwar Chakravarty, Account Director; rename it in the Users tab if needed). The admin temporary password is on the Credentials tab.
4. **Add the team.** On the Roster tab enter one member per row (name, teamRole). Run `createUsersFromRoster`. Accounts `mib01`, `mib02` and so on are created, and their temporary passwords are written to the Credentials tab.
5. **Distribute credentials privately**, then delete the Credentials tab. Everyone must set a new password at first sign-in.
6. **Time the hashing.** Run `benchmarkHash` and read the log. If one hash takes more than about 700 ms, lower `PBKDF_ROUNDS` at the top of `Code.gs`.
7. **Turn on reports and backups.** Run `installTriggers` once. It refreshes the reports workbook every hour and copies the data sheet every Monday. Reload the sheet: a **MIB Workload** menu appears with refresh options and a link to the reports workbook.
8. **Deploy.** Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the Web app URL. After any later change to the script, use Deploy > Manage deployments > Edit > New version.
9. **Connect the frontend.** In `frontend/config.js` set `API_URL` to that URL and push to `main`. The site redeploys on its own.
10. **Logo.** `frontend/assets/logo.png` (sign-in page), `logo-mark.png` (header) and `favicon.png` are cut from a screenshot of avianwe.com. Replace them with the official files at the same names for sharper rendering.
11. **Publish.** Settings > Pages > Source > GitHub Actions (already done for this repo). `.github/workflows/pages.yml` publishes `/frontend` on every push to `main` that changes it.

## Storage and access

| What | Where it lives | Who can open it |
|---|---|---|
| Users, Entries, Roster, Attendance tabs (the data sheet) | `MIB Workload Log` in the owner's Google Drive | Owner only. Never share it. |
| Password data | Users tab: salted, iterated SHA-256 hashes. No plain passwords are stored. | Owner only |
| Sessions | Apps Script cache, up to 6 hours | Nobody. Expires on its own. |
| Reports workbook | `MIB Workload Reports` in the same Drive. Work data only, no Users tab. | Owner. Share view-only only with people allowed to see every member's entries. |
| Backups | `MIB Workload Log backup yyyy-mm-dd` copies in the same Drive, last 8 kept | Owner only |
| Website | GitHub Pages. Holds no data. | Public link, but nothing shows without a sign-in |

A member signed in to the website sees only their own entries and their own work mode (In office, WFH or On leave, ticked per day within the 7-day edit window). Days ticked On leave come out of capacity, so leave never shows as low load. The director (`admin`) sees everyone's entries and manages accounts. Nobody but the owner ever opens the sheet itself.

## Reports and export

- **Reports workbook** (`MIB Workload Reports`): Dashboard (figures, workload by member with flags and office/WFH/leave days, category and status split, hours per day, three charts), Monthly (member by month heat map, 12 months), Attendance (work mode per member per day), All entries (filterable flat table), Read me (definitions). Refreshes hourly, or on demand from the **MIB Workload** menu for this week, last week, this month or the last 30 days.
- **Excel**: in the reports workbook, File > Download > Microsoft Excel (.xlsx). The **MIB Workload > Open reports workbook** menu also gives a direct .xlsx link. Load bars are plain text characters, so they survive the export.
- **CSV**: from the director view on the website (Entries tab > Export CSV), or from the All entries tab via File > Download.
- **Hours** are decimal in quarter steps: 0.25 = 15 min, 0.5 = 30 min, 0.75 = 45 min. The website shows them as hours and minutes, for example 3.75 as 3h 45m.

## Connect a new Google Drive

To move the system to a different Google account (for example a company account later):

1. In the old account, open the data sheet and File > Download > Microsoft Excel, or File > Make a copy into the new account's Drive if both are yours.
2. Sign in to the new account and open the copied sheet. If you uploaded the .xlsx, open it and File > Save as Google Sheets.
3. Extensions > Apps Script in the copied sheet. A copied sheet carries the script with it; an uploaded .xlsx does not, so paste `Code.gs` and `Reports.gs` again if they are missing.
4. Run `installTriggers` once (triggers do not move with a copy). The first report refresh creates a new `MIB Workload Reports` workbook in the new Drive.
5. Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Copy the new URL.
6. Put the new URL in `frontend/config.js` (`API_URL`) and push to `main`.
7. Passwords and accounts carry over, because they live in the Users tab. Sessions do not: everyone signs in again once.
8. In the old account, delete or archive the old sheet, its backups and its reports workbook, and remove the old deployment (Deploy > Manage deployments > Archive).

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
