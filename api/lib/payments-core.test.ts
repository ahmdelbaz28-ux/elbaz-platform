/**
 * Tests for the manual (offline) payment flow core logic:
 * - mapManualDetailsFromSettings (siteSettings → structured details)
 * - resolveManualChannel (server-side guard against paying into the void)
 * - guardManualPaymentAction (admin approve/reject state machine)
 */

import { describe, it, expect } from "vitest";
import {
  mapManualDetailsFromSettings,
  resolveManualChannel,
  guardManualPaymentAction,
  type ManualPaymentDetails,
} from "./payments-core";

const fullDetails: ManualPaymentDetails = {
  enabled: true,
  vodafoneCashNumber: "01001234567",
  instapayHandle: "01098765432",
  bankTransferDetails: "Banque Misr — 1234567890",
  notesAr: "تحويل باسم شخصي فقط",
  notesEn: "Personal transfers only",
  paymobPublicKey: "",
  paymobIntegrationCard: "",
  paymobIntegrationWallet: "",
};

describe("mapManualDetailsFromSettings", () => {
  it("maps settings rows to structured details", () => {
    const details = mapManualDetailsFromSettings([
      { key: "vodafone_cash_number", value: " 01001234567 " },
      { key: "instapay_handle", value: "01098765432" },
      { key: "notes_ar", value: "تحويل باسم شخصي فقط" },
    ]);

    expect(details.vodafoneCashNumber).toBe("01001234567"); // trimmed
    expect(details.instapayHandle).toBe("01098765432");
    expect(details.bankTransferDetails).toBe("");
    expect(details.notesAr).toBe("تحويل باسم شخصي فقط");
    expect(details.notesEn).toBe("");
  });

  it("is disabled when no channel has a value", () => {
    const details = mapManualDetailsFromSettings([
      { key: "notes_ar", value: "some note" },
      { key: "notes_en", value: "some note" },
    ]);
    expect(details.enabled).toBe(false);
  });

  it("is enabled when at least one channel has a value", () => {
    const details = mapManualDetailsFromSettings([
      { key: "vodafone_cash_number", value: "01001234567" },
    ]);
    expect(details.enabled).toBe(true);
  });

  it("ignores whitespace-only channel values", () => {
    const details = mapManualDetailsFromSettings([
      { key: "instapay_handle", value: "   " },
    ]);
    expect(details.instapayHandle).toBe("");
    expect(details.enabled).toBe(false);
  });

  it("returns all-empty details for an empty settings section", () => {
    const details = mapManualDetailsFromSettings([]);
    expect(details.enabled).toBe(false);
    expect(details.vodafoneCashNumber).toBe("");
  });
});

describe("resolveManualChannel", () => {
  it("resolves each configured channel", () => {
    expect(resolveManualChannel(fullDetails, "vodafone_cash")).toBe("01001234567");
    expect(resolveManualChannel(fullDetails, "instapay")).toBe("01098765432");
    expect(resolveManualChannel(fullDetails, "bank_transfer")).toBe("Banque Misr — 1234567890");
  });

  it("returns null for an unconfigured channel even when manual is enabled", () => {
    const partial = { ...fullDetails, bankTransferDetails: "" };
    expect(resolveManualChannel(partial, "bank_transfer")).toBeNull();
    expect(resolveManualChannel(partial, "vodafone_cash")).toBe("01001234567");
  });

  it("returns null when manual payment is disabled entirely", () => {
    const disabled = { ...fullDetails, enabled: false };
    expect(resolveManualChannel(disabled, "vodafone_cash")).toBeNull();
    expect(resolveManualChannel(disabled, "instapay")).toBeNull();
    expect(resolveManualChannel(disabled, "bank_transfer")).toBeNull();
  });
});

describe("guardManualPaymentAction", () => {
  it("allows approving a pending manual payment", () => {
    const guard = guardManualPaymentAction({ provider: "manual", status: "pending" }, "approve");
    expect(guard).toEqual({ ok: true, alreadyProcessed: false });
  });

  it("allows rejecting a pending manual payment", () => {
    const guard = guardManualPaymentAction({ provider: "manual", status: "pending" }, "reject");
    expect(guard).toEqual({ ok: true, alreadyProcessed: false });
  });

  it("treats approving an already-completed payment as an idempotent no-op", () => {
    const guard = guardManualPaymentAction({ provider: "manual", status: "completed" }, "approve");
    expect(guard).toEqual({ ok: true, alreadyProcessed: true });
  });

  it("blocks approving a failed payment", () => {
    const guard = guardManualPaymentAction({ provider: "manual", status: "failed" }, "approve");
    expect(guard).toEqual({ ok: false, error: "INVALID_STATUS", status: "failed" });
  });

  it("blocks rejecting a completed payment (must use refund flow)", () => {
    const guard = guardManualPaymentAction({ provider: "manual", status: "completed" }, "reject");
    expect(guard).toEqual({ ok: false, error: "INVALID_STATUS", status: "completed" });
  });

  it("blocks approving a refunded payment", () => {
    const guard = guardManualPaymentAction({ provider: "manual", status: "refunded" }, "approve");
    expect(guard).toEqual({ ok: false, error: "INVALID_STATUS", status: "refunded" });
  });

  it("never lets gateway payments be approved manually (audit trail)", () => {
    const paymob = guardManualPaymentAction({ provider: "paymob", status: "pending" }, "approve");
    expect(paymob).toEqual({ ok: false, error: "NOT_MANUAL", status: "pending" });

    const webhook = guardManualPaymentAction({ provider: "paymob", status: "completed" }, "approve");
    expect(webhook).toEqual({ ok: false, error: "NOT_MANUAL", status: "completed" });
  });

  it("never lets gateway payments be rejected manually", () => {
    const guard = guardManualPaymentAction({ provider: "paymob", status: "pending" }, "reject");
    expect(guard).toEqual({ ok: false, error: "NOT_MANUAL", status: "pending" });
  });
});
