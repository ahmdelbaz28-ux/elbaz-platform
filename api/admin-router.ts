import { Hono } from "hono";
import { getDb } from "./queries/connection";
import { users, payments } from "../db/schema";
import { desc } from "drizzle-orm";

const adminRouter = new Hono();

// Get all users
adminRouter.get("/users", async (c) => {
  const db = getDb();
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  return c.json(allUsers);
});

// Get all payments
adminRouter.get("/payments", async (c) => {
  const db = getDb();
  const allPayments = await db.select().from(payments).orderBy(desc(payments.createdAt));
  return c.json(allPayments);
});

export { adminRouter };