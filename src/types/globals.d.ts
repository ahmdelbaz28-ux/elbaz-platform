// Global type augmentations for runtime-injected objects.
//
// Several third-party scripts (Google Identity Services, Clarity, Capacitor)
// attach objects to the global scope at runtime. We declare them on
// `globalThis` (which is the spec-compliant way to reference the global
// object — see SonarCloud S7764) so TypeScript can type-check access
// without resorting to `any` casts.

// ─── Capacitor (mobile runtime) ────────────────────────────────────────────
interface CapacitorGlobal {
  isNativePlatform: () => boolean;
  getPlatform: () => "web" | "ios" | "android";
  convertFileSrc?: (filePath: string) => string;
}

// ─── Google Identity Services ──────────────────────────────────────────────
interface GoogleAccountsId {
  initialize: (config: unknown) => void;
  renderButton: (parent: HTMLElement, options: unknown) => void;
  prompt: () => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}
interface GoogleAccounts {
  id: GoogleAccountsId;
}
interface GoogleGlobal {
  accounts: GoogleAccounts;
}

// ─── Microsoft Clarity ────────────────────────────────────────────────────
interface ClarityQueueItem {
  push: (...args: unknown[]) => void;
}
interface ClarityFn {
  (...args: unknown[]): void;
  q?: ClarityQueueItem[];
  identifier?: (uniqueId: string, sessionId?: string, pageId?: string, friendlyId?: string) => void;
  event?: (eventName: string, customTags?: Record<string, unknown>) => void;
  set?: (key: string, value: unknown) => void;
  upgrade?: (upgradeReason: string) => void;
  consent?: (consent: boolean) => void;
}

// ─── App-injected env (set by index.html before main.ts loads) ────────────
interface AppEnv {
  CLARITY_PROJECT_ID?: string;
  [key: string]: string | undefined;
}

// Augment the globalThis object so `globalThis.Capacitor` etc. type-check.
declare global {
  var Capacitor: CapacitorGlobal | undefined;
  var google: GoogleGlobal | undefined;
  var clarity: ClarityFn | undefined;
  var __ENV__: AppEnv | undefined;
  var __nukeAndReload: ((reason: string, source: string) => void) | undefined;
  var __loadGsi: (() => void) | undefined;
}

export {};
