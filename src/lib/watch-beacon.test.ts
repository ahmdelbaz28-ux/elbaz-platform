import { describe, expect, it } from "vitest";
import { buildHeartbeatBeaconBlob } from "./watch-beacon";

// ✅ ROOT-CURE regression (2026-11-13): the beforeunload beacon used to POST
// the RAW progress JSON while the tRPC endpoint parses the superjson envelope
// — the final save was silently discarded on every tab close. The blob must
// be the exact envelope shape the tRPC client itself sends.
describe("buildHeartbeatBeaconBlob — superjson envelope", () => {
  it("wraps the input in the { json: ... } envelope tRPC parses", async () => {
    const blob = buildHeartbeatBeaconBlob({ lessonId: 12, watchedSeconds: 45, lastPosition: 310 });
    expect(blob.type).toBe("application/json");
    const parsed = JSON.parse(await blob.text()) as { json?: { lessonId?: number; watchedSeconds?: number; lastPosition?: number } };
    expect(parsed.json).toEqual({ lessonId: 12, watchedSeconds: 45, lastPosition: 310 });
  });

  it("keeps numbers as numbers (no string coercion)", async () => {
    const parsed = JSON.parse(await buildHeartbeatBeaconBlob({ lessonId: 1, watchedSeconds: 0, lastPosition: 0 }).text()) as { json?: Record<string, unknown> };
    expect(typeof parsed.json?.lessonId).toBe("number");
    expect(typeof parsed.json?.watchedSeconds).toBe("number");
    expect(typeof parsed.json?.lastPosition).toBe("number");
  });
});
