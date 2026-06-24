import { request, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "https://ahmedelbaz.qzz.io";
const TEST_USER_EMAIL = `global_test_${Date.now()}@example.com`;
const TEST_USER_PASSWORD = "GlobalTestPass123!";
const TEST_USER_NAME = "Global Test Automation User";

async function globalSetup() {
  console.log("Starting global setup...");

  const apiContext = await request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  try {
    const registerResponse = await apiContext.post("/api/auth/register", {
      data: {
        name: TEST_USER_NAME,
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
        confirmPassword: TEST_USER_PASSWORD,
      },
    });

    let authToken = "";

    if ([200, 201].includes(registerResponse.status())) {
      const registerBody = await registerResponse.json();
      authToken = registerBody.token || registerBody.accessToken || registerBody.data?.token || "";
      console.log(`Test user registered successfully: ${TEST_USER_EMAIL}`);
    } else {
      console.log(`Register returned ${registerResponse.status()}, attempting login...`);

      const loginResponse = await apiContext.post("/api/auth/login", {
        data: {
          email: TEST_USER_EMAIL,
          password: TEST_USER_PASSWORD,
        },
      });

      if ([200, 201].includes(loginResponse.status())) {
        const loginBody = await loginResponse.json();
        authToken = loginBody.token || loginBody.accessToken || loginBody.data?.token || "";
        console.log(`Login successful for test user: ${TEST_USER_EMAIL}`);
      } else {
        console.log(`Login failed with status ${loginResponse.status()}`);

        const fallbackTimestamp = Date.now();
        const fallbackEmail = `fallback_test_${fallbackTimestamp}@example.com`;
        const fallbackResponse = await apiContext.post("/api/auth/register", {
          data: {
            name: `Fallback Test User ${fallbackTimestamp}`,
            email: fallbackEmail,
            password: TEST_USER_PASSWORD,
            confirmPassword: TEST_USER_PASSWORD,
          },
        });

        if ([200, 201].includes(fallbackResponse.status())) {
          const fallbackBody = await fallbackResponse.json();
          authToken = fallbackBody.token || fallbackBody.accessToken || fallbackBody.data?.token || "";
          console.log(`Fallback user registered: ${fallbackEmail}`);
          process.env.TEST_USER_EMAIL = fallbackEmail;
        }
      }
    }

    if (authToken) {
      process.env.TEST_AUTH_TOKEN = authToken;
      console.log("Auth token stored in process.env.TEST_AUTH_TOKEN");
    } else {
      console.warn("WARNING: Could not obtain auth token. Tests requiring authentication may fail.");
    }

    process.env.TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || TEST_USER_EMAIL;
    process.env.TEST_USER_PASSWORD = TEST_USER_PASSWORD;
    process.env.TEST_BASE_URL = BASE_URL;

  } catch (error) {
    console.error("Global setup error:", error);
    console.warn("Continuing without auth token...");
  }

  try {
    const cleanupResponse = await apiContext.get("/api/courses");
    if (cleanupResponse.status() === 200) {
      const body = await cleanupResponse.json();
      console.log(`API health check passed. Server is reachable.`);
    }
  } catch (healthError) {
    console.warn("WARNING: Could not reach API server for health check.");
  }

  await apiContext.dispose();
  console.log("Global setup completed.");
}

export default globalSetup;
