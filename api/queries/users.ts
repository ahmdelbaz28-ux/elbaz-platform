import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { getDb } from "./connection";

export async function findUserByUsername(username: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  return rows.at(0);
}

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.googleId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  // SECURITY: Never overwrite sensitive fields on update — only set on initial insert
  // passwordHash: prevents overwriting existing password
  // role: prevents privilege escalation via OAuth
  // tokenVersion: prevents invalidating existing sessions
  const { passwordHash, role, tokenVersion, ...safeData } = data;
  const updateSet: Partial<InsertUser> = {
    lastSignInAt: new Date(),
    ...safeData,
  };

  await getDb()
    .insert(schema.users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}
