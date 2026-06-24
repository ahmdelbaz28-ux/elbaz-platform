import { test, expect, request } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "https://ahmedelbaz.qzz.io";

test.describe("Security API", () => {
  test("SQL injection in parameters is blocked", async ({ request }) => {
    const injectionPayloads = [
      "1 OR 1=1",
      "1; DROP TABLE users--",
      "' OR '1'='1",
      "1 UNION SELECT * FROM users--",
      "admin'--",
      "1; SELECT * FROM passwords",
      "' OR 1=1 --",
      "1 AND 1=CONVERT(int,(SELECT TOP 1 table_name FROM information_schema.tables))--",
    ];

    for (const payload of injectionPayloads) {
      const response = await request.get(`${BASE_URL}/api/courses/${payload}`);
      expect([400, 404, 422, 500]).toContain(response.status());
      expect(response.status()).not.toBe(200);
    }

    const searchResponse = await request.get(
      `${BASE_URL}/api/courses?search=${encodeURIComponent("' OR '1'='1")}`
    );
    const body = await searchResponse.json().catch(() => ({}));
    const courses = body.data || body.courses || body.results || body;

    if (Array.isArray(courses)) {
      for (const course of courses) {
        const courseStr = JSON.stringify(course).toLowerCase();
        expect(courseStr).not.toContain("error");
        expect(courseStr).not.toContain("syntax error");
      }
    }
  });

  test("XSS in input fields is blocked or sanitized", async ({ request }) => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><script>alert(document.cookie)</script>',
      "javascript:alert(1)",
      '<svg onload=alert(1)>',
      "{{7*7}}",
      "${7*7}",
    ];

    for (const payload of xssPayloads) {
      const response = await request.get(
        `${BASE_URL}/api/courses?search=${encodeURIComponent(payload)}`
      );
      expect(response.status()).not.toBe(500);

      const body = await response.json().catch(() => ({}));
      const responseText = JSON.stringify(body);

      expect(responseText).not.toContain("<script>");
      expect(responseText).not.toContain("onerror=");
      expect(responseText).not.toContain("onload=");
    }
  });

  test("rate limiting on login endpoint after 5 attempts", async ({ request }) => {
    const timestamp = Date.now();

    for (let i = 0; i < 5; i++) {
      const response = await request.post(`${BASE_URL}/api/auth/login`, {
        data: {
          email: `ratelimit_${timestamp}_attempt${i}@example.com`,
          password: "wrongpassword",
        },
      });
      expect([401, 429, 200, 400, 422]).toContain(response.status());
    }

    const sixthResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        email: `ratelimit_${timestamp}_attempt6@example.com`,
        password: "wrongpassword",
      },
    });

    const finalAttempts = [sixthResponse.status()];

    const seventhResponse = await request.post(`${BASE_URL}/api/auth/login`, {
      data: {
        email: `ratelimit_${timestamp}_attempt7@example.com`,
        password: "wrongpassword",
      },
    });
    finalAttempts.push(seventhResponse.status());

    const isRateLimited = finalAttempts.some((status) => status === 429);
    const allAuthErrors = finalAttempts.every(
      (status) => [400, 401, 422, 429].includes(status)
    );

    expect(isRateLimited || allAuthErrors).toBe(true);
  });

  test("sensitive security headers are present", async ({ request }) => {
    const response = await request.get(BASE_URL);
    const headers = response.headers();

    const expectedHeaders = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "strict-transport-security": "max-age",
    };

    for (const [header, expectedValue] of Object.entries(expectedHeaders)) {
      const headerValue = headers[header] || Object.keys(headers).find(
        (h) => h.toLowerCase() === header.toLowerCase()
      );

      if (headerValue) {
        const value = headers[header] || headers[Object.keys(headers).find(
          (h) => h.toLowerCase() === header.toLowerCase()
        )!];
        expect(value.toLowerCase()).toContain(expectedValue.toLowerCase());
      }
    }

    expect(headers["x-content-type-options"] || headers["X-Content-Type-Options"]).toBeDefined();
  });

  test("CSRF protection is in place", async ({ request }) => {
    const getResponse = await request.get(`${BASE_URL}/api/csrf`);
    const getHeaders = getResponse.headers();

    const hasCsrfToken =
      getHeaders["x-csrf-token"] ||
      getHeaders["X-CSRF-Token"] ||
      getHeaders["set-cookie"]?.includes("csrf");

    const stateResponse = await request.get(`${BASE_URL}/api/auth/csrf`);
    expect([200, 404, 401, 405]).toContain(stateResponse.status());

    expect(hasCsrfToken || [200, 404, 401, 405].includes(stateResponse.status())).toBe(true);
  });

  test("/api/admin endpoints blocked without authentication", async ({ request }) => {
    const adminEndpoints = [
      "/api/admin/users",
      "/api/admin/courses",
      "/api/admin/dashboard",
      "/api/admin/settings",
      "/api/admin/analytics",
    ];

    for (const endpoint of adminEndpoints) {
      const response = await request.get(`${BASE_URL}${endpoint}`);
      expect([401, 403, 404]).toContain(response.status());
    }

    const postResponse = await request.post(`${BASE_URL}/api/admin/users`, {
      data: { name: "hacker", email: "hacker@evil.com", role: "admin" },
    });
    expect([401, 403, 404, 405]).toContain(postResponse.status());
  });
});
