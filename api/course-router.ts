import { createRouter } from "./middleware";
import { courseBrowseProcedures } from "./course-browse";
import { courseEnrollmentProcedures } from "./course-enrollment";
import { courseWatchingProcedures } from "./course-watching";

/**
 * COURSE ROUTER — Composite router merging sub-domain procedure objects
 *
 * Sub-modules:
 *   course-browse      — Public read-only endpoints (categories, list, bySlug, testimonials, stats)
 *   course-enrollment  — Enrollment endpoints (enrollments, checkEnrollment, courseProgress)
 *   course-watching    — Video watching endpoints (lessonVideo, markWatched, heartbeat, getSavedPosition, myWatchTime)
 *
 * NOTE: Each sub-module exports a PLAIN object of procedures (not wrapped in
 * createRouter()). They must be spread into a single createRouter() call to
 * preserve tRPC's internal router metadata — spreading tRPC Router objects
 * ({ ...routerA, ...routerB }) would lose the _def structure.
 */

export const courseRouter = createRouter({
  ...courseBrowseProcedures,
  ...courseEnrollmentProcedures,
  ...courseWatchingProcedures,
});
