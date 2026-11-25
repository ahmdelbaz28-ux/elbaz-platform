import { describe, expect, it } from "vitest";
import {
  AVATAR_DATA_URL_MAX_CHARS,
  AVATAR_MAX_INPUT_BYTES,
  avatarErrorMessage,
  isAcceptableAvatarDataUrl,
  isValidAvatarFile,
  type AvatarErrorCode,
} from "./avatar";

describe("isValidAvatarFile", () => {
  it("accepts the mime types the server contract allows", () => {
    expect(isValidAvatarFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(isValidAvatarFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(isValidAvatarFile({ type: "image/jpg", size: 1000 })).toBeNull();
    expect(isValidAvatarFile({ type: "image/webp", size: 1000 })).toBeNull();
    expect(isValidAvatarFile({ type: "IMAGE/PNG", size: 1000 })).toBeNull();
  });

  it("rejects svg — script-bearing markup must never reach an img field", () => {
    expect(isValidAvatarFile({ type: "image/svg+xml", size: 1000 })).toBe("unsupported-type");
  });

  it("rejects non-image files", () => {
    expect(isValidAvatarFile({ type: "application/pdf", size: 1000 })).toBe("unsupported-type");
    expect(isValidAvatarFile({ type: "video/mp4", size: 1000 })).toBe("unsupported-type");
    expect(isValidAvatarFile({ type: "", size: 1000 })).toBe("unsupported-type");
  });

  it("rejects oversized raw picks before any decode work", () => {
    expect(isValidAvatarFile({ type: "image/png", size: AVATAR_MAX_INPUT_BYTES + 1 })).toBe("too-large");
    expect(isValidAvatarFile({ type: "image/png", size: AVATAR_MAX_INPUT_BYTES })).toBeNull();
  });
});

describe("isAcceptableAvatarDataUrl", () => {
  it("accepts the exact server-accepted shapes", () => {
    expect(isAcceptableAvatarDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isAcceptableAvatarDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isAcceptableAvatarDataUrl("data:image/webp;base64,UklGRg==")).toBe(true);
  });

  it("rejects svg and non-data URLs", () => {
    expect(isAcceptableAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe(false);
    expect(isAcceptableAvatarDataUrl("https://example.com/avatar.png")).toBe(false);
    expect(isAcceptableAvatarDataUrl("data:text/html;base64,PGI+")).toBe(false);
    expect(isAcceptableAvatarDataUrl("")).toBe(false);
  });

  it("rejects payloads above the server size cap", () => {
    const big = `data:image/png;base64,${"A".repeat(AVATAR_DATA_URL_MAX_CHARS)}`;
    expect(isAcceptableAvatarDataUrl(big)).toBe(false);
  });
});

describe("avatarErrorMessage", () => {
  it("returns a bilingual message for every error code", () => {
    const codes: AvatarErrorCode[] = ["unsupported-type", "too-large", "decode-failed", "unknown"];
    for (const code of codes) {
      expect(avatarErrorMessage(code, "ar")).toBeTruthy();
      expect(avatarErrorMessage(code, "en")).toBeTruthy();
    }
  });
});
