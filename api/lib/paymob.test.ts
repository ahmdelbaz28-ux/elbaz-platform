/**
 * Tests for the Paymob Intention API lib:
 * - buildTransactionHmacString (20-field official concatenation order)
 * - verifyTransactionCallback (HMAC-SHA512, query-param or body transport)
 * - verifyPaymobAmount (integer-cents comparison, EGP pinned)
 * - summarizePaymobConfig / isPaymobConfigComplete (missing-piece listing)
 * - integrationIdsForMethod (method → integration ID routing)
 * - toAmountCents (no float drift)
 * - buildCheckoutUrl (official unifiedcheckout shape)
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildTransactionHmacString,
  verifyTransactionCallback,
  verifyPaymobAmount,
  summarizePaymobConfig,
  isPaymobConfigComplete,
  integrationIdsForMethod,
  toAmountCents,
  buildCheckoutUrl,
  type PaymobCallbackTransaction,
  type PaymobRuntimeConfig,
} from "./paymob";

const TEST_HMAC_SECRET = "E64A88DFE6FF32CCB63DDFAE66BEEDAD";

/** Worked example from the official Paymob docs (hmac-verification reference). */
const sampleTxn: PaymobCallbackTransaction = {
  id: 2556706,
  amount_cents: 100,
  created_at: "2020-03-25T18:39:44.719228",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  integration_id: 6741,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 4778239, merchant_order_id: "TXN-test" },
  owner: 4705,
  pending: false,
  source_data: { type: "card", sub_type: "MasterCard", pan: "2346" },
  success: true,
};

const fullConfig: PaymobRuntimeConfig = {
  secretKey: "egy_sk_test_abc",
  publicKey: "egy_pk_test_abc",
  hmacSecret: TEST_HMAC_SECRET,
  cardIntegrationId: 4569876,
  walletIntegrationId: 4569877,
  baseUrl: "https://accept.paymob.com",
  frontendUrl: "https://ahmedelbaz.qzz.io",
};

describe("buildTransactionHmacString", () => {
  it("concatenates the 20 documented fields in the exact official order", () => {
    // From the official worked example:
    // 100 2020-03-25T18:39:44.719228 EGP false false 2556706 6741 true false
    // false false true false 4778239 4705 false 2346 MasterCard card true
    const expected =
      "1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalsefalsefalsetruefalse47782394705false2346MasterCardcardtrue";
    expect(buildTransactionHmacString(sampleTxn)).toBe(expected);
  });

  it("renders null/undefined optional fields as empty strings (explicit policy)", () => {
    const txn = { ...sampleTxn, owner: undefined, source_data: undefined };
    const s = buildTransactionHmacString(txn);
    // owner → "" and source_data.* → ""×3 (4 empty segments in a row)
    expect(s).toContain("4778239false");
    expect(s.endsWith("true")).toBe(true);
    expect(s).not.toContain("null");
    expect(s).not.toContain("undefined");
  });

  it("keeps raw values untouched (no date reformatting, no rounding)", () => {
    const txn = { ...sampleTxn, amount_cents: 1999, created_at: "2026-10-13T05:00:00.000123" };
    const s = buildTransactionHmacString(txn);
    expect(s).toContain("19992026-10-13T05:00:00.000123");
  });
});

