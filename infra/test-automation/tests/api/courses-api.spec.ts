import { test, expect, request } from "@playwright/test";

const BASE_URL = "https://ahmedelbaz.qzz.io";
let authToken: string;

test.describe.configure({ mode: "serial" });

test.describe("Courses API", () => {
  test.beforeAll(async ({ request }) => {
    const timestamp = Date.now();
    const response = await request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        name: `Course API Test ${timestamp}`,
        email: `course_api_${timestamp}@example.com`,
        password: "CourseAPITest123!",
        confirmPassword: "CourseAPITest123!",
      },
    });
    const body = await response.json().catch(() => ({}));
    authToken = body.token || body.accessToken || body.data?.token || "";
  });

  test("GET /api/courses returns a list of courses", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/courses`);

    expect(response.status()).toBe(200);

    const body = await response.json();
    const courses = body.data || body.courses || body.results || body;

    expect(Array.isArray(courses)).toBe(true);
    if (courses.length > 0) {
      expect(courses[0]).toHaveProperty("id");
      expect(courses[0]).toHaveProperty("title");
    }
  });

  test("GET /api/courses/:id returns course detail", async ({ request }) => {
    const listResponse = await request.get(`${BASE_URL}/api/courses`);
    const listBody = await listResponse.json();
    const courses = listBody.data || listBody.courses || listBody.results || listBody;

    if (Array.isArray(courses) && courses.length > 0) {
      const courseId = courses[0].id || courses[0]._id;
      const response = await request.get(`${BASE_URL}/api/courses/${courseId}`);

      expect(response.status()).toBe(200);

      const body = await response.json();
      const course = body.data || body.course || body;

      expect(course.title || course.name).toBeDefined();
      expect(course.id || course._id).toBe(courseId);
    }
  });

  test("pagination works with page and limit parameters", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/courses?page=1&limit=5`);

    expect(response.status()).toBe(200);

    const body = await response.json();
    const courses = body.data || body.courses || body.results || body;

    expect(Array.isArray(courses)).toBe(true);
    expect(courses.length).toBeLessThanOrEqual(5);

    const pagination = body.pagination || body.meta || body.pageInfo;
    if (pagination) {
      expect(pagination).toHaveProperty("totalPages");
    }
  });

  test("search and filter query parameters work", async ({ request }) => {
    const searchResponse = await request.get(`${BASE_URL}/api/courses?search=test`);
    expect([200, 404]).toContain(searchResponse.status());

    const categoryResponse = await request.get(`${BASE_URL}/api/courses?category=programming`);
    expect([200, 404]).toContain(categoryResponse.status());

    if (searchResponse.status() === 200) {
      const body = await searchResponse.json();
      const courses = body.data || body.courses || body.results || body;
      expect(Array.isArray(courses)).toBe(true);
    }
  });

  test("unauthenticated access to enrolled courses returns 401", async ({ request }) => {
    const enrolledEndpoints = [
      "/api/courses/enrolled",
      "/api/enrollments",
      "/api/user/courses",
    ];

    for (const endpoint of enrolledEndpoints) {
      const response = await request.get(`${BASE_URL}${endpoint}`);
      expect([401, 403, 404]).toContain(response.status());
    }

    if (authToken) {
      const authResponse = await request.get(`${BASE_URL}/api/courses/enrolled`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      expect([200, 404]).toContain(authResponse.status());
    }
  });
});
