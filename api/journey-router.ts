/**
 * Journey Router — user learning journey timeline
 */
import { desc, eq, count } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  enrollments, courses, certificates, lessonProgress,
  payments,
} from "@db/schema";

export const journeyRouter = createRouter({
  timeline: authedQuery.query(async ({ ctx }) => {
    const db = getDb();

    // Enrolled courses with progress
    const enrolledCourses = await db
      .select({
        enrollmentId: enrollments.id,
        courseId: courses.id,
        slug: courses.slug,
        titleEn: courses.titleEn,
        titleAr: courses.titleAr,
        thumbnail: courses.thumbnail,
        progress: enrollments.progress,
        enrolledAt: enrollments.enrolledAt,
        completedAt: enrollments.completedAt,
        isPremium: courses.isPremium,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(eq(enrollments.userId, ctx.user.id))
      .orderBy(desc(enrollments.enrolledAt));

    // Certificates earned
    const certs = await db
      .select({
        id: certificates.id,
        certificateNumber: certificates.certificateNumber,
        courseId: certificates.courseId,
        courseSlug: courses.slug,
        courseTitleEn: courses.titleEn,
        courseTitleAr: courses.titleAr,
        grade: certificates.grade,
        issuedAt: certificates.issuedAt,
      })
      .from(certificates)
      .innerJoin(courses, eq(certificates.courseId, courses.id))
      .where(eq(certificates.userId, ctx.user.id))
      .orderBy(desc(certificates.issuedAt));

    // Lesson progress count (completed lessons)
    const progressRows = await db
      .select({ cnt: count() })
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, ctx.user.id));
    const totalLessonsCompleted = progressRows[0]?.cnt ?? 0;
    const userPayments = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        status: payments.status,
        transactionId: payments.transactionId,
        courseId: payments.courseId,
        courseTitleEn: courses.titleEn,
        courseTitleAr: courses.titleAr,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(courses, eq(payments.courseId, courses.id))
      .where(eq(payments.userId, ctx.user.id))
      .orderBy(desc(payments.createdAt));

    // Calculate stats
    const totalCourses = enrolledCourses.length;
    const completedCourses = enrolledCourses.filter((e) => e.completedAt).length;
    const totalCertificates = certs.length;
    const totalSpent = userPayments
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Build timeline events
    type TimelineEvent = {
      type: "enrollment" | "certificate" | "payment" | "lesson_complete";
      date: Date;
      title: string;
      titleAr: string;
      description: string;
      descriptionAr: string;
      link?: string;
      metadata?: Record<string, unknown>;
    };

    const timeline: TimelineEvent[] = [];

    for (const e of enrolledCourses) {
      timeline.push({
        type: "enrollment",
        date: e.enrolledAt,
        title: `Enrolled in ${e.titleEn}`,
        titleAr: `التسجيل في ${e.titleAr}`,
        description: e.completedAt ? "Completed" : `${e.progress || 0}% progress`,
        descriptionAr: e.completedAt ? "مكتمل" : `${e.progress || 0}% تقدم`,
        link: `/courses/${e.slug}`,
        metadata: { courseId: e.courseId, progress: e.progress },
      });
    }

    for (const c of certs) {
      timeline.push({
        type: "certificate",
        date: c.issuedAt,
        title: `Certificate earned: ${c.courseTitleEn}`,
        titleAr: `شهادة: ${c.courseTitleAr}`,
        description: `Grade: ${c.grade || "Pass"}`,
        descriptionAr: `التقدير: ${c.grade || "ناجح"}`,
        link: `/certificate/${c.certificateNumber}`,
        metadata: { certificateNumber: c.certificateNumber },
      });
    }

    for (const p of userPayments) {
      if (p.status === "completed") {
        timeline.push({
          type: "payment",
          date: p.createdAt,
          title: `Payment for ${p.courseTitleEn}`,
          titleAr: `دفعة ${p.courseTitleAr}`,
          description: `${p.amount} EGP`,
          descriptionAr: `${p.amount} جنيه`,
          metadata: { amount: p.amount, transactionId: p.transactionId },
        });
      }
    }

    // Sort by date descending
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      stats: {
        totalCourses,
        completedCourses,
        totalCertificates,
        totalLessonsCompleted,
        totalSpent,
      },
      enrolledCourses,
      certificates: certs,
      payments: userPayments,
      timeline,
    };
  }),
});
