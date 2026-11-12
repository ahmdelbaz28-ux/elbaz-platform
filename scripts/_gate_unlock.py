"""Shared subscribe-gate unlock helper for local E2E scripts.

The gate is now a HARD two-step flow with NO skip button
(«أنا مشترك بالفعل» was removed in 2026 — owner contract):
  1. «اشترك الآن» opens YouTube's native confirm dialog (?sub_confirmation=1)
  2. «اشتركت — افتح الفيديوهات» confirms and unlocks the player

For E2E we stub window.open so the scripts never actually leave the page,
and we assert the subscribe URL was opened with sub_confirmation=1.
"""
import re

GATE = "[data-testid=subscribe-gate]"
GATE_OPEN = "[data-testid=subscribe-gate-open]"
GATE_CONFIRM = "[data-testid=subscribe-gate-unlock]"

_STUB_OPEN = (
    "() => { globalThis.__e2ePopups = []; "
    "globalThis.open = (u) => { globalThis.__e2ePopups.push(String(u)); return null; }; }"
)


def gate_visible(page) -> bool:
    gate = page.locator(GATE)
    try:
        return gate.count() > 0 and gate.first.is_visible()
    except Exception:
        return False


def unlock_subscribe_gate(page, wait_ms: int = 1500) -> list:
    """Run the enforced subscribe flow on `page`, return the popup URLs.

    Raises nothing on its own; locators will raise if the gate is absent, so
    callers should check `gate_visible` first (same contract as before).
    """
    page.evaluate(_STUB_OPEN)
    page.locator(GATE_OPEN).first.click()
    page.wait_for_timeout(600)
    page.locator(GATE_CONFIRM).first.click()
    page.wait_for_timeout(wait_ms)
    return page.evaluate("() => globalThis.__e2ePopups || []")


def assert_subscribe_url(popups: list) -> bool:
    """True when at least one popup opened the channel confirm-subscribe URL."""
    return any(re.search(r"sub_confirmation=1", str(u)) for u in popups)
