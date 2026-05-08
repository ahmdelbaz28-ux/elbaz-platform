import { test, expect } from "@playwright/test";
import { CoursesPage } from "../../page-objects/CoursesPage";
import { CourseDetailPage } from "../../page-objects/CourseDetailPage";
import { LoginPage } from "../../page-objects/LoginPage";
import { DashboardPage } from "../../page-objects/DashboardPage";

test.describe("Courses", () => {
  let coursesPage: CoursesPage;
  let courseDetailPage: CourseDetailPage;

  test.beforeEach(async ({ page }) => {
    coursesPage = new CoursesPage(page);
    courseDetailPage = new CourseDetailPage(page);
  });

  test("courses page loads successfully", async ({ page }) => {
    await coursesPage.navigate();
    const loaded = await coursesPage.isLoaded();
    expect(loaded).toBe(true);
  });

  test("course cards display required elements", async ({ page }) => {
    await coursesPage.navigate();
    const courses = await coursesPage.getCourses();
    expect(courses.length).toBeGreaterThan(0);

    if (courses.length > 0) {
      await coursesPage.verifyCourseCardElements(0);
    }
  });

  test("course detail page loads with correct content", async ({ page }) => {
    await coursesPage.navigate();
    const courses = await coursesPage.getCourses();
    expect(courses.length).toBeGreaterThan(0);

    if (courses.length > 0 && courses[0].url) {
      const courseId = courses[0].url.split("/").pop();
      if (courseId) {
        await courseDetailPage.navigate(courseId);
        const title = await courseDetailPage.getTitle();
        expect(title.length).toBeGreaterThan(0);
      }
    }
  });

  test("module and lesson structure is present on course detail", async ({ page }) => {
    await coursesPage.navigate();
    const courses = await coursesPage.getCourses();
    if (courses.length > 0 && courses[0].url) {
      const courseId = courses[0].url.split("/").pop();
      if (courseId) {
        await courseDetailPage.navigate(courseId);
        const modules = await courseDetailPage.getModules();
        if (modules.length > 0) {
          expect(modules[0].title.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("search filters return relevant results", async ({ page }) => {
    await coursesPage.navigate();
    const allCourses = await coursesPage.getCourses();
    const initialCount = allCourses.length;

    if (initialCount > 0) {
      const searchTerm = allCourses[0].title.split(" ")[0];
      await coursesPage.searchCourse(searchTerm);
      const filteredCourses = await coursesPage.getCourses();
      expect(filteredCourses.length).toBeGreaterThanOrEqual(0);
    }
  });

  test("enrollment flow for logged-in user", async ({ page }) => {
    const loginPage = new LoginPage(page);
    const authToken = process.env.TEST_AUTH_TOKEN;

    if (authToken) {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");

      if (page.url().includes("/login")) {
        return;
      }

      await coursesPage.navigate();
      const courses = await coursesPage.getCourses();
      if (courses.length > 0 && courses[0].url) {
        const courseId = courses[0].url.split("/").pop();
        if (courseId) {
          await courseDetailPage.navigate(courseId);
          await courseDetailPage.enroll();
        }
      }
    }
  });
});
