import { shortTTLCache } from '../core/cache-engine';

interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  role: string;
  issuedAt: number;
  expiresAt: number;
  lastActivity: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

class SessionCache {
  private cache = shortTTLCache;
  private inactivityTimeout: number;
  private sessionMaxLifetime: number;
  private refreshThreshold: number;
  private heartbeatInterval: ReturnType<typeof setInterval> | null;

  constructor(options: { inactivityTimeoutMs?: number; sessionMaxLifetimeMs?: number; refreshThresholdMs?: number } = {}) {
    this.inactivityTimeout = options.inactivityTimeoutMs ?? 1800000;
    this.sessionMaxLifetime = options.sessionMaxLifetimeMs ?? 86400000;
    this.refreshThreshold = options.refreshThresholdMs ?? 300000;
    this.heartbeatInterval = setInterval(() => this.evictStaleSessions(), 60000);
  }

  createSession(session: SessionData): void {
    const now = Date.now();
    const entry = { ...session, issuedAt: now, expiresAt: now + this.sessionMaxLifetime, lastActivity: now };
    this.cache.set(`session:byId:${session.sessionId}`, entry, { ttl: this.inactivityTimeout, tags: [`tag:session:user:${session.userId}`] });
    this.cache.set(`session:token:${session.sessionId}`, session.userId, { ttl: this.inactivityTimeout, tags: [`tag:session:user:${session.userId}`] });
  }

  getSession(sessionId: string): SessionData | null {
    const entry = this.cache.get<SessionData>(`session:byId:${sessionId}`);
    if (!entry) return null;
    const now = Date.now();
    if (now - entry.lastActivity > this.inactivityTimeout || now > entry.expiresAt) { this.destroySession(sessionId); return null; }
    if (now - entry.lastActivity > this.refreshThreshold) {
      entry.lastActivity = now;
      this.cache.set(`session:byId:${sessionId}`, entry, { ttl: this.inactivityTimeout, tags: [`tag:session:user:${entry.userId}`] });
    }
    return entry;
  }

  refreshSession(sessionId: string): SessionData | null {
    const entry = this.cache.get<SessionData>(`session:byId:${sessionId}`);
    if (!entry) return null;
    entry.lastActivity = Date.now();
    this.cache.set(`session:byId:${sessionId}`, entry, { ttl: this.inactivityTimeout, tags: [`tag:session:user:${entry.userId}`] });
    return entry;
  }

  destroySession(sessionId: string): void {
    const entry = this.cache.get<SessionData>(`session:byId:${sessionId}`);
    if (entry) {
      this.cache.invalidateTags([`tag:session:user:${entry.userId}`]);
    }
    this.cache.delete(`session:token:${sessionId}`);
  }

  destroyAllUserSessions(userId: string): number {
    return this.cache.invalidateTags([`tag:session:user:${userId}`]);
  }

  private evictStaleSessions(): number {
    let count = 0;
    const now = Date.now();
    for (const key of this.cache.keys()) {
      if (key.startsWith('session:byId:')) {
        const entry = this.cache.get<SessionData>(key);
        if (entry && (now - entry.lastActivity > this.inactivityTimeout || now > entry.expiresAt)) { this.destroySession(entry.sessionId); count++; }
      }
    }
    return count;
  }

  destroy(): void { if (this.heartbeatInterval) clearInterval(this.heartbeatInterval); this.cache.invalidateAll(); }
}

const sessionCache = new SessionCache();
export { SessionCache, sessionCache };
export type { SessionData };
