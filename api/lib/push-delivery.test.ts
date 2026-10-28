import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted — web-push never touches the network in tests) ──
const mockEnv = vi.hoisted(() => ({
  VAPID_PUBLIC_KEY: "BElbazTestPublicKey__aaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  VAPID_PRIVATE_KEY: "OElbazTestPrivateKey_aaaaaaaaaaaaaaaaaaaaaaa",
  VAPID_SUBJECT: "mailto:test@ahmedelbaz.qzz.io",
  isProduction: false,
}));

const setVapidDetails = vi.hoisted(() => vi.fn());
const sendNotification = vi.hoisted(() => vi.fn());

vi.mock("web-push", () => ({
  default: { setVapidDetails, sendNotification },
  setVapidDetails,
  sendNotification,
}));

vi.mock("./env", () => ({ env: mockEnv }));

const getDb = vi.hoisted(() => vi.fn());
vi.mock("../queries/connection", () => ({ getDb }));

import {
  buildPushPayload,
  getVapidPublicKey,
  isStalePushResponse,
  sendWebPushToAll,
} from "./push-delivery";

const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "k".repeat(87), auth: "a".repeat(24) };

function mockDb(subs: Array<{ endpoint: string; p256dh: string; auth: string }>) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
  const fromFn = vi.fn().mockResolvedValue(subs);
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  getDb.mockReturnValue({ select: selectFn, delete: deleteFn });
  return { deleteFn, deleteWhere, selectFn, fromFn };
}

beforeEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockReset().mockReturnValue(undefined);
});

describe("isStalePushResponse", () => {
  it("flags 404 and 410 as stale (subscription is dead)", () => {
    expect(isStalePushResponse(404)).toBe(true);
    expect(isStalePushResponse(410)).toBe(true);
  });

  it("keeps transport/4xx/5xx errors as retryable, not stale", () => {
    expect(isStalePushResponse(500)).toBe(false);
    expect(isStalePushResponse(429)).toBe(false);
    expect(isStalePushResponse(undefined)).toBe(false);
  });
});

describe("buildPushPayload", () => {
  it("carries all display fields", () => {
    const payload = JSON.parse(
      buildPushPayload({ eventId: "e1", type: "youtube", title: "T", message: "M", url: "/x", channelUrl: "/c" })
    ) as Record<string, unknown>;
    expect(payload["eventId"]).toBe("e1");
    expect(payload["type"]).toBe("youtube");
    expect(payload["url"]).toBe("/x");
    expect(payload["channelUrl"]).toBe("/c");
  });

  it("truncates title/message into the ~4KB push budget", () => {
    const raw = buildPushPayload({
      eventId: "e2",
      type: "system",
      title: "ع".repeat(5000),
      message: "ب".repeat(5000),
    });
    const payload = JSON.parse(raw) as { title: string; message: string };
    expect(payload.title.length).toBeLessThanOrEqual(120);
    expect(payload.message.length).toBeLessThanOrEqual(300);
    expect(raw.length).toBeLessThan(4096);
  });
});

describe("configured VAPID", () => {
  it("exposes the public key when keys are set", () => {
    expect(getVapidPublicKey()).toBe(mockEnv.VAPID_PUBLIC_KEY);
    expect(setVapidDetails).toHaveBeenCalledWith(
      mockEnv.VAPID_SUBJECT,
      mockEnv.VAPID_PUBLIC_KEY,
      mockEnv.VAPID_PRIVATE_KEY
    );
  });

  it("fans the payload out to every subscription", async () => {
    mockDb([SUB, { ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/def" }]);
    sendNotification.mockResolvedValue(undefined);

    const result = await sendWebPushToAll({ eventId: "e1", type: "promo", title: "T", message: "M" });
    expect(result).toEqual({ sent: 2, stale: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [, payload] = sendNotification.mock.calls[0] as unknown as [object, string];
    expect(JSON.parse(payload)).toMatchObject({ eventId: "e1", type: "promo" });
  });

  it("deletes stale endpoints (404/410) but keeps retryable failures", async () => {
    const { deleteFn } = mockDb([SUB, { ...SUB, endpoint: "https://fcm.googleapis.com/fcm/send/gone" }]);
    sendNotification
      .mockRejectedValueOnce({ statusCode: 410 }) // dead — delete
      .mockRejectedValueOnce({ statusCode: 500 }); // transient — keep

    const result = await sendWebPushToAll({ eventId: "e1", type: "promo", title: "T", message: "M" });
    expect(result).toEqual({ sent: 0, stale: 1 });
    expect(deleteFn).toHaveBeenCalledTimes(1); // exactly the dead endpoint's row
  });

  it("is fire-and-forget safe when the DB is down", async () => {
    getDb.mockImplementation(() => {
      throw new Error("no db");
    });
    await expect(
      sendWebPushToAll({ eventId: "e1", type: "promo", title: "T", message: "M" })
    ).resolves.toEqual({ sent: 0, stale: 0 });
  });
});
