/**
 * VISION QUOTA LANE tests — regression lock for the 2026-11-13 root cure.
 *
 * ROOT BUG this locks out: live screen-teacher frames shared the 5/day image
 * quota with ordinary attachments. The screen-teacher contract demands a
 * fresh frame with EVERY message, so a real guidance session was killed after
 * five exchanges with a confusing "صور" quota notice — the advertised live
 * capability was unusable. The cure: a dedicated 60/day screen lane (still
 * hard-bounded by the 60/day per-IP message cap), attachments unchanged.
 */

import { describe, it, expect, vi } from "vitest";

// image-quota.ts imports the MySQL pool — never touched by the pure lane
// helpers, but the module import needs a stand-in.
vi.mock("../queries/connection.js", () => ({
  pool: { execute: vi.fn(async () => [[], []]) },
}));

import {
  visionQuotaLane,
  screenFrameQuotaKey,
  DAILY_IMAGE_LIMIT,
  DAILY_SCREEN_FRAME_LIMIT,
} from "./image-quota";

describe("visionQuotaLane — screen frames vs attachments", () => {
  it("plain attachments ride the small 5/day lane keyed by the raw IP", () => {
    const lane = visionQuotaLane(false, "203.0.113.9");
    expect(lane.screen).toBe(false);
    expect(lane.key).toBe("203.0.113.9");
    expect(lane.limit).toBe(DAILY_IMAGE_LIMIT);
    expect(lane.limit).toBe(5);
  });

  it("live screen frames ride the dedicated 60/day lane", () => {
    const lane = visionQuotaLane(true, "203.0.113.9");
    expect(lane.screen).toBe(true);
    expect(lane.limit).toBe(DAILY_SCREEN_FRAME_LIMIT);
    expect(lane.limit).toBe(60);
  });

  it("the screen lane key never collides with the attachment lane key", () => {
    expect(screenFrameQuotaKey("203.0.113.9")).toBe("203.0.113.9#screen");
    expect(screenFrameQuotaKey("203.0.113.9")).not.toBe("203.0.113.9");
    // Even an IP literally shaped like a screen key cannot collide.
    expect(screenFrameQuotaKey("x#screen")).toBe("x#screen#screen");
  });

  it("the screen allowance can never exceed the per-IP message-cap ceiling", () => {
    // The router's per-IP message quota is 60/day — a screen session cannot
    // send more frames than messages, so 60 is the tightest sound ceiling.
    expect(DAILY_SCREEN_FRAME_LIMIT).toBe(60);
  });

  it("lane selection is total (no falsey trap: screenCapture=false is respected)", () => {
    expect(visionQuotaLane(false, "ip").screen).toBe(false);
    expect(visionQuotaLane(true, "ip").screen).toBe(true);
  });
});
