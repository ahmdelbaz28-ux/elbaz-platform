const CacheKeyNamespaces = {
  USER: 'user',
  SESSION: 'session',
  COURSE: 'course',
  LESSON: 'lesson',
  VIDEO: 'video',
  PROGRESS: 'progress',
  QUIZ: 'quiz',
  PAYMENT: 'payment',
  CONFIG: 'config',
  API: 'api',
  PAGE: 'page',
  ANALYTICS: 'analytics',
  NOTIFICATION: 'notification',
  CERTIFICATE: 'certificate',
} as const;

type CacheNamespace = (typeof CacheKeyNamespaces)[keyof typeof CacheKeyNamespaces];

function buildKey(namespace: CacheNamespace, ...segments: (string | number | undefined | null)[]): string {
  const parts = [namespace, ...segments.filter((s): s is string | number => s !== undefined && s !== null)];
  return parts.join(':');
}

function userById(userId: string): string { return buildKey(CacheKeyNamespaces.USER, 'byId', userId); }
function userByEmail(email: string): string { return buildKey(CacheKeyNamespaces.USER, 'byEmail', email); }
function userProfile(userId: string): string { return buildKey(CacheKeyNamespaces.USER, 'profile', userId); }
function userPermissions(userId: string): string { return buildKey(CacheKeyNamespaces.USER, 'permissions', userId); }
function userEnrollments(userId: string): string { return buildKey(CacheKeyNamespaces.USER, 'enrollments', userId); }
function sessionById(sessionId: string): string { return buildKey(CacheKeyNamespaces.SESSION, sessionId); }
function sessionByToken(token: string): string { return buildKey(CacheKeyNamespaces.SESSION, 'token', token); }
function courseById(courseId: string): string { return buildKey(CacheKeyNamespaces.COURSE, 'byId', courseId); }

function courseList(params: { page?: number; limit?: number; category?: string; search?: string }): string {
  const query = JSON.stringify({ p: params.page ?? 1, l: params.limit ?? 10, c: params.category, s: params.search });
  return buildKey(CacheKeyNamespaces.COURSE, 'list', Buffer.from(query).toString('base64url'));
}

function courseContent(courseId: string): string { return buildKey(CacheKeyNamespaces.COURSE, 'content', courseId); }
function courseEnrolledUsers(courseId: string): string { return buildKey(CacheKeyNamespaces.COURSE, 'enrolled', courseId); }
function lessonById(lessonId: string): string { return buildKey(CacheKeyNamespaces.LESSON, 'byId', lessonId); }
function lessonByCourse(courseId: string, lessonOrder: number): string { return buildKey(CacheKeyNamespaces.LESSON, 'course', courseId, 'order', lessonOrder); }
function videoById(videoId: string): string { return buildKey(CacheKeyNamespaces.VIDEO, 'byId', videoId); }
function videoStreamUrl(videoId: string, quality: string): string { return buildKey(CacheKeyNamespaces.VIDEO, 'stream', videoId, quality); }
function videoThumbnail(videoId: string): string { return buildKey(CacheKeyNamespaces.VIDEO, 'thumbnail', videoId); }
function userProgress(userId: string, courseId: string): string { return buildKey(CacheKeyNamespaces.PROGRESS, userId, courseId); }
function userProgressOverview(userId: string): string { return buildKey(CacheKeyNamespaces.PROGRESS, 'overview', userId); }
function quizById(quizId: string): string { return buildKey(CacheKeyNamespaces.QUIZ, 'byId', quizId); }
function quizByLesson(lessonId: string): string { return buildKey(CacheKeyNamespaces.QUIZ, 'lesson', lessonId); }
function quizResults(userId: string, quizId: string): string { return buildKey(CacheKeyNamespaces.QUIZ, 'results', userId, quizId); }
function paymentById(paymentId: string): string { return buildKey(CacheKeyNamespaces.PAYMENT, 'byId', paymentId); }
function paymentByUser(userId: string): string { return buildKey(CacheKeyNamespaces.PAYMENT, 'user', userId); }
function configByKey(configKey: string): string { return buildKey(CacheKeyNamespaces.CONFIG, configKey); }
function apiResponse(method: string, path: string, queryHash?: string): string { return buildKey(CacheKeyNamespaces.API, method.toUpperCase(), path, queryHash); }
function pageHtml(path: string): string { return buildKey(CacheKeyNamespaces.PAGE, 'html', path); }
function pageData(path: string): string { return buildKey(CacheKeyNamespaces.PAGE, 'data', path); }
function analyticsDashboard(userId: string, period: string): string { return buildKey(CacheKeyNamespaces.ANALYTICS, 'dashboard', userId, period); }
function analyticsCourseStats(courseId: string, period: string): string { return buildKey(CacheKeyNamespaces.ANALYTICS, 'course', courseId, period); }
function notificationList(userId: string, page?: number): string { return buildKey(CacheKeyNamespaces.NOTIFICATION, userId, 'page', page ?? 1); }
function certificateById(certificateId: string): string { return buildKey(CacheKeyNamespaces.CERTIFICATE, 'byId', certificateId); }
function certificateByUser(userId: string): string { return buildKey(CacheKeyNamespaces.CERTIFICATE, 'user', userId); }

