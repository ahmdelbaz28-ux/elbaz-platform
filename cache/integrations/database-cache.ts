import mysql from 'mysql2/promise';
import ElbazCache from '../index';
import { dbCacheManager } from '../strategies/cache-aside';
import { userById, courseById, lessonById, quizById, CacheTags, TTLConfig } from '../keys/cache-keys';

class DatabaseQueryCache {
  private pool: mysql.Pool | null = null;

  async initialize(connectionUrl: string): Promise<void> {
    this.pool = mysql.createPool({ uri: connectionUrl, waitForConnections: true, connectionLimit: 10, queueLimit: 0, enableKeepAlive: true });
    await this.pool.query('SELECT 1');
    this.registerDefaultQueries();
  }

  getPool(): mysql.Pool | null { return this.pool; }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.pool) throw new Error('DatabaseQueryCache not initialized');
    const [rows] = await this.pool.execute(sql, params as any);
    return rows as T[];
  }

  async querySingle<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const r = await this.query<T>(sql, params);
    return r.length > 0 ? r[0] : null;
  }

  async getCachedUser(userId: string): Promise<unknown> {
    const s = dbCacheManager.getQuery('userById');
    return s ? s.get(userId) : this.querySingle('SELECT id, email, name, role, avatar FROM users WHERE id = ?', [userId]);
  }

  async getCachedCourse(courseId: string): Promise<unknown> {
    const s = dbCacheManager.getQuery('courseById');
    return s ? s.get(courseId) : this.querySingle('SELECT id, title, description, instructor_id, category FROM courses WHERE id = ?', [courseId]);
  }

  invalidateUser(userId: string): number { return ElbazCache.engine.invalidateTags([CacheTags.USER_PROFILE(userId)]); }
  invalidateCourse(courseId: string): number { return ElbazCache.engine.invalidateTags([CacheTags.COURSE_DETAIL(courseId), CacheTags.COURSE_CONTENT(courseId), CacheTags.LESSON_COURSE(courseId), CacheTags.COURSE_ALL]); }
  invalidateConfig(): number { return ElbazCache.engine.invalidateTags([CacheTags.CONFIG_ALL]); }
  invalidateAll(): void { ElbazCache.engine.invalidateAll(); }

  private registerDefaultQueries(): void {
    dbCacheManager.registerQuery('userById', {
      queryFn: (id: unknown) => this.querySingle('SELECT id, email, name, role, avatar FROM users WHERE id = ?', [id]),
      keyBuilder: (id: unknown) => userById(id as string) as string,
      ttl: TTLConfig.USER_PROFILE, tags: [CacheTags.USER_ALL], staleWhileRevalidate: true,
    });
    dbCacheManager.registerQuery('courseById', {
      queryFn: (id: unknown) => this.querySingle('SELECT id, title, description, instructor_id, category FROM courses WHERE id = ?', [id]),
      keyBuilder: (id: unknown) => courseById(id as string) as string,
      ttl: TTLConfig.COURSE_DETAIL, tags: [CacheTags.COURSE_ALL], staleWhileRevalidate: true,
    });
    dbCacheManager.registerQuery('lessonById', {
      queryFn: (id: unknown) => this.querySingle('SELECT id, course_id, titleEn, titleAr, descriptionEn, descriptionAr, videoUrl, durationMinutes, sortOrder, isFree, isPublished FROM lessons WHERE id = ?', [id]),
      keyBuilder: (id: unknown) => lessonById(id as string) as string,
      ttl: TTLConfig.LESSON_DATA, tags: [CacheTags.LESSON_ALL],
    });
    // ⚠️  Videos table not yet implemented — stub for future use
    // dbCacheManager.registerQuery('videoById', {
    //   queryFn: (id: unknown) => this.querySingle('SELECT id, title, url, thumbnail, duration, quality FROM videos WHERE id = ?', [id]),
    //   keyBuilder: (id: unknown) => videoById(id as string) as string,
    //   ttl: TTLConfig.VIDEO_META, tags: [CacheTags.VIDEO_ALL],
    // });
    dbCacheManager.registerQuery('quizById', {
      queryFn: (id: unknown) => this.querySingle('SELECT id, lesson_id, title, questions, passing_score FROM quizQuestions WHERE id = ?', [id]),
      keyBuilder: (id: unknown) => quizById(id as string) as string,
      ttl: TTLConfig.QUIZ_DATA, tags: [CacheTags.QUIZ_ALL],
    });
  }

  async destroy(): Promise<void> { if (this.pool) { await this.pool.end(); this.pool = null; } }
}

const dbQueryCache = new DatabaseQueryCache();
export { DatabaseQueryCache, dbQueryCache };
