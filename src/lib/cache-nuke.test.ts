/**
 * Unit tests — public/cache-nuke.js (the single client-side recovery owner).
 *
 * The file is a vanilla-JS IIFE served from public/ (no bundler), so these
 * tests execute it inside a `vm` sandbox with a hand-rolled DOM/storage stub
 * and assert the recovery CONTRACT:
 *
 *   - first visit records the build id, never reloads
 *   - deploy drift (stored buildId != /api/version) → one full nuke+reload
 *   - STALE HTML SHELL (page token != live buildId) → nuke EVEN IF
 *     localStorage already holds the new buildId (the poisoned-desktop trap
 *     from the 2026-11-16 incident that left users on a dead dark page)
 *   - matching token+buildId → calm, zero reloads
 *   - untrustworthy ids (dev/unknown/runtime-*) never trigger nukes
 *   - /api/version failure → no reload, no crash (offline tolerance)
 *   - the nuke cap (2/session) renders the recovery banner INSTEAD of a
 *     third reload — reload loops are impossible by construction
 *   - `elbaz:edge-challenge` (dispatched by trpc.tsx on cf-mitigated 403s):
 *     first event → exactly one recovery navigation; persistent challenge →
 *     guidance banner, never a loop
 *   - __nukeAndReload is exported for the index.html self-heal listener
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_NUKE_SRC = readFileSync(
  path.resolve(HERE, "../../public/cache-nuke.js"),
  "utf-8"
);

class FakeElement {
  style: { cssText: string } = { cssText: "" };
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<() => void>>();
  textContent = "";
  innerHTML = "";
  constructor(
    private doc: FakeDocument,
    public tagName: string,
  ) {}
  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
    if (key === "id") this.doc.byId.set(value, this);
  }
  getAttribute(key: string): string | null {
    return this.attributes.get(key) ?? null;
  }
  appendChild(child: FakeElement): void {
    this.children.push(child);
    if (child.attributes.get("id")) {
      this.doc.byId.set(child.attributes.get("id") as string, child);
    }
  }
  addEventListener(_type: string, fn: () => void): void {
    // click listeners are registered but never fired by these tests
    void fn;
  }
}

class FakeDocument {
  byId = new Map<string, FakeElement>();
  body = new FakeElement(this, "BODY");
  documentElement = new FakeElement(this, "HTML");
  readyState = "complete";
  scriptTags: FakeElement[] = [];
  getElementById(id: string): FakeElement | null {
    return this.byId.get(id) ?? null;
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  querySelectorAll(selector: string): FakeElement[] {
    // Faithful enough: the recovery code only ever queries its own tag.
    return selector.includes("cache-nuke.js") ? this.scriptTags : [];
  }
}

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

interface SandboxOptions {
  token: string | null;
  versionBody: { buildId?: string } | null;
  versionFails?: boolean;
  localStorageSeed?: Record<string, string>;
  sessionStorageSeed?: Record<string, string>;
}

interface Harness {
  reloads: number;
  cachesCleared: number;
  workersUnregistered: number;
  dispatchEdgeChallenge: () => void;
  sandbox: Record<string, unknown>;
  doc: FakeDocument;
  localStorage: FakeStorage;
  sessionStorage: FakeStorage;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 8));
}

function createHarness(opts: SandboxOptions): Harness {
  const doc = new FakeDocument();
  const localStorage = new FakeStorage();
  const sessionStorage = new FakeStorage();
  for (const [k, v] of Object.entries(opts.localStorageSeed ?? {})) {
    localStorage.setItem(k, v);
  }
  for (const [k, v] of Object.entries(opts.sessionStorageSeed ?? {})) {
    sessionStorage.setItem(k, v);
  }

  const harness: Harness = {
    reloads: 0,
    cachesCleared: 0,
    workersUnregistered: 0,
    dispatchEdgeChallenge: () => {},
    sandbox: {},
    doc,
    localStorage,
    sessionStorage,
  };

  // The token the page's own <script src="/cache-nuke.js?v=..."> carries.
  const tokenEl = new FakeElement(doc, "SCRIPT");
  tokenEl.setAttribute(
    "src",
    opts.token === null ? "/cache-nuke.js" : `/cache-nuke.js?v=${opts.token}`,
  );
  doc.scriptTags = [tokenEl];

  const cachesStub = {
    keys: async () => ["precache-v1", "js-css-cache"],
    delete: async () => {
      harness.cachesCleared++;
      return true;
    },
  };
  const navigatorStub = {
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => void harness.workersUnregistered++ },
      ],
    },
  };
  const sandbox: Record<string, unknown> = {
    console: { warn: () => {}, error: () => {}, log: () => {} },
    document: doc,
    localStorage,
    sessionStorage,
    caches: cachesStub,
    navigator: navigatorStub,
    fetch: async () => {
      if (opts.versionFails) throw new TypeError("Failed to fetch");
      return {
        ok: true,
        json: async () => opts.versionBody,
      };
    },
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
    window: {},
  };
  // Faithful browser emulation: `caches`/`navigator` live on window too
  // (cache-nuke feature-detects with `"caches" in window`).
  const windowObj = {
    caches: cachesStub,
    navigator: navigatorStub,
    location: {
      reload: () => {
        harness.reloads++;
      },
    },
    listeners: {} as Record<string, Array<() => void>>,
    addEventListener(type: string, fn: () => void): void {
      (windowObj.listeners[type] ||= []).push(fn);
    },
  };
  sandbox.window = windowObj;
  sandbox.globalThis = sandbox;
  harness.dispatchEdgeChallenge = () => {
    for (const fn of windowObj.listeners["elbaz:edge-challenge"] ?? []) fn();
  };
  harness.sandbox = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(CACHE_NUKE_SRC, sandbox, { filename: "cache-nuke.js" });
  return harness;
}

describe("cache-nuke.js — client recovery contract", () => {
  beforeEach(() => {});

  it("exports __nukeAndReload for the index.html self-heal listener", () => {
    const h = createHarness({ token: "b2", versionBody: { buildId: "b2" } });
    expect(typeof h.sandbox.__nukeAndReload).toBe("function");
  });

  it("first visit: stores the build id and never reloads", async () => {
    const h = createHarness({ token: "b1", versionBody: { buildId: "b1" } });
    await flush();
    expect(h.localStorage.getItem("elbaz_build_id")).toBe("b1");
    expect(h.reloads).toBe(0);
    expect(h.cachesCleared).toBe(0);
  });

  it("deploy drift (stored != server): one full nuke + reload", async () => {
    const h = createHarness({
      token: "b2",
      versionBody: { buildId: "b2" },
      localStorageSeed: { elbaz_build_id: "b1" },
    });
    await flush();
    expect(h.reloads).toBe(1);
    expect(h.cachesCleared).toBeGreaterThan(0);
    expect(h.workersUnregistered).toBeGreaterThan(0);
    expect(h.sessionStorage.getItem("elbaz_nuke_count")).toBe("1");
    expect(h.localStorage.getItem("elbaz_build_id")).toBe("b2");
  });

  it("STALE HTML SHELL with poisoned localStorage: nukes even though the version check would pass", async () => {
    // The 2026-11-16 poisoned-desktop trap: the shell in the browser is old
    // (token b1) while localStorage already holds the live buildId (b2).
    // The OLD cache-nuke compared localStorage only → never healed. The
    // token check must fire the recovery regardless.
    const h = createHarness({
      token: "b1",
      versionBody: { buildId: "b2" },
      localStorageSeed: { elbaz_build_id: "b2" },
    });
    await flush();
    expect(h.reloads).toBe(1);
    expect(h.cachesCleared).toBeGreaterThan(0);
    expect(h.localStorage.getItem("elbaz_build_id")).toBe("b2");
  });

  it("matching token + buildId + storage: calm, zero reloads", async () => {
    const h = createHarness({
      token: "b2",
      versionBody: { buildId: "b2" },
      localStorageSeed: { elbaz_build_id: "b2" },
    });
    await flush();
    expect(h.reloads).toBe(0);
    expect(h.cachesCleared).toBe(0);
  });

  it("untrustworthy ids (dev/unknown/runtime-) never trigger nukes", async () => {
    const h = createHarness({
      token: "dev",
      versionBody: { buildId: "runtime-abc123" },
      localStorageSeed: { elbaz_build_id: "old-1" },
    });
    await flush();
    expect(h.reloads).toBe(0);
  });

  it("/api/version failure: no reload, no crash (offline tolerance)", async () => {
    const h = createHarness({
      token: "b1",
      versionFails: true,
      localStorageSeed: { elbaz_build_id: "b1" },
    });
    await flush();
    expect(h.reloads).toBe(0);
    expect(h.doc.getElementById("elbaz-recovery-banner")).toBeNull();
  });

  it("nuke cap (2/session): the third trigger renders the banner instead of reloading", async () => {
    const h = createHarness({
      token: "b1",
      versionBody: { buildId: "b2" },
      localStorageSeed: { elbaz_build_id: "b1" },
      sessionStorageSeed: { elbaz_nuke_count: "2" },
    });
    await flush();
    expect(h.reloads).toBe(0); // capped — no reload loop
    expect(h.doc.getElementById("elbaz-recovery-banner")).not.toBeNull();
  });

  it("edge challenge: first event → exactly one recovery navigation; persistence → banner, never a loop", async () => {
    const h = createHarness({
      token: "b2",
      versionBody: { buildId: "b2" },
      localStorageSeed: { elbaz_build_id: "b2" },
    });
    await flush();
    expect(h.reloads).toBe(0);

    h.dispatchEdgeChallenge();
    await flush();
    expect(h.reloads).toBe(1); // the single sanctioned recovery navigation
    expect(h.sessionStorage.getItem("elbaz_cf_challenge_reload")).toBe("1");
    expect(h.doc.getElementById("elbaz-recovery-banner")).toBeNull();

    h.dispatchEdgeChallenge(); // challenge persists after the reload
    await flush();
    expect(h.reloads).toBe(1); // STILL one — no loop
    expect(h.doc.getElementById("elbaz-recovery-banner")).not.toBeNull();
  });

  it("a stale shell on a poisoned session still respects the cap and ends in the banner — never a loop", async () => {
    // Worst case: EVERY load keeps serving a stale shell (aggressive
    // intermediate cache). The cap must turn reloads OFF after 2.
    const h = createHarness({
      token: "b1",
      versionBody: { buildId: "b2" },
      localStorageSeed: { elbaz_build_id: "b1" },
      sessionStorageSeed: { elbaz_nuke_count: "2" },
    });
    await flush();
    expect(h.reloads).toBe(0);
    expect(h.doc.getElementById("elbaz-recovery-banner")).not.toBeNull();
  });
});
