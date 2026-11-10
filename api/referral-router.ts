/**
 * REFERRAL ROUTER — student-to-student invitation program
 *
 * Procedures: myReferral
 * The register side (?ref=CODE capture + coupon granting) lives in
 * api/lib/referral.ts (applyReferral) and is wired from local-auth-router.
 */

import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getReferralOverview } from "./lib/referral";

export const referralRouter = createRouter({
  /** Full referral overview for the profile page: my code, my invite link,
   *  invited count, earned reward coupons, and my own welcome coupon. */
  myReferral: authedQuery
    .input(z.void().optional())
    .query(async ({ ctx }) => {
      const overview = await getReferralOverview(ctx.user.id, ctx.user.username);
      return overview;
    }),
});
