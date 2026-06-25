import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { getDb } from './api/queries/connection.js';
import { users } from './db/schema.js';
import { localAuthRouter } from './api/local-auth-router.js';

async function runTests() {
  console.log("🚀 Starting Internal Auth Flows Test...");
  const db = getDb();
  
  const testUsername = "test_auth_user_" + Date.now();
  const testEmail = testUsername + "@example.com";
  const initialPassword = "Password123";
  const newPassword = "NewPassword123";

  // Mock TRPC context
  const createMockCtx = () => ({
    req: { headers: { get: () => '127.0.0.1' } },
    resHeaders: { append: () => {} },
  } as any);

  // 1. Register a test user
  console.log(`\n[1] Registering test user: ${testUsername}...`);
  try {
    const caller = localAuthRouter.createCaller(createMockCtx());
    const regRes = await caller.register({
      username: testUsername,
      password: initialPassword,
      email: testEmail,
      name: "Test Auth User"
    });
    console.log("✅ Registration successful. User ID:", regRes.user.id);
  } catch (err: any) {
    console.error("❌ Registration failed:", err.message);
    process.exit(1);
  }

  // 2. Test Login with Email
  console.log(`\n[2] Testing Email Login...`);
  let testUserId;
  try {
    const caller = localAuthRouter.createCaller(createMockCtx());
    const loginRes = await caller.login({
      username: testUsername,
      password: initialPassword
    });
    testUserId = loginRes.user.id;
    console.log("✅ Login successful.");
  } catch (err: any) {
    console.error("❌ Login failed:", err.message);
    process.exit(1);
  }

  // 3. Test Forgot Password
  console.log(`\n[3] Testing Forgot Password...`);
  try {
    const caller = localAuthRouter.createCaller(createMockCtx());
    const forgotRes = await caller.forgotPassword({
      email: testEmail
    });
    console.log("✅ Forgot Password initiated. Message:", forgotRes.message);
  } catch (err: any) {
    console.error("❌ Forgot Password failed:", err.message);
    process.exit(1);
  }

  // 4. Test Reset Password
  console.log(`\n[4] Testing Reset Password...`);
  try {
    const caller = localAuthRouter.createCaller(createMockCtx());
    const mockToken = "mock_reset_token_1234567890abcdef";
    const tokenHash = crypto.createHash("sha256").update(mockToken).digest("hex");
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    // Manually inject the hash into the DB to simulate clicking the email link
    await db.update(users).set({
      passwordResetToken: tokenHash,
      passwordResetExpiresAt: expiry
    }).where(eq(users.id, testUserId));

    const resetRes = await caller.resetPassword({
      userId: testUserId,
      token: mockToken,
      newPassword: newPassword
    });
    console.log("✅ Reset Password successful. Message:", resetRes.message);
  } catch (err: any) {
    console.error("❌ Reset Password failed:", err.message);
    process.exit(1);
  }

  // 5. Verify New Password Works
  console.log(`\n[5] Verifying Login with New Password...`);
  try {
    const caller = localAuthRouter.createCaller(createMockCtx());
    const loginRes2 = await caller.login({
      username: testUsername,
      password: newPassword
    });
    console.log("✅ Login with new password successful.");
  } catch (err: any) {
    console.error("❌ Login with new password failed:", err.message);
    process.exit(1);
  }

  console.log("\n🎉 All Auth Flow Tests Passed!");
  process.exit(0);
}

runTests();