const CacheTags = {
  USER_ALL: 'tag:user:all',
  USER_PROFILE: (userId: string) => `tag:user:profile:${userId}`,
  COURSE_ALL: 'tag:course:all',
  COURSE_DETAIL: (courseId: string) => `tag:course:detail:${courseId}`,
  COURSE_CONTENT: (courseId: string) => `tag:course:content:${courseId}`,
  LESSON_ALL: 'tag:lesson:all',
  LESSON_COURSE: (courseId: string) => `tag:lesson:course:${courseId}`,
  VIDEO_ALL: 'tag:video:all',
  PROGRESS_USER: (userId: string) => `tag:progress:user:${userId}`,
  PROGRESS_COURSE: (courseId: string) => `tag:progress:course:${courseId}`,
  QUIZ_ALL: 'tag:quiz:all',
  ANALYTICS_ALL: 'tag:analytics:all',
  NOTIFICATION_USER: (userId: string) => `tag:notification:user:${userId}`,
  CONFIG_ALL: 'tag:config:all',
  PAYMENT_USER: (userId: string) => `tag:payment:user:${userId}`,
  API_RESPONSES: 'tag:api:responses',
} as const;

const TTLConfig = {
  SHORT: 60000,
  MEDIUM: 300000,
  LONG: 1800000,
  VERY_LONG: 3600000,
  HALF_DAY: 43200000,
  DAY: 86400000,
  WEEK: 604800000,
  USER_PROFILE: 600000,
  USER_SESSION: 1800000,
  COURSE_LIST: 300000,
  COURSE_DETAIL: 600000,
  COURSE_CONTENT: 1800000,
  LESSON_DATA: 1800000,
  VIDEO_META: 3600000,
  VIDEO_STREAM: 300000,
  PROGRESS: 120000,
  QUIZ_DATA: 3600000,
  ANALYTICS: 600000,
  CONFIG: 86400000,
  NOTIFICATIONS: 120000,
  CERTIFICATE: 604800000,
  API_PUBLIC: 300000,
  API_AUTHENTICATED: 60000,
  PAGE_HTML: 3600000,
  PAGE_DATA: 600000,
} as const;

export {
  buildKey,
  CacheKeyNamespaces,
  CacheTags,
  TTLConfig,
  userById, userByEmail, userProfile, userPermissions, userEnrollments,
  sessionById, sessionByToken,
  courseById, courseList, courseContent, courseEnrolledUsers,
  lessonById, lessonByCourse,
  videoById, videoStreamUrl, videoThumbnail,
  userProgress, userProgressOverview,
  quizById, quizByLesson, quizResults,
  paymentById, paymentByUser,
  configByKey,
  apiResponse,
  pageHtml, pageData,
  analyticsDashboard, analyticsCourseStats,
  notificationList,
  certificateById, certificateByUser,
};
