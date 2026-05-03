import { z } from "zod";
import { desc } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, payments } from "@db/schema";

export const adminRouter = createRouter({
  getAllUsers: adminQuery.query(async () => {
    const db = getDb();
    return db.select().from(users).orderBy(desc(users.createdAt));
  }),

  getAllPayments: adminQuery.query(async () => {
    const db = getDb();
    return db.select().from(payments).orderBy(desc(payments.createdAt));
  }),
});
