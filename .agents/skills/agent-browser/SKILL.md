---
name: agent-browser
description: Drive a real headless browser from the shell to open pages, read them as accessibility trees, click/fill/submit elements, and verify what a real browser (not curl) sees — use for E2E flows, Cloudflare-challenged pages, and anything that needs actual browser rendering.
---

# agent-browser

Native Rust CLI giving the agent a persistent browser, one short shell command at a time.
Installed globally: `agent-browser` (v0.45+, `npm i -g agent-browser`). First-time setup
downloads Chrome for Testing: `agent-browser install --with-deps` (Linux).

## Core loop

```bash
agent-browser open <url>          # navigate (daemon auto-starts, browser stays open)
agent-browser snapshot -i         # interactive elements as compact text with refs (@e1, @e2…)
agent-browser click @e1           # act on a ref from the LAST snapshot
agent-browser fill @e3 "text"     # fill inputs
agent-browser get url             # current URL / title / text — verify the result
agent-browser close               # end of task
```

- Refs describe the page AT SNAPSHOT TIME — after any navigation or DOM change, take a
  NEW snapshot before using refs again.
- `find` works without refs: `agent-browser find role button click --name "Submit"`.
- A click FAILS (instead of fake-successing) when the target is hidden, disabled, offscreen,
  or covered (consent banners). Dismiss the covering element, re-snapshot, retry.
- Commands: navigate/read `open back forward reload read snapshot get is`; interact
  `click dblclick fill type press hover focus select check scroll upload find`;
  wait `wait`; sessions `--session <name>` for parallel browsers; JS eval `eval`.
- `--cdp` / `--auto-connect` attach to an already-running Chrome.

## When to reach for it here (elbaz-platform)

- The canonical domain `https://ahmedelbaz.qzz.io` sits behind a Cloudflare managed
  challenge that 403s curl ("Just a moment…") — only a real browser can verify what a
  human visitor actually sees (login, register, admin approve/reject pages).
- E2E of the registration → admin-approval → login journey: register via the UI, watch
  the resulting pages, exercise the approval action URL the way the owner's email click
  does (`/api/approval/action?token=…`).
- Screenshot evidence: `agent-browser screenshot path.png` before/after critical steps.
