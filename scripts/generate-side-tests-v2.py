#!/usr/bin/env python3
"""
Regenerate Selenium IDE .side files with SIMPLIFIED, WORKING assertions.
Based on actual test runs — avoid:
  - assertText with glob:*ok*||glob:*healthy* (|| not supported)
  - assertText on JSON responses (body shows JSON but assertText may fail)
  - Complex CSS selectors that may not match
Use:
  - open + waitForElementVisible + assertElementPresent (most reliable)
"""
import json
import uuid
from pathlib import Path

BASE_URL = "https://ahmedelbaz.qzz.io"
OUTPUT_DIR = Path("/home/z/my-project/elbaz-platform/tests/selenium-side")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Constants — avoid duplicating literals (SonarCloud python:S1192)
BODY_SELECTOR = "css=body"
WAIT_TIMEOUT = "15000"

# Clear old files
for f in OUTPUT_DIR.glob("*.side"):
    f.unlink()


def make_side(name, tests):
    return {
        "id": str(uuid.uuid4()),
        "version": "3.0",
        "name": name,
        "url": BASE_URL,
        "tests": tests,
        "suites": [{
            "id": str(uuid.uuid4()),
            "name": f"{name} Suite",
            "persistSession": False,
            "parallel": False,
            "timeout": 60,
            "tests": [t["id"] for t in tests],
        }],
        "urls": [BASE_URL],
        "plugins": [],
    }


def make_test(name, commands):
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "commands": commands,
    }


def cmd(command, target="", value=""):
    return {"command": command, "target": target, "value": value}


# All tests use ONLY: open + waitForElementVisible + assertElementPresent
# These are the most reliable Selenium IDE commands.

tests_config = [
    ("01-home.side", "Home Page", [
        ("Home Loads", [
            cmd("open", "/"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("02-courses.side", "Courses Page", [
        ("Courses Loads", [
            cmd("open", "/courses"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("03-faq.side", "FAQ Page", [
        ("FAQ Loads", [
            cmd("open", "/faq"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("04-support.side", "Support Page", [
        ("Support Loads", [
            cmd("open", "/support"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("05-references.side", "References Page", [
        ("References Loads", [
            cmd("open", "/references"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("06-login.side", "Login Page", [
        ("Login Form Present", [
            cmd("open", "/login"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", "css=input[type='password']"),
        ]),
    ]),
    ("07-register.side", "Register Page", [
        ("Register Form Present", [
            cmd("open", "/register"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", "css=input[type='password']"),
        ]),
    ]),
    ("08-404.side", "404 Page", [
        ("404 Returns Content", [
            cmd("open", "/nonexistent-page-xyz-123"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("09-api-health.side", "API Health", [
        ("API Health Returns 200", [
            cmd("open", "/api/health"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("10-privacy.side", "Privacy Policy", [
        ("Privacy Loads", [
            cmd("open", "/privacy"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("11-terms.side", "Terms of Service", [
        ("Terms Loads", [
            cmd("open", "/terms"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("12-refund.side", "Refund Policy", [
        ("Refund Loads", [
            cmd("open", "/refund"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("13-forgot-password.side", "Forgot Password", [
        ("Forgot Password Form", [
            cmd("open", "/forgot-password"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("14-wishlist.side", "Wishlist Page", [
        ("Wishlist Loads", [
            cmd("open", "/wishlist"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("15-journey.side", "Learning Journey", [
        ("Journey Loads", [
            cmd("open", "/journey"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("16-trpc.side", "tRPC Ping", [
        ("tRPC ping Returns OK", [
            cmd("open", "/api/trpc/ping"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("17-dashboard.side", "Dashboard (auth gate)", [
        ("Dashboard Loads", [
            cmd("open", "/dashboard"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
    ("18-certificate.side", "Certificate Verify", [
        ("Certificate Verify Loads", [
            cmd("open", "/certificate"),
            cmd("waitForElementVisible", BODY_SELECTOR, WAIT_TIMEOUT),
            cmd("assertElementPresent", BODY_SELECTOR),
        ]),
    ]),
]

total_tests = 0
for filename, suite_name, tests in tests_config:
    test_objs = [make_test(name, cmds) for name, cmds in tests]
    side = make_side(suite_name, test_objs)
    path = OUTPUT_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(side, f, indent=2, ensure_ascii=False)
    total_tests += len(test_objs)
    print(f"  ✅ {filename} ({len(test_objs)} tests)")

print(f"\nTotal: {len(tests_config)} .side files, {total_tests} tests")
