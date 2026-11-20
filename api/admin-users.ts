/**
 * ADMIN USERS — User management endpoints
 *
 * Procedures: users (paginated list), updateUserRole
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, count } from "drizzle-orm";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import type { SafeUser } from "./context";
import { evictUserAuthCache } from "./context";

export const adminUsersProcedures = {
  // Users list — used by Admin.tsx frontend (trpc.admin.users.useQuery)
  users: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;

      const [[{ total }], allUsers] = await Promise.all([
        db.select({ total: count() }).from(users),
        db.select({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
          role: users.role,
          preferredLanguage: users.preferredLanguage,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastSignInAt: users.lastSignInAt,
        })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items: allUsers as SafeUser[], total: total ?? 0 };
    }),

  updateUserRole: adminMutation
    .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [user] = await db
        .select({ id: users.id, role: users.role, tokenVersion: users.tokenVersion })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (user.role === input.role) return { success: true }; // no-op

      // ✅ LAST-ADMIN GUARD (dashboard audit 2026-11-15): never allow removing
      // the final administrator — the platform would become unmanageable.
      if (user.role === "admin" && input.role === "user") {
        const [{ admins }] = await db
          .select({ admins: count() })
          .from(users)
          .where(eq(users.role, "admin"));
        if ((admins ?? 0) <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن إزالة صلاحية المشرف الأخير — يجب أن يبقى مشرف واحد على الأقل",
          });
        }
      }

      // ✅ INSTANT EFFECT (dashboard audit 2026-11-15): bump tokenVersion so a
      // role change kills ALL of the target's existing sessions immediately
      // (a demoted admin is locked out on their very next request instead of
      // riding a stale session for up to the token lifetime), and evict the
      // auth cache so even the 30s user-cache window cannot serve the old role.
      await db
        .update(users)
        .set({ role: input.role, tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
      evictUserAuthCache(user.id);
      return { success: true };
    }),
};
