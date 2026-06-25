import { CacheEngine, defaultCacheEngine, shortTTLCache, longTTLCache } from './core/cache-engine';
import { CacheAsideStrategy, DatabaseCacheManager, dbCacheManager } from './strategies/cache-aside';
import { WriteThroughStrategy, WriteBackStrategy, ReadThroughStrategy } from './strategies/write-strategies';
import { SessionCache, sessionCache } from './strategies/session-cache';
// Removed deleted next.js middleware imports
import { CacheMonitor, cacheMonitor } from './monitoring/cache-monitor';
import {
  userById, userByEmail, userProfile, userPermissions, userEnrollments,
  sessionById, sessionByToken, courseById, courseList, courseContent, courseEnrolledUsers,
  lessonById, lessonByCourse, videoById, videoStreamUrl, videoThumbnail,
  userProgress, userProgressOverview, quizById, quizByLesson, quizResults,
  paymentById, paymentByUser, configByKey, apiResponse, pageHtml, pageData,
  analyticsDashboard, analyticsCourseStats, notificationList, certificateById, certificateByUser,
  CacheTags, TTLConfig, buildKey,
} from './keys/cache-keys';

const ElbazCache = {
  engine: defaultCacheEngine,
  short: shortTTLCache,
  long: longTTLCache,
  strategies: { cacheAside: CacheAsideStrategy, writeThrough: WriteThroughStrategy, writeBack: WriteBackStrategy, readThrough: ReadThroughStrategy },
  db: dbCacheManager,
  session: sessionCache,
  monitor: cacheMonitor,
  middleware: {
  },
  keys: {
    user: { byId: userById, byEmail: userByEmail, profile: userProfile, permissions: userPermissions, enrollments: userEnrollments },
    session: { byId: sessionById, byToken: sessionByToken },
    course: { byId: courseById, list: courseList, content: courseContent, enrolledUsers: courseEnrolledUsers },
    lesson: { byId: lessonById, byCourse: lessonByCourse },
    video: { byId: videoById, streamUrl: videoStreamUrl, thumbnail: videoThumbnail },
    progress: { userProgress, userProgressOverview },
    quiz: { byId: quizById, byLesson: quizByLesson, results: quizResults },
    payment: { byId: paymentById, byUser: paymentByUser },
    config: configByKey,
    api: apiResponse,
    page: { html: pageHtml, data: pageData },
    analytics: { dashboard: analyticsDashboard, courseStats: analyticsCourseStats },
    notification: notificationList,
    certificate: { byId: certificateById, byUser: certificateByUser },
    build: buildKey,
  },
  tags: CacheTags,
  ttl: TTLConfig,
};

export default ElbazCache;
export { CacheEngine, CacheAsideStrategy, DatabaseCacheManager, WriteThroughStrategy, WriteBackStrategy, ReadThroughStrategy, SessionCache, CacheMonitor, defaultCacheEngine, shortTTLCache, longTTLCache, dbCacheManager, sessionCache, cacheMonitor };