describe("verifyTransactionCallback", () => {
  const sign = (obj: PaymobCallbackTransaction, secret = TEST_HMAC_SECRET) =>
    createHmac("sha512", secret).update(buildTransactionHmacString(obj)).digest("hex");

  it("accepts a genuine callback with the HMAC on the query param", () => {
    expect(verifyTransactionCallback({ obj: sampleTxn }, sign(sampleTxn), TEST_HMAC_SECRET)).toBe(true);
  });

  it("accepts the legacy body-embedded hmac when the query param is absent", () => {
    expect(verifyTransactionCallback({ obj: sampleTxn, hmac: sign(sampleTxn) }, undefined, TEST_HMAC_SECRET)).toBe(true);
  });

  it("prefers the query param over a tampered body hmac", () => {
    expect(
      verifyTransactionCallback({ obj: sampleTxn, hmac: "deadbeef" }, sign(sampleTxn), TEST_HMAC_SECRET),
    ).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const tampered = { ...sampleTxn, amount_cents: 1 };
    expect(verifyTransactionCallback({ obj: tampered }, sign(sampleTxn), TEST_HMAC_SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyTransactionCallback({ obj: sampleTxn }, sign(sampleTxn, "other-secret"), TEST_HMAC_SECRET)).toBe(false);
  });

  it("rejects missing/empty/wrong-length hmac without throwing", () => {
    expect(verifyTransactionCallback({ obj: sampleTxn }, undefined, TEST_HMAC_SECRET)).toBe(false);
    expect(verifyTransactionCallback({ obj: sampleTxn }, "", TEST_HMAC_SECRET)).toBe(false);
    expect(verifyTransactionCallback({ obj: sampleTxn }, "abc", TEST_HMAC_SECRET)).toBe(false);
  });

  it("rejects when the obj is missing", () => {
    expect(verifyTransactionCallback({}, sign(sampleTxn), TEST_HMAC_SECRET)).toBe(false);
  });
});

describe("verifyPaymobAmount", () => {
  it("matches integer cents against an EGP decimal amount", () => {
    expect(verifyPaymobAmount(25000, "250", "EGP")).toBe(true);
    expect(verifyPaymobAmount(1999, 19.99, "EGP")).toBe(true);
  });

  it("rejects partial payments and wrong currency", () => {
    expect(verifyPaymobAmount(100, "250", "EGP")).toBe(false);
    expect(verifyPaymobAmount(25000, "250", "USD")).toBe(false);
    expect(verifyPaymobAmount(Number.NaN, "250", "EGP")).toBe(false);
  });
});

describe("config completeness", () => {
  it("reports every missing piece with its exact source", () => {
    const missing = summarizePaymobConfig({
      secretKey: "",
      publicKey: "",
      hmacSecret: "",
      cardIntegrationId: null,
      walletIntegrationId: null,
    });
    expect(missing).toHaveLength(4);
    expect(missing[0]).toContain("PAYMOB_SECRET_KEY");
    expect(missing[1]).toContain("paymob_public_key");
    expect(missing[2]).toContain("PAYMOB_HMAC_SECRET");
    expect(missing[3]).toContain("Integration ID");
  });

  it("is complete when only one integration ID is set (any method works)", () => {
    expect(
      isPaymobConfigComplete({ ...fullConfig, walletIntegrationId: null }),
    ).toBe(true);
  });

  it("is incomplete without the public key even when everything else exists", () => {
    expect(isPaymobConfigComplete({ ...fullConfig, publicKey: "" })).toBe(false);
  });
});

describe("integrationIdsForMethod", () => {
  it("routes card-ish methods to the card integration", () => {
    expect(integrationIdsForMethod(fullConfig, "visa")).toEqual([4569876]);
    expect(integrationIdsForMethod(fullConfig, "instapay")).toEqual([4569876]);
  });

  it("routes wallet methods to the wallet integration", () => {
    expect(integrationIdsForMethod(fullConfig, "vodafone_cash")).toEqual([4569877]);
    expect(integrationIdsForMethod(fullConfig, "wallet")).toEqual([4569877]);
  });

  it("offers every configured integration for unmapped methods (customer chooses)", () => {
    expect(integrationIdsForMethod(fullConfig, "other")).toEqual([4569876, 4569877]);
  });

  it("returns [] when the needed integration is not configured", () => {
    expect(integrationIdsForMethod({ ...fullConfig, walletIntegrationId: null }, "vodafone_cash")).toEqual([]);
    expect(integrationIdsForMethod({ ...fullConfig, cardIntegrationId: null }, "visa")).toEqual([]);
  });
});

describe("toAmountCents", () => {
  it("converts without float drift", () => {
    expect(toAmountCents("19.99")).toBe(1999);
    expect(toAmountCents(19.99)).toBe(1999);
    expect(toAmountCents("250")).toBe(25000);
    expect(toAmountCents("0.1")).toBe(10);
  });

  it("yields NaN for non-numeric input", () => {
    expect(Number.isNaN(toAmountCents("abc"))).toBe(true);
  });
});

describe("buildCheckoutUrl", () => {
  it("builds the official unifiedcheckout URL with publicKey + clientSecret", () => {
    const url = buildCheckoutUrl(fullConfig, "csk_test_a1b2c3d4e5");
    expect(url).toBe(
      "https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test_abc&clientSecret=csk_test_a1b2c3d4e5",
    );
  });

  it("encodes special characters in keys/secrets", () => {
    const url = buildCheckoutUrl({ ...fullConfig, publicKey: "pk a&b" }, "cs&k");
    expect(url).toContain("publicKey=pk%20a%26b");
    expect(url).toContain("clientSecret=cs%26k");
  });
});
