# Project handoff: MIB Workload Log

Read this first. It replaces the chat history that produced this project.

## Owner and goal
Bireshwar Chakravarty (Bir), Director of Digital, Avian We. (Avian Media Pvt. Ltd., a We. Communications company), New Delhi. He runs the MIB (Ministry of Information and Broadcasting) account. The MIB team has 21 members across these roles: Team Lead, Content Lead, Social Media Executive, English Content Writer, Hindi Content Writer, Graphic Designer, Video Editor.

Goal: a timesheet-style dashboard where each team member logs tasks and hours so Bir can see workload. Requirements stated by the owner:
- Every member has a unique user ID and password.
- No member can see another member's entries.
- Bir (admin) sees everything.
- Zero cost. Internal tool.
- Institutional, professional design referencing Avian We. colours.

## Decisions made
1. Rejected: Node/Express + SQLite on company hosting (needs IT hosting, which the owner wants to avoid for now). Kept as fallback if IT refuses an external Google account.
2. Rejected: GitHub Pages alone (static, cannot keep data private).
3. Rejected: Supabase (owner does not want to spend money; free tier pauses).
4. Chosen: GitHub Pages frontend + Google Apps Script backend + Google Sheet as database, in a fresh Google account only the owner controls.

## What is built (all in this folder)
- `frontend/` plain HTML, CSS, JS, no build step. `config.js` has `API_URL`. Empty `API_URL` runs a demo mode with a simulated backend in `localStorage` (mock inside `app.js`).
- `backend/Code.gs` Apps Script web app. Actions: login, me, logout, changePassword, myEntries (returns own attendance too), addEntry, updateEntry, deleteEntry, setMyDay (In office / WFH / On leave, own days only, Attendance tab), adminEntries, adminUsers, adminCreateUser, adminResetPassword, adminSetActive. Setup functions: `setup`, `createUsersFromRoster`, `benchmarkHash`, `weeklyBackup`.
- `backend/Reports.gs` second Apps Script file. Builds a separate `MIB Workload Reports` spreadsheet (Dashboard with charts, Monthly heat map, Attendance, All entries, Read me) with no Users data, so it can be exported to Excel or shared view-only. `MIB Workload` menu via `onOpen`; `installTriggers` sets hourly refresh and Monday backup. Rendering calls (charts, banding, conditional formats) have NOT run in Google's runtime; the pure data functions are tested.
- `tests/backend.test.js` runs the real `Code.gs` in Node against stubbed Google services. 74 checks pass, including cross-member read, edit and delete attempts on entries and work mode, and the reports data functions.
- `tests/ui.test.py` Playwright smoke test of the demo mode. 18 checks pass.
- `README.md` deployment steps.

## Design
Plus Jakarta Sans (headings, figures, labels) and Source Sans 3 (body, matches avianwe.com). Colours are sampled from the avianwe.com header: crimson `#a50550`, maroon `#7f043b`, nav maroon `#691337`, charcoal `#363636`. Category colours (`CAT_COLORS` in `app.js`) stay inside this family; do not introduce off-brand hues. Green, amber and red are used only for status meaning. All tokens are CSS variables at the top of `frontend/styles.css`; swap in the official guideline values when available. Logo PNGs in `frontend/assets/` are cut from a screenshot (low resolution); replace with official files at the same names. `frontend/motion.js` plays entrance animations only when the screen or admin tab changes, counts up headline figures, and is disabled under prefers-reduced-motion.

## Not verified, do these before rollout
- `Code.gs` has never run in Google's real runtime. Deploy, then run `benchmarkHash`. If one hash takes more than about 700 ms, lower `CFG.PBKDF_ROUNDS`.
- Apps Script quotas and latency for 21 users are untested.
- Governance: MIB work data would sit in a Google account outside Avian We. systems. The owner needs internal approval. The director can read all entries, so the team must be told.
- Repo: github.com/BireshwarChakravarty/MIB-Timesheet. Pages deploys `/frontend` via `.github/workflows/pages.yml`; set Settings > Pages > Source to GitHub Actions. Free GitHub Pages needs a public repo.

## Known gaps and ideas
- Roster of real names and roles for the 21 members has not been provided. Demo uses placeholder names.
- Hashing is salted iterated SHA-256 (no bcrypt in Apps Script). Acceptable for this use, below industry standard.
- Sessions use CacheService (max 6 hours, may expire earlier).
- Entries are filtered in memory per request. Archive old rows if the sheet grows large.
- Possible additions: weekly email summary to the admin, per-project or per-deliverable tagging, leave and holiday handling in capacity.

## Owner's working preferences
- No em dashes or en dashes anywhere, including code comments and UI text.
- Company name is written "Avian We." with the full stop.
- Blunt, direct output with no filler. If something cannot be done, say so immediately.
- Do not fabricate. Mark anything unverified as unverified.
- Deliver the final output on the first attempt.
