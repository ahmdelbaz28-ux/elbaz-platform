import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = "https://ahmedelbaz.qzz.io";

const errorRate = new Rate("errors");
const browseLatency = new Trend("browse_courses_latency");
const loginLatency = new Trend("login_latency");
const courseDetailLatency = new Trend("course_detail_latency");
const searchLatency = new Trend("search_latency");

export const options = {
  stages: [
    { duration: "2m", target: 100 },
    { duration: "5m", target: 100 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
    errors: ["rate<0.05"],
    browse_courses_latency: ["p(95)<3000"],
    login_latency: ["p(95)<5000"],
    course_detail_latency: ["p(95)<3000"],
    search_latency: ["p(95)<3000"],
  },
};

const testUserEmail = `loadtest_${__VU}_${Date.now()}@example.com`;
const testUserPassword = "LoadTest123!";

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function registerUser() {
  const email = `loadtest_vu${__VU}_${Date.now()}@example.com`;
  const payload = JSON.stringify({
    name: `Load Test User ${__VU}`,
    email: email,
    password: testUserPassword,
    confirmPassword: testUserPassword,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    tags: { endpoint: "register" },
  };

  const res = http.post(`${BASE_URL}/api/auth/register`, payload, params);
  check(res, {
    "register status 200 or 201": (r) => r.status === 200 || r.status === 201,
  });

  if (res.status === 200 || res.status === 201) {
    try {
      const body = res.json();
      return body.token || body.accessToken || body.data?.token || "";
    } catch (e) {}
  }
  return "";
}

function loginUser(email, password) {
  const payload = JSON.stringify({
    email: email,
    password: password,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    tags: { endpoint: "login" },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);
  loginLatency.add(Date.now() - startTime);

  check(res, {
    "login status 200 or 201": (r) => r.status === 200 || r.status === 201,
    "login returns token": (r) => {
      try {
        const body = r.json();
        return !!(body.token || body.accessToken || body.data?.token);
      } catch (e) {
        return false;
      }
    },
  });

  errorRate.add(res.status >= 400 ? 1 : 0);

  if (res.status === 200 || res.status === 201) {
    try {
      const body = res.json();
      return body.token || body.accessToken || body.data?.token || "";
    } catch (e) {}
  }
  return "";
}

function browseCourses(token) {
  const params = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags: { endpoint: "browse_courses" },
  };

  const page = randomInt(1, 5);
  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/api/courses?page=${page}&limit=10`, params);
  browseLatency.add(Date.now() - startTime);

  check(res, {
    "browse courses status 200": (r) => r.status === 200,
    "browse courses returns array": (r) => {
      try {
        const body = r.json();
        const courses = body.data || body.courses || body.results || body;
        return Array.isArray(courses);
      } catch (e) {
        return false;
      }
    },
  });

  errorRate.add(res.status >= 400 ? 1 : 0);
}

function viewCourseDetail(token) {
  const params = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags: { endpoint: "course_detail" },
  };

  const courseId = randomInt(1, 50);
  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/api/courses/${courseId}`, params);
  courseDetailLatency.add(Date.now() - startTime);

  check(res, {
    "course detail status 200 or 404": (r) => r.status === 200 || r.status === 404,
    "course detail returns object": (r) => {
      if (r.status !== 200) return true;
      try {
        const body = r.json();
        return typeof body === "object";
      } catch (e) {
        return false;
      }
    },
  });

  errorRate.add(res.status >= 500 ? 1 : 0);
}

function searchCourses(token) {
  const searchTerms = [
    "javascript", "python", "react", "node", "html", "css",
    "angular", "vue", "typescript", "web development", "programming",
    "database", "api", "testing", "devops",
  ];
  const searchTerm = searchTerms[randomInt(0, searchTerms.length - 1)];

  const params = {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags: { endpoint: "search" },
  };

  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/api/courses?search=${searchTerm}`, params);
  searchLatency.add(Date.now() - startTime);

  check(res, {
    "search status 200": (r) => r.status === 200,
    "search returns results": (r) => {
      try {
        const body = r.json();
        const courses = body.data || body.courses || body.results || body;
        return Array.isArray(courses);
      } catch (e) {
        return false;
      }
    },
  });

  errorRate.add(res.status >= 400 ? 1 : 0);
}

export function setup() {
  const token = registerUser();
  if (!token) {
    const loginToken = loginUser(testUserEmail, testUserPassword);
    return { token: loginToken };
  }
  return { token };
}

export default function (data) {
  const rand = Math.random();
  const token = data.token;

  if (rand < 0.50) {
    group("Browse Courses (50%)", () => {
      browseCourses(token);
      sleep(randomInt(1, 3));
    });
  } else if (rand < 0.70) {
    group("Login (20%)", () => {
      const email = `login_test_${__VU}_${Date.now()}@example.com`;
      loginUser(email, testUserPassword);
      sleep(randomInt(1, 2));
    });
  } else if (rand < 0.90) {
    group("View Course Detail (20%)", () => {
      viewCourseDetail(token);
      sleep(randomInt(2, 4));
    });
  } else {
    group("Search Courses (10%)", () => {
      searchCourses(token);
      sleep(randomInt(1, 2));
    });
  }
}

export function handleSummary(data) {
  const summary = {
    "load-test-summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };

  const httpMetrics = data.metrics.http_req_duration;
  if (httpMetrics) {
    summary.stdout += `\n\n--- Custom Load Test Summary ---\n`;
    summary.stdout += `P50 Response Time: ${httpMetrics.values["p(50)"]}ms\n`;
    summary.stdout += `P95 Response Time: ${httpMetrics.values["p(95)"]}ms\n`;
    summary.stdout += `P99 Response Time: ${httpMetrics.values["p(99)"]}ms\n`;
    summary.stdout += `Avg Response Time: ${httpMetrics.values["avg"]}ms\n`;
    summary.stdout += `Total Requests: ${httpMetrics.values.count}\n`;
    summary.stdout += `Failed Requests: ${data.metrics.http_req_failed?.values.passes || 0}\n`;
  }

  return summary;
}

function textSummary(data, options) {
  let output = "";
  if (options.enableColors) {
    output += "\x1b[36m";
  }
  output += "\n=== Load Test Results ===\n";
  if (options.enableColors) {
    output += "\x1b[0m";
  }
  for (const indent of Array((options.indent?.length || 0) / 2 + 1)) {
    output += " ";
  }
  return output;
}
