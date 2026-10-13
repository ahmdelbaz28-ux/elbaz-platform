/**
 * Pure helpers for the manual (offline) payment flow — shared by
 * payment-router.ts (createManual) and admin-payments.ts (approve/reject).
 *
 * Kept intentionally free of DB imports so the guards and mappings are
 * unit-testable without mocking the database.
 */

export interface ManualPaymentDetails {
  enabled: boolean;
  vodafoneCashNumber: string;
  instapayHandle: string;
  bankTransferDetails: string;
  notesAr: string;
  notesEn: string;
  // Paymob online-gateway settings (admin-editable, no redeploy needed).
  // Not secrets: the Public Key is designed to be client-safe and integration
  // IDs are account-scoped references. The Secret Key stays env-only.
  paymobPublicKey: string;
  paymobIntegrationCard: string;
  paymobIntegrationWallet: string;
  paymobWalletIframe: string;
}

export type ManualPaymentMethod = "vodafone_cash" | "instapay" | "bank_transfer";

export const MANUAL_PAYMENT_METHODS: readonly ManualPaymentMethod[] = [
  "vodafone_cash",
  "instapay",
  "bank_transfer",
] as const;

/** siteSettings section that stores the manual payment details (admin-editable). */
export const PAYMENT_SETTINGS_SECTION = "payments";

/**
 * Map raw siteSettings rows (section "payments") to structured manual details.
 * enabled=true only when at least one transfer channel has a value, so the
 * frontend never shows a "send money nowhere" screen.
 */
export function mapManualDetailsFromSettings(
  rows: Array<{ key: string; value: string }>,
): ManualPaymentDetails {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const details: ManualPaymentDetails = {
    enabled: false,
    vodafoneCashNumber: map.get("vodafone_cash_number")?.trim() ?? "",
    instapayHandle: map.get("instapay_handle")?.trim() ?? "",
    bankTransferDetails: map.get("bank_transfer_details")?.trim() ?? "",
    notesAr: map.get("notes_ar")?.trim() ?? "",
    notesEn: map.get("notes_en")?.trim() ?? "",
    paymobPublicKey: map.get("paymob_public_key")?.trim() ?? "",
    paymobIntegrationCard: map.get("paymob_integration_card")?.trim() ?? "",
    paymobIntegrationWallet: map.get("paymob_integration_wallet")?.trim() ?? "",
    paymobWalletIframe: map.get("paymob_wallet_iframe")?.trim() ?? "",
  };
  details.enabled =
    details.vodafoneCashNumber !== "" ||
    details.instapayHandle !== "" ||
    details.bankTransferDetails !== "";
  return details;
}

/**
 * Resolve the transfer target for a manual method.
 * Returns null when manual payment is disabled or the specific channel has
 * no configured value (server-side guard against paying into the void).
 */
export function resolveManualChannel(
  details: ManualPaymentDetails,
  method: ManualPaymentMethod,
): string | null {
  if (!details.enabled) return null;
  const value =
    method === "vodafone_cash"
      ? details.vodafoneCashNumber
      : method === "instapay"
        ? details.instapayHandle
        : details.bankTransferDetails;
  return value !== "" ? value : null;
}

export type ManualPaymentAction = "approve" | "reject";
export type ManualPaymentGuardResult =
  | { ok: true; alreadyProcessed: boolean }
  | { ok: false; error: "NOT_MANUAL" | "INVALID_STATUS"; status: string };

/**
 * State-machine guard for admin approve/reject of manual payments:
 * - Only provider "manual" can be approved/rejected (gateway payments are
 *   settled exclusively by the Paymob webhook — keeps the audit trail honest).
 * - approve on completed → idempotent no-op (alreadyProcessed).
 * - Anything not "pending" cannot transition.
 */
export function guardManualPaymentAction(
  payment: { provider: string; status: string },
  action: ManualPaymentAction,
): ManualPaymentGuardResult {
  if (payment.provider !== "manual") {
    return { ok: false, error: "NOT_MANUAL", status: payment.status };
  }
  if (action === "approve" && payment.status === "completed") {
    return { ok: true, alreadyProcessed: true };
  }
  if (payment.status !== "pending") {
    return { ok: false, error: "INVALID_STATUS", status: payment.status };
  }
  return { ok: true, alreadyProcessed: false };
}
