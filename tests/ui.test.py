# UI smoke test in demo mode. Usage: python3 tests/ui.test.py
import os, sys, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "index.html"
shots = pathlib.Path(__file__).resolve().parent / "shots"
shots.mkdir(exist_ok=True)
errors, results = [], []

def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS  " if cond else "FAIL  ") + name)

def login(page, uid, pw):
    page.fill("#uid", uid); page.fill("#pw", pw); page.click("#loginBtn")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
    ctx = b.new_context(viewport={"width": 1366, "height": 900})
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts" not in m.text and "ERR_FAILED" not in m.text and "ERR_FILE_NOT_FOUND" not in m.text else None)
    page.goto(root.as_uri())
    page.wait_for_selector("#loginForm")
    page.screenshot(path=str(shots / "01-login.png"))

    login(page, "mib01", "wrong")
    page.wait_for_function("document.querySelector('#loginErr').textContent.length>0")
    check("wrong password shows error", "incorrect" in page.inner_text("#loginErr"))

    # first sign-in flow
    page.fill("#uid", "mib08"); page.fill("#pw", "Welcome@01"); page.click("#loginBtn")
    page.wait_for_selector("#pwForm")
    check("mib08 forced to change password", "Set your password" in page.inner_text("h2"))
    page.fill("#cp", "Welcome@01"); page.fill("#np", "short"); page.fill("#np2", "short"); page.click("#pwForm button[type=submit]")
    page.wait_for_function("document.querySelector('#pwErr').textContent.length>0")
    check("weak password rejected in UI", "10 characters" in page.inner_text("#pwErr"))
    page.fill("#np", "NewPassword2026"); page.fill("#np2", "NewPassword2026"); page.click("#pwForm button[type=submit]")
    page.wait_for_selector("#entryForm")
    check("mib08 reaches member screen after change", "Log your work" in page.inner_text("h1"))
    page.click("#btnOut"); page.wait_for_selector("#loginForm")

    # member flow
    login(page, "mib01", "Welcome@01")
    page.wait_for_selector("#entryForm")
    page.wait_for_selector(".entry")
    page.screenshot(path=str(shots / "02-member.png"), full_page=True)
    before = page.locator(".entry").count()
    page.fill("#f_hours", "2.5"); page.fill("#f_task", "Test entry from UI"); page.select_option("#f_cat", "Graphic design"); page.select_option("#f_plat", "X")
    page.click("#saveBtn")
    page.wait_for_function("document.querySelectorAll('.entry').length > %d" % before)
    check("member adds entry and list grows", page.locator(".entry").count() == before + 1)
    check("new entry visible", "Test entry from UI" in page.inner_text("#entryList"))
    page.fill("#f_hours", "1.3"); page.fill("#f_task", "Bad hours"); page.select_option("#f_cat", "Graphic design"); page.select_option("#f_plat", "X"); page.click("#saveBtn")
    page.wait_for_function("document.querySelector('#formErr').textContent.length>0")
    check("invalid hours rejected", "0.25" in page.inner_text("#formErr"))
    page.click("[data-edit]")
    check("edit mode switches button", page.inner_text("#saveBtn") == "Save changes")
    page.click("#cancelEdit")
    page.once("dialog", lambda d: d.accept())
    page.locator("[data-del]").first.click()
    page.wait_for_function("document.querySelectorAll('.entry').length == %d" % before)
    check("delete removes entry", page.locator(".entry").count() == before)
    page.click("#btnOut"); page.wait_for_selector("#loginForm")

    # admin flow
    login(page, "admin", "Admin@123")
    page.wait_for_selector(".figures")
    page.wait_for_selector("tbody tr")
    page.screenshot(path=str(shots / "03-admin-overview.png"), full_page=True)
    check("overview shows member rows", page.locator("tbody tr").count() >= 7)
    check("over capacity badge present", page.locator(".badge.bad").count() >= 1)
    check("low load badge present", page.locator(".badge.warn").count() >= 1)
    page.click("[data-tab=entries]"); page.wait_for_selector("#entRows tr")
    page.screenshot(path=str(shots / "04-admin-entries.png"), full_page=True)
    rows_all = page.locator("#entRows tr").count()
    page.select_option("#fm", "mib03")
    check("member filter narrows rows", 1 < page.locator("#entRows tr").count() < rows_all)
    with page.expect_download() as dl:
        page.click("#btnCsv")
    check("CSV downloads", dl.value.suggested_filename.endswith(".csv"))
    page.click("[data-tab=team]"); page.wait_for_selector("#addForm")
    page.fill("#nm", "Test Person"); page.fill("#tr", "Video Editor"); page.click("#addForm button[type=submit]")
    page.wait_for_selector(".cred-box")
    check("new account shows one-time credentials", "mib09" in page.inner_text(".cred-box"))
    page.screenshot(path=str(shots / "05-admin-team.png"), full_page=True)

    # mobile
    m = b.new_context(viewport={"width": 390, "height": 844})
    m.route("**/fonts.g*/**", lambda r: r.abort())
    mp = m.new_page(); mp.goto(root.as_uri()); mp.wait_for_selector("#loginForm")
    mp.screenshot(path=str(shots / "06-mobile-login.png"))
    login(mp, "mib02", "Welcome@01"); mp.wait_for_selector(".entry")
    mp.screenshot(path=str(shots / "07-mobile-member.png"), full_page=True)
    sw = mp.evaluate("document.documentElement.scrollWidth"); cw = mp.evaluate("document.documentElement.clientWidth")
    check("no horizontal page scroll on mobile", sw <= cw + 1)
    b.close()

check("no console or page errors", not errors)
if errors: print(errors)
print("\n%d passed, %d failed" % (sum(1 for _, ok in results if ok), sum(1 for _, ok in results if not ok)))
sys.exit(0 if all(ok for _, ok in results) else 1)
