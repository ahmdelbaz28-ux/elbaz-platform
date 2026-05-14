/**
 * Seed script for elbaz-platform beta launch
 * 
 * Creates:
 * - 1 admin user
 * - 4 categories
 * - 4 courses (2 free, 2 premium) + 1 lesson each
 * - 3 testimonials
 * 
 * Usage: npx tsx seed.ts
 */

import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("[Seed] FATAL: DATABASE_URL environment variable is required.");
  console.error("[Seed] Usage: DATABASE_URL=mysql://... npx tsx seed.ts");
  process.exit(1);
}

async function main() {
  const sanitizedUri = DATABASE_URL!.replace(/[?&]ssl-mode=[^&]*/g, "").replace(/\?$/, "");
  
  const connection = await mysql.createConnection({
    uri: sanitizedUri,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 15000,
    namedPlaceholders: true,
  });

  console.log("[Seed] Connected to Aiven MySQL");

  // ═══════════════════════════════════════════════
  // ADMIN USER
  // ═══════════════════════════════════════════════
  const adminPasswordHash = "$2b$12$iILr0cIFyvU.tF1uWh9n9epdOyam45A3wPccUap9TtgHnYcJ6u2GK";
  
  const [adminRows] = await connection.execute(
    "SELECT id FROM users WHERE username = ? LIMIT 1",
    ["admin"]
  );

  let adminId: number;
  if ((adminRows as any[]).length > 0) {
    adminId = (adminRows as any[])[0].id;
    console.log(`[Seed] Admin user already exists (id=${adminId})`);
  } else {
    const [result] = await connection.execute(
      `INSERT INTO users (username, passwordHash, name, email, role, preferredLanguage, tokenVersion)
       VALUES (?, ?, ?, ?, 'admin', 'ar', 0)`,
      ["admin", adminPasswordHash, "أحمد الباز", "admin@ahmedelbaz.qzz.io"]
    );
    adminId = (result as any).insertId;
    console.log(`[Seed] Admin user created (id=${adminId}). Check your .env or secure storage for credentials.`);
  }

  // ═══════════════════════════════════════════════
  // CATEGORIES
  // ═══════════════════════════════════════════════
  const categories = [
    { nameEn: "Web Development", nameAr: "تطوير الويب", slug: "web-development", icon: "globe", sortOrder: 1 },
    { nameEn: "Mobile Development", nameAr: "تطوير الموبايل", slug: "mobile-development", icon: "smartphone", sortOrder: 2 },
    { nameEn: "Data Science", nameAr: "علم البيانات", slug: "data-science", icon: "bar-chart-2", sortOrder: 3 },
    { nameEn: "UI/UX Design", nameAr: "تصميم واجهات المستخدم", slug: "ui-ux-design", icon: "palette", sortOrder: 4 },
  ];

  const categoryIds: Record<string, number> = {};

  for (const cat of categories) {
    const [existing] = await connection.execute(
      "SELECT id FROM categories WHERE slug = ? LIMIT 1",
      [cat.slug]
    );
    if ((existing as any[]).length > 0) {
      categoryIds[cat.slug] = (existing as any[])[0].id;
      console.log(`[Seed] Category "${cat.nameEn}" already exists (id=${categoryIds[cat.slug]})`);
    } else {
      const [result] = await connection.execute(
        `INSERT INTO categories (nameEn, nameAr, slug, icon, sortOrder)
         VALUES (?, ?, ?, ?, ?)`,
        [cat.nameEn, cat.nameAr, cat.slug, cat.icon, cat.sortOrder]
      );
      categoryIds[cat.slug] = (result as any).insertId;
      console.log(`[Seed] Category "${cat.nameEn}" created (id=${categoryIds[cat.slug]})`);
    }
  }

  // ═══════════════════════════════════════════════
  // COURSES
  // Actual DB columns: id, slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr,
  //   shortDescEn, shortDescAr, thumbnail, trailerUrl, level, isPremium, price, originalPrice,
  //   durationHours, rating, reviewCount, studentCount, instructorName, isPublished, isFeatured,
  //   prerequisitesEn, prerequisitesAr, learningOutcomesEn, learningOutcomesAr, sortOrder, createdAt, updatedAt
  // ═══════════════════════════════════════════════
  const courses = [
    {
      slug: "html-css-basics",
      titleEn: "HTML & CSS Basics",
      titleAr: "أساسيات HTML و CSS",
      shortDescEn: "Learn the fundamentals of web development with HTML5 and CSS3",
      shortDescAr: "تعلم أساسيات تطوير الويب مع HTML5 و CSS3",
      descriptionEn: "A comprehensive course covering HTML5 semantics, CSS3 layouts with Flexbox and Grid, responsive design, and modern CSS techniques. Perfect for absolute beginners who want to build their first website.",
      descriptionAr: "دورة شاملة تغطي دلالات HTML5، تخطيطات CSS3 مع Flexbox و Grid، التصميم المتجاوب، وتقنيات CSS الحديثة.",
      categorySlug: "web-development",
      level: "beginner",
      isPremium: false,
      price: "0.00",
      originalPrice: "0.00",
      durationHours: 5,
      rating: "4.8",
      reviewCount: 45,
      studentCount: 120,
      instructorName: "أحمد الباز",
      thumbnail: "https://images.unsplash.com/photo-1547658719-da2b51169166?w=800&h=450&fit=crop",
      isPublished: true,
      isFeatured: true,
      prerequisitesEn: "No prior programming experience needed",
      prerequisitesAr: "لا حاجة لخبرة سابقة في البرمجة",
      learningOutcomesEn: JSON.stringify(["Build responsive websites", "Master HTML5 semantics", "Create modern layouts with Flexbox and Grid"]),
      learningOutcomesAr: JSON.stringify(["بناء مواقع متجاوبة", "إتقان دلالات HTML5", "إنشاء تخطيطات حديثة"]),
    },
    {
      slug: "javascript-fundamentals",
      titleEn: "JavaScript Fundamentals",
      titleAr: "أساسيات JavaScript",
      shortDescEn: "Master JavaScript from variables to async programming",
      shortDescAr: "أتقن JavaScript من المتغيرات إلى البرمجة غير المتزامنة",
      descriptionEn: "Deep dive into JavaScript. Learn variables, data types, functions, DOM manipulation, events, promises, async/await, and modern ES6+ features.",
      descriptionAr: "غوص عميق في JavaScript. تعلم المتغيرات، أنواع البيانات، الدوال، DOM، الأحداث، الوعود، و async/await.",
      categorySlug: "web-development",
      level: "beginner",
      isPremium: false,
      price: "0.00",
      originalPrice: "0.00",
      durationHours: 12,
      rating: "4.9",
      reviewCount: 78,
      studentCount: 250,
      instructorName: "أحمد الباز",
      thumbnail: "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=800&h=450&fit=crop",
      isPublished: true,
      isFeatured: true,
      prerequisitesEn: "Basic HTML and CSS knowledge",
      prerequisitesAr: "معرفة أساسية بـ HTML و CSS",
      learningOutcomesEn: JSON.stringify(["Write clean JavaScript code", "Manipulate the DOM", "Work with Promises and async/await"]),
      learningOutcomesAr: JSON.stringify(["كتابة كود JavaScript نظيف", "التعامل مع DOM", "العمل مع Promises و async/await"]),
    },
    {
      slug: "react-nextjs-masterclass",
      titleEn: "React & Next.js Masterclass",
      titleAr: "دورة React و Next.js المتقدمة",
      shortDescEn: "Build production-ready apps with React 18 and Next.js 14",
      shortDescAr: "ابني تطبيقات جاهزة للإنتاج مع React 18 و Next.js 14",
      descriptionEn: "Advanced course covering React 18 features, hooks, context, Next.js App Router, Server Components, API routes, authentication, and deployment.",
      descriptionAr: "دورة متقدمة تغطي React 18 و Next.js App Router و Server Components و API routes والمصادقة والنشر.",
      categorySlug: "web-development",
      level: "advanced",
      isPremium: true,
      price: "499.00",
      originalPrice: "999.00",
      durationHours: 25,
      rating: "5.0",
      reviewCount: 120,
      studentCount: 85,
      instructorName: "أحمد الباز",
      thumbnail: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&h=450&fit=crop",
      isPublished: true,
      isFeatured: true,
      prerequisitesEn: "Strong JavaScript knowledge, Basic React understanding",
      prerequisitesAr: "معرفة قوية بـ JavaScript، فهم أساسي لـ React",
      learningOutcomesEn: JSON.stringify(["Build full-stack apps with Next.js", "Master Server Components", "Deploy to production"]),
      learningOutcomesAr: JSON.stringify(["بناء تطبيقات full-stack مع Next.js", "إتقان Server Components", "النشر على الإنتاج"]),
    },
    {
      slug: "python-data-analysis",
      titleEn: "Python for Data Analysis",
      titleAr: "Python لتحليل البيانات",
      shortDescEn: "Learn Python, Pandas, and visualization for data analysis",
      shortDescAr: "تعلم Python و Pandas والتصوير البياني لتحليل البيانات",
      descriptionEn: "Comprehensive data analysis course using Python, NumPy, Pandas, Matplotlib, Seaborn, and real-world data analysis techniques.",
      descriptionAr: "دورة شاملة لتحليل البيانات باستخدام Python و NumPy و Pandas و Matplotlib و Seaborn.",
      categorySlug: "data-science",
      level: "intermediate",
      isPremium: true,
      price: "399.00",
      originalPrice: "799.00",
      durationHours: 20,
      rating: "4.8",
      reviewCount: 65,
      studentCount: 150,
      instructorName: "أحمد الباز",
      thumbnail: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&h=450&fit=crop",
      isPublished: true,
      isFeatured: false,
      prerequisitesEn: "Basic programming knowledge, Understanding of math concepts",
      prerequisitesAr: "معرفة أساسية بالبرمجة، فهم مفاهيم الرياضيات",
      learningOutcomesEn: JSON.stringify(["Use Pandas for data manipulation", "Create visualizations", "Perform statistical analysis"]),
      learningOutcomesAr: JSON.stringify(["استخدام Pandas لمعالجة البيانات", "إنشاء تصورات بيانية", "إجراء تحليل إحصائي"]),
    },
  ];

  const courseIds: Record<string, number> = {};

  for (const course of courses) {
    const [existing] = await connection.execute(
      "SELECT id FROM courses WHERE slug = ? LIMIT 1",
      [course.slug]
    );
    if ((existing as any[]).length > 0) {
      courseIds[course.slug] = (existing as any[])[0].id;
      console.log(`[Seed] Course "${course.titleEn}" already exists (id=${courseIds[course.slug]})`);
    } else {
      const categoryId = categoryIds[course.categorySlug];
      const [result] = await connection.execute(
        `INSERT INTO courses (
          slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr,
          shortDescEn, shortDescAr, thumbnail, level, isPremium,
          price, originalPrice, durationHours, rating, reviewCount,
          studentCount, instructorName, isPublished, isFeatured,
          prerequisitesEn, prerequisitesAr, learningOutcomesEn, learningOutcomesAr
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        )`,
        [
          course.slug, categoryId, course.titleEn, course.titleAr, course.descriptionEn, course.descriptionAr,
          course.shortDescEn, course.shortDescAr, course.thumbnail, course.level, course.isPremium ? 1 : 0,
          course.price, course.originalPrice, course.durationHours, course.rating, course.reviewCount,
          course.studentCount, course.instructorName, course.isPublished ? 1 : 0, course.isFeatured ? 1 : 0,
          course.prerequisitesEn, course.prerequisitesAr, course.learningOutcomesEn, course.learningOutcomesAr,
        ]
      );
      courseIds[course.slug] = (result as any).insertId;
      console.log(`[Seed] Course "${course.titleEn}" created (id=${courseIds[course.slug]})`);
    }
  }

  // ═══════════════════════════════════════════════
  // LESSONS (no modules table, direct courseId)
  // Actual DB: id, courseId, titleEn, titleAr, descriptionEn, descriptionAr,
  //   videoUrl, durationMinutes, sortOrder, isFree, isPublished, createdAt
  // ═══════════════════════════════════════════════
  const lessons = [
    {
      courseSlug: "html-css-basics",
      titleEn: "Introduction to HTML5",
      titleAr: "مقدمة في HTML5",
      descriptionEn: "Learn the basics of HTML5, its structure, and how to create your first web page.",
      descriptionAr: "تعلم أساسيات HTML5 وتركيبه وكيفية إنشاء أول صفحة ويب لك.",
      isFree: true,
      durationMinutes: 25,
      sortOrder: 1,
      videoUrl: "videos/html-css/01-introduction-to-html5.mp4",
    },
    {
      courseSlug: "javascript-fundamentals",
      titleEn: "Variables and Data Types",
      titleAr: "المتغيرات وأنواع البيانات",
      descriptionEn: "Understand let, const, var and JavaScript data types.",
      descriptionAr: "فهم let و const و var وأنواع بيانات JavaScript.",
      isFree: true,
      durationMinutes: 35,
      sortOrder: 1,
      videoUrl: "videos/javascript/01-variables-and-data-types.mp4",
    },
    {
      courseSlug: "react-nextjs-masterclass",
      titleEn: "React Components and JSX",
      titleAr: "مكونات React و JSX",
      descriptionEn: "Learn about React components, JSX syntax, props, and reusable UI elements.",
      descriptionAr: "تعرف على مكونات React وتركيب JSX و props وعناصر UI قابلة لإعادة الاستخدام.",
      isFree: true,
      durationMinutes: 40,
      sortOrder: 1,
      videoUrl: "videos/react-nextjs/01-react-components-jsx.mp4",
    },
    {
      courseSlug: "python-data-analysis",
      titleEn: "Python Setup and First Steps",
      titleAr: "إعداد Python والخطوات الأولى",
      descriptionEn: "Install Python, set up your environment, and write your first Python scripts.",
      descriptionAr: "ثبّت Python واضبط بيئتك واكتب أول نصوص Python.",
      isFree: true,
      durationMinutes: 30,
      sortOrder: 1,
      videoUrl: "videos/python-data/01-python-setup.mp4",
    },
  ];

  for (const lesson of lessons) {
    const courseId = courseIds[lesson.courseSlug];
    if (!courseId) continue;

    const [existing] = await connection.execute(
      "SELECT id FROM lessons WHERE courseId = ? AND titleEn = ? LIMIT 1",
      [courseId, lesson.titleEn]
    );

    if ((existing as any[]).length > 0) {
      console.log(`[Seed] Lesson "${lesson.titleEn}" already exists`);
    } else {
      await connection.execute(
        `INSERT INTO lessons (
          courseId, titleEn, titleAr, descriptionEn, descriptionAr,
          videoUrl, durationMinutes, sortOrder, isFree, isPublished
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          courseId, lesson.titleEn, lesson.titleAr, lesson.descriptionEn, lesson.descriptionAr,
          lesson.videoUrl, lesson.durationMinutes, lesson.sortOrder, lesson.isFree ? 1 : 0, 1,
        ]
      );
      console.log(`[Seed] Lesson "${lesson.titleEn}" created`);
    }
  }

  // ═══════════════════════════════════════════════
  // TESTIMONIALS
  // Actual DB: id, name, title, company, content, rating, isPublished, createdAt
  // ═══════════════════════════════════════════════
  const testimonials = [
    {
      name: "محمد أحمد",
      title: "مطور ويب",
      company: "شركة تقنية",
      content: "دورات ممتازة! انتقلت من الصفر إلى بناء مواقعي الخاصة في بضع أسابيع فقط. المدرب يشرح كل شيء بوضوح مع أمثلة عملية. أنصح بشدة لكل مبتدئ في مجال تطوير الويب.",
      rating: 5,
    },
    {
      name: "سارة محمد",
      title: "مصممة UI/UX",
      company: "وكالة تصميم",
      content: "جودة المحتوى رائعة. أحببت بشكل خاص المشاريع العملية ودعم المجتمع. المنصة العربية الأفضل لتعلم البرمجة والتصميم. استثمار يستحق كل رياق!",
      rating: 5,
    },
    {
      name: "أحمد علي",
      title: "محلل بيانات",
      company: "بنك",
      content: "أفضل منصة عربية لتعلم البرمجة وتحليل البيانات. الدورات منظمة جيداً ومحدثة والمدرب متمكن جداً. ساعدتني في الحصول على وظيفة أحلامي كمحلل بيانات.",
      rating: 4,
    },
  ];

  for (const t of testimonials) {
    const [existing] = await connection.execute(
      "SELECT id FROM testimonials WHERE name = ? LIMIT 1",
      [t.name]
    );
    if ((existing as any[]).length > 0) {
      console.log(`[Seed] Testimonial from "${t.name}" already exists`);
    } else {
      await connection.execute(
        `INSERT INTO testimonials (name, title, company, content, rating, isPublished)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.name, t.title, t.company, t.content, t.rating, 1]
      );
      console.log(`[Seed] Testimonial from "${t.name}" created`);
    }
  }

  console.log("\n" + "═".repeat(50));
  console.log("[Seed] Seeding completed successfully!");
  console.log("[Seed] Admin: admin (check your secure storage for the password)");
  console.log("═".repeat(50));

  await connection.end();
}

main().catch((err) => {
  console.error("[Seed] Fatal error:", err);
  process.exit(1);
});
