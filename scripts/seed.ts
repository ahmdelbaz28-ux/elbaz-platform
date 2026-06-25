/**
 * Seed Script — Populates the database with initial data for launch.
 *
 * Run: npx tsx scripts/seed.ts
 *
 * This script is idempotent — it checks if data exists before inserting.
 * Safe to run multiple times.
 *
 * Creates:
 * - 1 admin user (admin / Admin@123456)
 * - 4 categories
 * - 4 courses (2 free, 2 premium) with modules and lessons
 * - 3 published testimonials
 *
 * Also runs ALTER TABLE to add missing columns if needed.
 */

import "dotenv/config";
import bcryptjs from "bcryptjs";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";

function sanitizeDbUri(raw: string): string {
  return raw.replace(/[?&]ssl-mode=[^&]*/g, "").replace(/\?$/, "");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[Seed] DATABASE_URL environment variable is required");
  process.exit(1);
}

async function main() {
  console.log("[Seed] Connecting to database...");

  const isAiven = DATABASE_URL?.includes("aivencloud.com");

  const connectionConfig: mysql.ConnectionOptions = {
    uri: sanitizeDbUri(DATABASE_URL),
    connectTimeout: 15000,
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true,
    namedPlaceholders: true,
  };

  if (isAiven) {
    connectionConfig.ssl = { rejectUnauthorized: false };
  }

  const connection = await mysql.createConnection(connectionConfig);
  const db = drizzle(connection);

  console.log("[Seed] Connected successfully.");

  // ── Step 0: Ensure missing columns exist ──
  console.log("[Seed] Checking for missing columns...");

  try {
    await connection.execute(
      `ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS is_admin_reply TINYINT(1) NOT NULL DEFAULT 0`
    );
    console.log("[Seed] ✓ Ensured is_admin_reply column exists on ticket_replies");
  } catch (err: any) {
    // MySQL might not support IF NOT EXISTS in ALTER TABLE
    if (err.code === "ER_DUP_FIELDNAME") {
      console.log("[Seed] ✓ Column is_admin_reply already exists on ticket_replies");
    } else {
      // Try without IF NOT EXISTS
      try {
        await connection.execute(
          `ALTER TABLE ticket_replies ADD COLUMN is_admin_reply TINYINT(1) NOT NULL DEFAULT 0`
        );
        console.log("[Seed] ✓ Added is_admin_reply column to ticket_replies");
      } catch (err2: any) {
        if (err2.code === "ER_DUP_FIELDNAME") {
          console.log("[Seed] ✓ Column is_admin_reply already exists on ticket_replies");
        } else {
          console.warn("[Seed] Could not add is_admin_reply column:", err2.message);
        }
      }
    }
  }

  // ── Step 1: Create admin user ──
  console.log("[Seed] Creating admin user...");

  const adminPasswordHash = await bcryptjs.hash("Admin@123456", 12);

  const [existingAdmin] = await connection.execute(
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    ["admin"]
  ) as any[];

  let adminId: number;
  if (existingAdmin.length > 0) {
    adminId = existingAdmin[0].id;
    console.log(`[Seed] ✓ Admin user already exists (id: ${adminId})`);
  } else {
    const [result] = await connection.execute(
      `INSERT INTO users (name, email, password_hash, role, username, is_active, preferred_language, token_version, email_verified_at)
       VALUES (?, ?, ?, 'admin', ?, true, 'ar', 0, NOW())`,
      ["Ahmed Elbaz", "admin@ahmedelbaz.qzz.io", adminPasswordHash, "admin"]
    ) as any;
    adminId = result.insertId;
    console.log(`[Seed] ✓ Admin user created (id: ${adminId})`);
  }

  // ── Step 2: Create categories ──
  console.log("[Seed] Creating categories...");

  const categoriesData = [
    { name_en: "Web Development", name_ar: "تطوير الويب", slug: "web-development", icon: "code", sort_order: 1 },
    { name_en: "Mobile Development", name_ar: "تطوير تطبيقات الموبايل", slug: "mobile-development", icon: "smartphone", sort_order: 2 },
    { name_en: "Data Science & AI", name_ar: "علوم البيانات والذكاء الاصطناعي", slug: "data-science-ai", icon: "brain", sort_order: 3 },
    { name_en: "Design & UX", name_ar: "التصميم وتجربة المستخدم", slug: "design-ux", icon: "palette", sort_order: 4 },
  ];

  const categoryIdMap: Record<string, number> = {};

  for (const cat of categoriesData) {
    const [existing] = await connection.execute(
      `SELECT id FROM categories WHERE slug = ? LIMIT 1`,
      [cat.slug]
    ) as any[];

    if (existing.length > 0) {
      categoryIdMap[cat.slug] = existing[0].id;
    } else {
      const [result] = await connection.execute(
        `INSERT INTO categories (name_en, name_ar, slug, icon, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, true)`,
        [cat.name_en, cat.name_ar, cat.slug, cat.icon, cat.sort_order]
      ) as any;
      categoryIdMap[cat.slug] = result.insertId;
      console.log(`[Seed] ✓ Category created: ${cat.name_en}`);
    }
  }

  // ── Step 3: Create courses ──
  console.log("[Seed] Creating courses...");

  const coursesData = [
    {
      slug: "html-css-basics",
      title_en: "HTML & CSS Fundamentals",
      title_ar: "أساسيات HTML و CSS",
      short_desc_en: "Learn the building blocks of every website — HTML structure and CSS styling from zero to hero.",
      short_desc_ar: "تعلم أساسيات بناء المواقع — هيكل HTML وتنسيق CSS من الصفر حتى الاحتراف.",
      description_en: "A comprehensive introduction to web development fundamentals. You will learn HTML5 semantic elements, CSS3 layouts including Flexbox and Grid, responsive design principles, and best practices for creating modern, accessible websites. Perfect for absolute beginners with no prior coding experience.",
      description_ar: "مقدمة شاملة لأساسيات تطوير الويب. ستتعلم عناصر HTML5 الدلالية، تخطيطات CSS3 بما في ذلك Flexbox و Grid، مبادئ التصميم المتجاوب، وأفضل الممارسات لإنشاء مواقع حديثة وسهلة الوصول.",
      category_slug: "web-development",
      price: "0.00",
      is_premium: false,
      is_published: true,
      is_featured: true,
      level: "beginner",
      language: "ar",
      duration_hours: "8.00",
      thumbnail: "/images/courses/html-css-thumb.jpg",
      cover_image: "/images/courses/html-css-cover.jpg",
      instructor_name: "Ahmed Elbaz",
      tags: JSON.stringify(["HTML", "CSS", "Web", "Frontend"]),
      requirements: JSON.stringify(["No prior programming experience needed", "A computer with a web browser", "Willingness to learn and practice"]),
      what_you_learn: JSON.stringify(["Build responsive web pages from scratch", "Master CSS Flexbox and Grid layouts", "Understand HTML5 semantic elements", "Create mobile-friendly designs", "Deploy your first website"]),
      rating: "4.8",
      review_count: 24,
      student_count: 156,
      enrolled_count: 156,
      original_price: null,
    },
    {
      slug: "javascript-essentials",
      title_en: "JavaScript Essentials",
      title_ar: "أساسيات JavaScript",
      short_desc_en: "Master JavaScript programming — variables, functions, DOM manipulation, and modern ES6+ features.",
      short_desc_ar: "أتقن برمجة JavaScript — المتغيرات، الدوال، التعامل مع DOM، وميزات ES6+ الحديثة.",
      description_en: "Dive deep into JavaScript, the language of the web. This course covers everything from basic syntax and data types to advanced concepts like closures, promises, async/await, and ES6+ modules. You will build real projects including interactive forms and dynamic web applications.",
      description_ar: "انغمس في JavaScript، لغة الويب. يغطي هذا الكورس كل شيء من الصياغة الأساسية وأنواع البيانات إلى المفاهيم المتقدمة مثل الـ closures والـ promises والـ async/await.",
      category_slug: "web-development",
      price: "0.00",
      is_premium: false,
      is_published: true,
      is_featured: false,
      level: "beginner",
      language: "ar",
      duration_hours: "12.00",
      thumbnail: "/images/courses/javascript-thumb.jpg",
      cover_image: "/images/courses/javascript-cover.jpg",
      instructor_name: "Ahmed Elbaz",
      tags: JSON.stringify(["JavaScript", "ES6", "DOM", "Programming"]),
      requirements: JSON.stringify(["Basic knowledge of HTML and CSS", "Familiarity with using a web browser"]),
      what_you_learn: JSON.stringify(["Write clean, modern JavaScript code", "Manipulate the DOM dynamically", "Handle events and user interactions", "Work with arrays, objects, and functions", "Understand async programming with Promises"]),
      rating: "4.7",
      review_count: 18,
      student_count: 98,
      enrolled_count: 98,
      original_price: null,
    },
    {
      slug: "react-nextjs-fullstack",
      title_en: "React & Next.js — Full Stack Bootcamp",
      title_ar: "React و Next.js — بوتكامب تطوير متكامل",
      short_desc_en: "Build production-ready web applications with React 19, Next.js, TypeScript, and modern tooling.",
      short_desc_ar: "ابنِ تطبيقات ويب جاهزة للإنتاج باستخدام React 19 و Next.js و TypeScript.",
      description_en: "An intensive bootcamp covering the entire React and Next.js ecosystem. Learn component architecture, state management with React Query, server-side rendering, API routes, authentication, database integration with Prisma, deployment, and production best practices. Includes 3 real-world projects.",
      description_ar: "بوتكامب مكثف يغطي منظومة React و Next.js بالكامل. تعلم بنية المكونات، إدارة الحالة، الـ server-side rendering، مصادقة المستخدمين، قواعد البيانات، والنشر.",
      category_slug: "web-development",
      price: "499.00",
      is_premium: true,
      is_published: true,
      is_featured: true,
      level: "intermediate",
      language: "ar",
      duration_hours: "40.00",
      thumbnail: "/images/courses/react-nextjs-thumb.jpg",
      cover_image: "/images/courses/react-nextjs-cover.jpg",
      instructor_name: "Ahmed Elbaz",
      tags: JSON.stringify(["React", "Next.js", "TypeScript", "Full Stack", "SSR"]),
      requirements: JSON.stringify(["Solid JavaScript knowledge", "Basic understanding of HTML/CSS", "Familiarity with Node.js basics"]),
      what_you_learn: JSON.stringify(["Build full-stack apps with Next.js", "Master React Server Components", "Implement authentication and authorization", "Deploy to production with confidence", "Write type-safe code with TypeScript"]),
      rating: "4.9",
      review_count: 42,
      student_count: 234,
      enrolled_count: 234,
      original_price: "799.00",
    },
    {
      slug: "mobile-flutter",
      title_en: "Mobile App Development with Flutter",
      title_ar: "تطوير تطبيقات الموبايل باستخدام Flutter",
      short_desc_en: "Create beautiful cross-platform mobile apps for iOS and Android with Flutter and Dart.",
      short_desc_ar: "أنشئ تطبيقات موبايل متعددة المنصات لنظامي iOS و Android باستخدام Flutter و Dart.",
      description_en: "Learn to build stunning mobile applications for both iOS and Android using Flutter and Dart. This course covers widgets, state management with Riverpod, navigation, API integration, local storage, push notifications, and publishing to App Store and Google Play.",
      description_ar: "تعلم بناء تطبيقات موبايل مذهلة لنظامي iOS و Android باستخدام Flutter و Dart. يغطي هذا الكورس الـ widgets، إدارة الحالة، التنقل، التكامل مع الـ APIs، التخزين المحلي، الإشعارات، والنشر.",
      category_slug: "mobile-development",
      price: "399.00",
      is_premium: true,
      is_published: true,
      is_featured: false,
      level: "intermediate",
      language: "ar",
      duration_hours: "30.00",
      thumbnail: "/images/courses/flutter-thumb.jpg",
      cover_image: "/images/courses/flutter-cover.jpg",
      instructor_name: "Ahmed Elbaz",
      tags: JSON.stringify(["Flutter", "Dart", "Mobile", "iOS", "Android"]),
      requirements: JSON.stringify(["Basic programming knowledge in any language", "Understanding of OOP concepts", "A computer capable of running emulators"]),
      what_you_learn: JSON.stringify(["Build cross-platform mobile apps", "Master Flutter widgets and layouts", "Implement state management with Riverpod", "Integrate REST APIs and handle data", "Publish apps to App Store and Google Play"]),
      rating: "4.6",
      review_count: 15,
      student_count: 67,
      enrolled_count: 67,
      original_price: "599.00",
    },
  ];

  const courseIdMap: Record<string, number> = {};

  for (const course of coursesData) {
    const categoryId = categoryIdMap[course.category_slug];

    const [existing] = await connection.execute(
      `SELECT id FROM courses WHERE slug = ? LIMIT 1`,
      [course.slug]
    ) as any[];

    if (existing.length > 0) {
      courseIdMap[course.slug] = existing[0].id;
      console.log(`[Seed] ✓ Course already exists: ${course.title_en}`);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO courses (
          instructor_id, title, slug, description, short_description,
          cover_image, price, discount_price, currency, level, language,
          duration_hours, is_published, is_featured, enrolled_count,
          average_rating, total_reviews, tags, requirements, what_you_learn,
          title_en, title_ar, short_desc_en, short_desc_ar,
          category_id, is_premium, thumbnail, original_price,
          rating, review_count, student_count, instructor_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adminId,
          course.title_ar,
          course.slug,
          course.description_ar,
          course.short_desc_ar,
          course.cover_image,
          course.price,
          course.original_price || null,
          "EGP",
          course.level,
          course.language,
          course.duration_hours,
          course.is_published,
          course.is_featured,
          course.enrolled_count,
          parseFloat(course.rating),
          course.review_count,
          course.tags,
          course.requirements,
          course.what_you_learn,
          course.title_en,
          course.title_ar,
          course.short_desc_en,
          course.short_desc_ar,
          categoryId,
          course.is_premium,
          course.thumbnail,
          course.original_price,
          parseFloat(course.rating),
          course.review_count,
          course.student_count,
          course.instructor_name,
        ]
      ) as any;
      courseIdMap[course.slug] = result.insertId;
      console.log(`[Seed] ✓ Course created: ${course.title_en}`);
    }
  }

  // ── Step 4: Create modules and lessons for each course ──
  console.log("[Seed] Creating modules and lessons...");

  const modulesData: Record<string, { title: string; lessons: { title_en: string; title_ar: string; is_free: boolean; duration_minutes: number }[] }[]> = {
    "html-css-basics": [
      {
        title: "Introduction to HTML",
        lessons: [
          { title_en: "What is HTML?", title_ar: "ما هو HTML؟", is_free: true, duration_minutes: 15 },
          { title_en: "Setting Up Your Development Environment", title_ar: "إعداد بيئة التطوير", is_free: true, duration_minutes: 20 },
          { title_en: "HTML Document Structure", title_ar: "هيكل مستند HTML", is_free: true, duration_minutes: 25 },
          { title_en: "HTML Elements and Tags", title_ar: "عناصر وعلامات HTML", is_free: false, duration_minutes: 30 },
          { title_en: "Forms and Input Elements", title_ar: "النماذج وعناصر الإدخال", is_free: false, duration_minutes: 35 },
        ],
      },
      {
        title: "CSS Fundamentals",
        lessons: [
          { title_en: "Introduction to CSS", title_ar: "مقدمة في CSS", is_free: true, duration_minutes: 20 },
          { title_en: "Selectors and Specificity", title_ar: "المحددات والأولوية", is_free: false, duration_minutes: 25 },
          { title_en: "The Box Model", title_ar: "نموذج الصندوق", is_free: false, duration_minutes: 30 },
          { title_en: "Flexbox Layout", title_ar: "تخطيط Flexbox", is_free: false, duration_minutes: 40 },
          { title_en: "CSS Grid", title_ar: "شبكة CSS", is_free: false, duration_minutes: 40 },
        ],
      },
      {
        title: "Responsive Design",
        lessons: [
          { title_en: "Media Queries", title_ar: "استعلامات الوسائط", is_free: true, duration_minutes: 25 },
          { title_en: "Mobile-First Design", title_ar: "التصميم للجوال أولاً", is_free: false, duration_minutes: 30 },
          { title_en: "Building a Complete Responsive Page", title_ar: "بناء صفحة متجاوبة كاملة", is_free: false, duration_minutes: 45 },
        ],
      },
    ],
    "javascript-essentials": [
      {
        title: "JavaScript Basics",
        lessons: [
          { title_en: "Variables and Data Types", title_ar: "المتغيرات وأنواع البيانات", is_free: true, duration_minutes: 20 },
          { title_en: "Operators and Expressions", title_ar: "العوامل والتعبيرات", is_free: true, duration_minutes: 25 },
          { title_en: "Conditional Statements", title_ar: "جمل الشرط", is_free: true, duration_minutes: 25 },
          { title_en: "Loops and Iteration", title_ar: "الحلقات والتكرار", is_free: false, duration_minutes: 30 },
        ],
      },
      {
        title: "Functions and Scope",
        lessons: [
          { title_en: "Function Declarations and Expressions", title_ar: "تعريف الدوال والتعبيرات", is_free: true, duration_minutes: 25 },
          { title_en: "Arrow Functions", title_ar: "دوال الأسهم", is_free: false, duration_minutes: 20 },
          { title_en: "Closures and Scope", title_ar: "ال closures والنطاق", is_free: false, duration_minutes: 35 },
          { title_en: "Higher-Order Functions", title_ar: "الدوال عالية الرتبة", is_free: false, duration_minutes: 35 },
        ],
      },
      {
        title: "DOM and Events",
        lessons: [
          { title_en: "Selecting and Manipulating DOM Elements", title_ar: "اختيار وتعديل عناصر DOM", is_free: true, duration_minutes: 30 },
          { title_en: "Event Handling", title_ar: "التعامل مع الأحداث", is_free: false, duration_minutes: 35 },
          { title_en: "Building an Interactive Project", title_ar: "بناء مشروع تفاعلي", is_free: false, duration_minutes: 45 },
        ],
      },
    ],
    "react-nextjs-fullstack": [
      {
        title: "React Fundamentals",
        lessons: [
          { title_en: "React Components and JSX", title_ar: "مكونات React و JSX", is_free: true, duration_minutes: 30 },
          { title_en: "State and Props", title_ar: "الحالة والخصائص", is_free: true, duration_minutes: 35 },
          { title_en: "Hooks Deep Dive", title_ar: "عمق الـ Hooks", is_free: false, duration_minutes: 45 },
          { title_en: "React Query for Data Fetching", title_ar: "React Query لجلب البيانات", is_free: false, duration_minutes: 40 },
        ],
      },
      {
        title: "Next.js Core Concepts",
        lessons: [
          { title_en: "App Router and File-Based Routing", title_ar: "App Router والتوجيه بالملفات", is_free: true, duration_minutes: 35 },
          { title_en: "Server Components vs Client Components", title_ar: "مكونات السيرفر مقابل مكونات العميل", is_free: false, duration_minutes: 40 },
          { title_en: "API Routes and Middleware", title_ar: "API Routes والبرمجيات الوسيطة", is_free: false, duration_minutes: 40 },
          { title_en: "Authentication with NextAuth", title_ar: "المصادقة باستخدام NextAuth", is_free: false, duration_minutes: 45 },
        ],
      },
      {
        title: "Production Deployment",
        lessons: [
          { title_en: "Database Integration with Prisma", title_ar: "تكامل قواعد البيانات مع Prisma", is_free: false, duration_minutes: 40 },
          { title_en: "Testing Strategies", title_ar: "استراتيجيات الاختبار", is_free: false, duration_minutes: 35 },
          { title_en: "Deploying to Vercel", title_ar: "النشر على Vercel", is_free: false, duration_minutes: 30 },
        ],
      },
    ],
    "mobile-flutter": [
      {
        title: "Flutter Basics",
        lessons: [
          { title_en: "Dart Language Fundamentals", title_ar: "أساسيات لغة Dart", is_free: true, duration_minutes: 30 },
          { title_en: "Flutter Project Structure", title_ar: "هيكل مشروع Flutter", is_free: true, duration_minutes: 25 },
          { title_en: "Basic Widgets", title_ar: "الودجات الأساسية", is_free: true, duration_minutes: 35 },
          { title_en: "Layouts in Flutter", title_ar: "التخطيطات في Flutter", is_free: false, duration_minutes: 40 },
        ],
      },
      {
        title: "State Management and Navigation",
        lessons: [
          { title_en: "State Management with Riverpod", title_ar: "إدارة الحالة مع Riverpod", is_free: true, duration_minutes: 40 },
          { title_en: "Navigation and Routing", title_ar: "التنقل والتوجيه", is_free: false, duration_minutes: 35 },
          { title_en: "API Integration", title_ar: "التكامل مع الـ APIs", is_free: false, duration_minutes: 40 },
          { title_en: "Local Storage with SharedPreferences", title_ar: "التخزين المحلي", is_free: false, duration_minutes: 30 },
        ],
      },
      {
        title: "Publishing",
        lessons: [
          { title_en: "Push Notifications", title_ar: "الإشعارات", is_free: false, duration_minutes: 35 },
          { title_en: "App Store and Google Play Publishing", title_ar: "النشر على App Store و Google Play", is_free: false, duration_minutes: 40 },
          { title_en: "Final Capstone Project", title_ar: "المشروع التطبيقي النهائي", is_free: false, duration_minutes: 60 },
        ],
      },
    ],
  };

  for (const [courseSlug, modules] of Object.entries(modulesData)) {
    const courseId = courseIdMap[courseSlug];
    if (!courseId) {
      console.warn(`[Seed] Skipping modules for ${courseSlug} — course not found`);
      continue;
    }

    for (let moduleOrder = 0; moduleOrder < modules.length; moduleOrder++) {
      const mod = modules[moduleOrder];
      const moduleTitle = mod.title;

      // Check if module exists
      const [existingModule] = await connection.execute(
        `SELECT id FROM modules WHERE course_id = ? AND \`order\` = ? LIMIT 1`,
        [courseId, moduleOrder]
      ) as any[];

      let moduleId: number;
      if (existingModule.length > 0) {
        moduleId = existingModule[0].id;
      } else {
        const [modResult] = await connection.execute(
          `INSERT INTO modules (course_id, title, \`order\`) VALUES (?, ?, ?)`,
          [courseId, moduleTitle, moduleOrder]
        ) as any;
        moduleId = modResult.insertId;
      }

      // Create lessons
      for (let lessonOrder = 0; lessonOrder < mod.lessons.length; lessonOrder++) {
        const lesson = mod.lessons[lessonOrder];

        const [existingLesson] = await connection.execute(
          `SELECT id FROM lessons WHERE module_id = ? AND \`order\` = ? LIMIT 1`,
          [moduleId, lessonOrder]
        ) as any[];

        if (existingLesson.length === 0) {
          await connection.execute(
            `INSERT INTO lessons (module_id, course_id, title, title_en, title_ar, type, is_free, \`order\`, duration_minutes, is_published, sort_order, video_url)
             VALUES (?, ?, ?, ?, ?, 'video', ?, ?, ?, true, ?, NULL)`,
            [
              moduleId,
              courseId,
              lesson.title_ar,
              lesson.title_en,
              lesson.title_ar,
              lesson.is_free,
              lessonOrder,
              lesson.duration_minutes,
              lessonOrder,
            ]
          );
        }
      }
    }
    console.log(`[Seed] ✓ Modules and lessons created for: ${courseSlug}`);
  }

  // ── Step 5: Create testimonials ──
  console.log("[Seed] Creating testimonials...");

  const testimonialsData = [
    {
      student_name: "Mohamed Ali",
      student_title: "Frontend Developer at Tech Corp",
      content_en: "This platform completely changed my career. The HTML/CSS course was so well-structured that I went from zero knowledge to landing my first developer job in just 3 months. The instructor explains complex concepts in a very simple and practical way.",
      content_ar: "هذه المنصة غيرت مسار حياتي المهنية بالكامل. كورس HTML/CSS كان منظماً بشكل رائع، وانتقلت من لا شيء إلى الحصول على أول وظيفة كمطور في 3 أشهر فقط. المدرس يشرح المفاهيم المعقدة بطريقة بسيطة وعملية جداً.",
      rating: 5,
      is_published: true,
    },
    {
      student_name: "Sara Hassan",
      student_title: "Full Stack Developer",
      content_en: "The React and Next.js bootcamp is outstanding. I already knew basic JavaScript but this course took my skills to the next level. The real-world projects were incredibly valuable, and I now build production apps with confidence.",
      content_ar: "بوتكامب React و Next.js ممتاز. كنت أعرف أساسيات JavaScript لكن هذا الكورس نقل مهاراتي لمستوى آخر. المشاريع الواقعية كانت قيمة للغاية، والآن أبني تطبيقات إنتاجية بثقة.",
      rating: 5,
      is_published: true,
    },
    {
      student_name: "Omar Khaled",
      student_title: "Mobile Developer",
      content_en: "I tried many platforms to learn Flutter but none compared to this one. The step-by-step approach, clear explanations in Arabic, and practical exercises made learning enjoyable. I published my first app on Google Play after completing this course!",
      content_ar: "جربت منصات كثيرة لتعلم Flutter لكن لا شيء يقارن بهذه المنصة. النهج التدريجي، الشرح الواضح بالعربية، والتمارين العملية جعلت التعلم ممتعاً. نشرت أول تطبيق لي على Google Play بعد إتمام هذا الكورس!",
      rating: 4,
      is_published: true,
    },
  ];

  for (const testimonial of testimonialsData) {
    const [existing] = await connection.execute(
      `SELECT id FROM testimonials WHERE student_name = ? LIMIT 1`,
      [testimonial.student_name]
    ) as any[];

    if (existing.length === 0) {
      await connection.execute(
        `INSERT INTO testimonials (student_name, student_title, content, rating, is_published)
         VALUES (?, ?, ?, ?, ?)`,
        [
          testimonial.student_name,
          testimonial.student_title,
          testimonial.content_ar,
          testimonial.rating,
          testimonial.is_published,
        ]
      );
      console.log(`[Seed] ✓ Testimonial created: ${testimonial.student_name}`);
    } else {
      console.log(`[Seed] ✓ Testimonial already exists: ${testimonial.student_name}`);
    }
  }

  // ── Step 6: Verify data ──
  console.log("\n[Seed] ── Verification ──");

  const [users] = await connection.execute(`SELECT COUNT(*) as count FROM users`) as any[];
  const [cats] = await connection.execute(`SELECT COUNT(*) as count FROM categories`) as any[];
  const [crs] = await connection.execute(`SELECT COUNT(*) as count FROM courses WHERE is_published = 1`) as any[];
  const [mods] = await connection.execute(`SELECT COUNT(*) as count FROM modules`) as any[];
  const [less] = await connection.execute(`SELECT COUNT(*) as count FROM lessons`) as any[];
  const [tests] = await connection.execute(`SELECT COUNT(*) as count FROM testimonials WHERE is_published = 1`) as any[];

  console.log(`  Users: ${users[0].count}`);
  console.log(`  Categories: ${cats[0].count}`);
  console.log(`  Published Courses: ${crs[0].count}`);
  console.log(`  Modules: ${mods[0].count}`);
  console.log(`  Lessons: ${less[0].count}`);
  console.log(`  Testimonials: ${tests[0].count}`);

  await connection.end();
  console.log("\n[Seed] ✅ All done! Database is ready for launch.");
}

main().catch((err) => {
  console.error("[Seed] Fatal error:", err);
  process.exit(1);
});
