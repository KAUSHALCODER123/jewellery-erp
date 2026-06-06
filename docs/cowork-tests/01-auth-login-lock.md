# 01 — Authentication: Login, Lock/Unlock, Roles

**Prerequisite:** App open on the Login screen. (If it shows Setup, create admin first.)

---

## A. Happy-path login
1. On the Login screen, confirm three selectors/fields are visible: **Firm / Entity**, **Financial Year**, **Username**, **Password**, and a **Sign In** button.
2. Leave Firm = **Shree Jewelers** and Financial Year = current FY.
3. Username: `admin`  ·  Password: `admin1234`.
4. Click **Sign In**.
5. **Expected:** lands on a dashboard. Because admin is an executive, the left sidebar shows the full menu including MIS Dashboard, Day Book, GST Reports, GST e-Docs, Scheme Builder, Refinery, Report Builder, Print Templates, Backup & Recovery.
6. Bottom-left of sidebar shows `admin`, role `ADMIN`, the firm name, and `FY …`.

## B. Lock / Unlock (this app's stand-in for logout)
1. Top-right header → click **Lock**.
2. **Expected:** full-screen "App Locked" overlay asking for the password.
3. Type the wrong password → **Expected:** error, stays locked.
4. Type `admin1234` → **Unlock** → returns to the same screen you were on.
5. **Idle auto-lock:** leave the app untouched for **5 minutes** (any mouse/key/scroll resets the timer). **Expected:** it auto-locks to the same overlay.

## C. Logout (now implemented — verify it works)
- The header now has **both** a **Logout** and a **Lock** button (top-right).
- Click **Logout**. **Expected:** session ends and you return to the Login screen; the auth token is revoked server-side (`POST /api/auth/logout` blacklists the token's jti).
- After logout, use the browser back button / try to reach `/dashboard` → **Expected:** cannot resume; redirected to Login.
- > Note: earlier versions of this app had **no** logout UI (only Lock). That gap is fixed — record **PASS** if Logout is present and ends the session.

---

## D. Edge cases — login

| # | Input / action | Expected | 
|---|----------------|----------|
| D1 | Username blank, password blank → Sign In | Rejected with a clear message; no crash |
| D2 | Correct username `admin`, wrong password | "Invalid credentials" style error; stays on login |
| D3 | Unknown username `nosuchuser` / any password | Same generic error (must NOT reveal whether user exists) |
| D4 | Username `ADMIN` (uppercase) + `admin1234` | Should still log in — both client and server lowercase the username, so it resolves to the identical user. Casing must NOT change any data shown (see G) |
| D5 | Username `  admin  ` with leading/trailing spaces | Should still log in (trimmed) |
| D6 | Password with trailing space `admin1234 ` | Record behaviour (likely fails — passwords aren't trimmed) |
| D7 | Pick a different Financial Year, then log in | Header shows the FY you chose; data context respects it |
| D8 | Rapidly double-click **Sign In** | Exactly one login fires; button disables / shows "Signing In…"; no spurious "Invalid credentials". A synchronous submit latch now blocks the second click in the same tick |
| D9 | Very long username (500+ chars) | Handled gracefully, no crash |
| D10 | SQL-ish input e.g. `admin' OR '1'='1` as username | Rejected as bad credentials, never logs in |

## E. Edge cases — session / lock

| # | Action | Expected |
|---|--------|----------|
| E1 | Lock, then enter wrong password 5×| Still locked each time; no lockout-crash |
| E2 | While locked, inspect the page DOM / network for ledger or customer data | **Not present** — the active screen is unmounted while locked (only the lock overlay renders), so customer/ledger data is not left in the DOM and no screen data is refetched until unlock. Verify in DevTools that the data is gone, not merely hidden |
| E3 | Log in, reload the page / reopen the app | **Stays signed in** — the session (token + user) is persisted to `localStorage` and restored on load. Only an expired token or Logout returns you to Login |
| E4 | Log in as a non-admin user (create one first via **Users**) | Restricted menu — MIS/GST/Backup/etc. hidden; confirm those routes can't be reached by URL either |

## F. Dashboard KPI cards (regression check for the "0 vs populated" bug)
1. After login, land on **Dashboard** (Inventory & Rates).
2. **Expected:** the top metric cards — **Items In-Stock**, **Gold Weight**, **Silver Weight** — show the **real totals** (with seed data: 10 items, 126.650 g gold) and **match the item table below**.
3. They must NOT stick at `0` while the table is populated. The cards animate (count-up) but now **snap to the true value** even under a backgrounded tab, reduced-motion, or an automation-driven browser. If you ever see `0` on a card while the table has rows, that is a FAIL — capture it.

## G. What to report
- PASS/FAIL per row above, with the exact on-screen message for each rejection.
- Screenshot of the full admin sidebar (proves role-based menu).
- E2: a DevTools screenshot showing screen data is **absent from the DOM** while locked.
- F: confirm KPI cards match the table (no stuck-at-0).
