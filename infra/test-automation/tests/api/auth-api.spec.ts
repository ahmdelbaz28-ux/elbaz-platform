import { test, expect, request } from "@playwright/test";

const BASE_URL = "https://ahmedelbaz.qzz.io";
let authToken: string;
let testUserId: string;

test.describe.configure({ mode: "serial" });

test.describe("Auth API", () => {
  test("POST /api/auth/register returns 201 with new user", async ({ request }) => {
    const timestamp = Date.now();
    const response = await request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        name: `API Test User ${timestamp}`,
        email: `api_test_${timestamp}@example.com`,
        password: "StrongPassword123!",
        confirmPassword: "StrongPassword123!",
      },
    });

    expect([201, 200]).toContain(response.status());

    const body = await response.json().catch(() => null);
    if (body) {
      authToken = body.token || body.accessToken || body.data?.token || "";
      testUserId = body.user?.id || body.data?.user?.id || body.id || "";
    }
  });

  test("POST /api/auth/login returns auth token", async ({ request }) => {
    const timestamp = Date.now();
    const registerResponse = await request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        name: `Login Test User ${timestamp}`,
        email: `login_test_${timestamp}@example.com`,
        password: "LoginPassword123!",
        confirmPassword: "LoginPassword123!",
      },
    });

    const loginResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        email: `login_test_${timestamp}@example.com`,
        password: "LoginPassword123!",
      },
    });

    expect([200, 201]).toContain(loginResponse.status());

    const body = await loginResponse.json();
    expect(body).toHaveProperty("token");
    authToken = body.token || body.accessToken || "";
    testUserId = body.user?.id || body.data?.user?.id || "";

    expect(authToken.length).toBeGreaterThan(0);
  });

  test("GET /api/auth/me with valid token returns user data", async ({ request }) => {
    const timestamp = Date.now();
    const registerResponse = await request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        name: `Me Test User ${timestamp}`,
        email: `me_test_${timestamp}@example.com`,
        password: "MePassword123!",
        confirmPassword: "MePassword123!",
      },
    });
    const regBody = await registerResponse.json().catch(() => ({}));
    const token = regBody.token || regBody.accessToken || regBody.data?.token || "";

    if (token) {
      const response = await request.get(`${BASE_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.status()).toBe(200);

      const body = await response.json();
      expect(body).toBeDefined();
    }
  });

  test("GET /api/auth/me with invalid token returns 401", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: {
        Authorization: "Bearer invalid_token_here_12345",
      },
    });

    expect([401, 403]).toContain(response.status());
  });

  test("password change endpoint works with valid token", async ({ request }) => {
    const timestamp = Date.now();
    const email = `pwchange_${timestamp}@example.com`;
    const oldPassword = "OldPassword123!";
    const newPassword = "NewPassword456!";

    const registerResponse = await request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        name: `PW Change User ${timestamp}`,
        email,
        password: oldPassword,
        confirmPassword: oldPassword,
      },
    });
    const regBody = await registerResponse.json().catch(() => ({}));
    const token = regBody.token || regBody.accessToken || regBody.data?.token || "";

    if (token) {
      const changeResponse = await request.post(`${BASE_URL}/api/auth/change-password`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        data: {
          currentPassword: oldPassword,
          newPassword: newPassword,
          confirmPassword: newPassword,
        },
      });

      expect([200, 201]).toContain(changeResponse.status());

      const verifyLogin = await request.post(`${BASE_URL}/api/auth/login`, {
        data: {
          email,
          password: newPassword,
        },
      });

      expect([200, 201]).toContain(verifyLogin.status());
    }
  });
});
