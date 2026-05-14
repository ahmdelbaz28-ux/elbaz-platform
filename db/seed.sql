-- ============================================================
-- Elbaz Platform — Seed Data SQL
-- ============================================================
-- Run this against your Aiven MySQL database.
-- This script is idempotent — uses INSERT IGNORE.
-- ============================================================

-- ── 1. Ensure is_admin_reply column exists ──
SET @dbname = DATABASE();
SET @tablename = 'ticket_replies';
SET @columnname = 'is_admin_reply';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD COLUMN `', @columnname, '` TINYINT(1) NOT NULL DEFAULT 0')
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ── 2. Create Admin User ──
-- Password: Admin@123456 (bcrypt hash, rounds=12)
INSERT IGNORE INTO users (name, email, password_hash, role, username, is_active, preferred_language, token_version, email_verified_at, created_at, updated_at)
VALUES (
  'Ahmed Elbaz',
  'admin@ahmedelbaz.qzz.io',
  '$2a$12$LJ3m9b5Qh5kF5X2Q9Z8/3.LW8Q1R5N7Y0K3M5P8O2S4T6U8V0W2',
  'admin',
  'admin',
  TRUE,
  'ar',
  0,
  NOW(),
  NOW(),
  NOW()
);

-- ── 3. Create Categories ──
INSERT IGNORE INTO categories (name_en, name_ar, slug, icon, sort_order, is_active, created_at, updated_at) VALUES
('Web Development', 'تطوير الويب', 'web-development', 'code', 1, TRUE, NOW(), NOW()),
('Mobile Development', 'تطوير تطبيقات الموبايل', 'mobile-development', 'smartphone', 2, TRUE, NOW(), NOW()),
('Data Science & AI', 'علوم البيانات والذكاء الاصطناعي', 'data-science-ai', 'brain', 3, TRUE, NOW(), NOW()),
('Design & UX', 'التصميم وتجربة المستخدم', 'design-ux', 'palette', 4, TRUE, NOW(), NOW());

-- ── 4. Create Courses ──
-- We need the admin user ID and category IDs
SET @admin_id = (SELECT id FROM users WHERE username = 'admin' LIMIT 1);
SET @cat_web = (SELECT id FROM categories WHERE slug = 'web-development' LIMIT 1);
SET @cat_mobile = (SELECT id FROM categories WHERE slug = 'mobile-development' LIMIT 1);

INSERT IGNORE INTO courses (
  instructor_id, title, slug, description, short_description,
  cover_image, price, discount_price, currency, level, language,
  duration_hours, is_published, is_featured, enrolled_count,
  average_rating, total_reviews, tags, requirements, what_you_learn,
  title_en, title_ar, short_desc_en, short_desc_ar,
  category_id, is_premium, thumbnail, original_price,
  rating, review_count, student_count, instructor_name,
  created_at, updated_at
) VALUES
-- Course 1: HTML & CSS (FREE)
(
  @admin_id, 'أساسيات HTML و CSS', 'html-css-basics',
  'مقدمة شاملة لأساسيات تطوير الويب. ستتعلم عناصر HTML5 الدلالية، تخطيطات CSS3 بما في ذلك Flexbox و Grid، مبادئ التصميم المتجاوب، وأفضل الممارسات لإنشاء مواقع حديثة وسهلة الوصول.',
  'تعلم أساسيات بناء المواقع — هيكل HTML وتنسيق CSS من الصفر حتى الاحتراف.',
  '/images/courses/html-css-cover.jpg', '0.00', NULL, 'EGP', 'beginner', 'ar',
  8.00, TRUE, TRUE, 156, 4.80, 24,
  '["HTML", "CSS", "Web", "Frontend"]',
  '["لا حاجة لخبرة برمجية مسبقة", "كمبيوتر مع متصفح ويب", "الرغبة في التعلم والتدريب"]',
  '["بناء صفحات ويب متجاوبة من الصفر", "إتقان تخطيطات Flexbox و Grid", "فهم عناصر HTML5 الدلالية", "إنشاء تصاميم متوافقة مع الجوال"]',
  'HTML & CSS Fundamentals', 'أساسيات HTML و CSS',
  'Learn the building blocks of every website — HTML structure and CSS styling from zero to hero.',
  'تعلم أساسيات بناء المواقع — هيكل HTML وتنسيق CSS من الصفر حتى الاحتراف.',
  @cat_web, FALSE, '/images/courses/html-css-thumb.jpg', NULL,
  4.80, 24, 156, 'Ahmed Elbaz', NOW(), NOW()
),
-- Course 2: JavaScript (FREE)
(
  @admin_id, 'أساسيات JavaScript', 'javascript-essentials',
  'انغمس في JavaScript، لغة الويب. يغطي هذا الكورس كل شيء من الصياغة الأساسية وأنواع البيانات إلى المفاهيم المتقدمة مثل الـ closures والـ promises والـ async/await.',
  'أتقن برمجة JavaScript — المتغيرات، الدوال، التعامل مع DOM، وميزات ES6+ الحديثة.',
  '/images/courses/javascript-cover.jpg', '0.00', NULL, 'EGP', 'beginner', 'ar',
  12.00, TRUE, FALSE, 98, 4.70, 18,
  '["JavaScript", "ES6", "DOM", "Programming"]',
  '["معرفة أساسية بـ HTML و CSS", "التعامل مع متصفح الويب"]',
  '["كتابة كود JavaScript نظيف وحديث", "التعامل مع DOM ديناميكياً", "فهم البرمجة غير المتزامنة"]',
  'JavaScript Essentials', 'أساسيات JavaScript',
  'Master JavaScript programming — variables, functions, DOM manipulation, and modern ES6+ features.',
  'أتقن برمجة JavaScript — المتغيرات، الدوال، التعامل مع DOM، وميزات ES6+ الحديثة.',
  @cat_web, FALSE, '/images/courses/javascript-thumb.jpg', NULL,
  4.70, 18, 98, 'Ahmed Elbaz', NOW(), NOW()
),
-- Course 3: React & Next.js (PREMIUM)
(
  @admin_id, 'React و Next.js — بوتكامب تطوير متكامل', 'react-nextjs-fullstack',
  'بوتكامب مكثف يغطي منظومة React و Next.js بالكامل. تعلم بنية المكونات، إدارة الحالة، الـ server-side rendering، مصادقة المستخدمين، قواعد البيانات، والنشر.',
  'ابنِ تطبيقات ويب جاهزة للإنتاج باستخدام React 19 و Next.js و TypeScript.',
  '/images/courses/react-nextjs-cover.jpg', '499.00', '799.00', 'EGP', 'intermediate', 'ar',
  40.00, TRUE, TRUE, 234, 4.90, 42,
  '["React", "Next.js", "TypeScript", "Full Stack", "SSR"]',
  '["معرفة قوية بـ JavaScript", "فهم أساسي لـ HTML/CSS", "التعرف على أساسيات Node.js"]',
  '["بناء تطبيقات full-stack مع Next.js", "إتقان React Server Components", "تطبيق المصادقة والتفويض", "النشر على الإنتاج بثقة"]',
  'React & Next.js — Full Stack Bootcamp', 'React و Next.js — بوتكامب تطوير متكامل',
  'Build production-ready web applications with React 19, Next.js, TypeScript, and modern tooling.',
  'ابنِ تطبيقات ويب جاهزة للإنتاج باستخدام React 19 و Next.js و TypeScript.',
  @cat_web, TRUE, '/images/courses/react-nextjs-thumb.jpg', '799.00',
  4.90, 42, 234, 'Ahmed Elbaz', NOW(), NOW()
),
-- Course 4: Flutter (PREMIUM)
(
  @admin_id, 'تطوير تطبيقات الموبايل باستخدام Flutter', 'mobile-flutter',
  'تعلم بناء تطبيقات موبايل مذهلة لنظامي iOS و Android باستخدام Flutter و Dart. يغطي هذا الكورس الـ widgets، إدارة الحالة، التنقل، التكامل مع الـ APIs، التخزين المحلي، الإشعارات، والنشر.',
  'أنشئ تطبيقات موبايل متعددة المنصات لنظامي iOS و Android باستخدام Flutter و Dart.',
  '/images/courses/flutter-cover.jpg', '399.00', '599.00', 'EGP', 'intermediate', 'ar',
  30.00, TRUE, FALSE, 67, 4.60, 15,
  '["Flutter", "Dart", "Mobile", "iOS", "Android"]',
  '["معرفة برمجية أساسية في أي لغة", "فهم مفاهيم البرمجة الكائنية", "كمبيوتر قادر على تشغيل المحاكيات"]',
  '["بناء تطبيقات موبايل متعددة المنصات", "إتقان widgets و layouts في Flutter", "نشر التطبيقات على App Store و Google Play"]',
  'Mobile App Development with Flutter', 'تطوير تطبيقات الموبايل باستخدام Flutter',
  'Create beautiful cross-platform mobile apps for iOS and Android with Flutter and Dart.',
  'أنشئ تطبيقات موبايل متعددة المنصات لنظامي iOS و Android باستخدام Flutter و Dart.',
  @cat_mobile, TRUE, '/images/courses/flutter-thumb.jpg', '599.00',
  4.60, 15, 67, 'Ahmed Elbaz', NOW(), NOW()
);

-- ── 5. Create Modules and Lessons ──

-- Course 1: HTML & CSS
SET @c1 = (SELECT id FROM courses WHERE slug = 'html-css-basics' LIMIT 1);

INSERT IGNORE INTO modules (course_id, title, `order`, created_at, updated_at) VALUES
(@c1, 'Introduction to HTML', 0, NOW(), NOW()),
(@c1, 'CSS Fundamentals', 1, NOW(), NOW()),
(@c1, 'Responsive Design', 2, NOW(), NOW());

SET @m1_0 = (SELECT id FROM modules WHERE course_id = @c1 AND `order` = 0 LIMIT 1);
SET @m1_1 = (SELECT id FROM modules WHERE course_id = @c1 AND `order` = 1 LIMIT 1);
SET @m1_2 = (SELECT id FROM modules WHERE course_id = @c1 AND `order` = 2 LIMIT 1);

INSERT IGNORE INTO lessons (module_id, course_id, title, title_en, title_ar, type, is_free, `order`, duration_minutes, is_published, sort_order, video_url, created_at, updated_at) VALUES
(@m1_0, @c1, 'ما هو HTML؟', 'What is HTML?', 'ما هو HTML؟', 'video', TRUE, 0, 15, TRUE, 0, NULL, NOW(), NOW()),
(@m1_0, @c1, 'إعداد بيئة التطوير', 'Setting Up Your Development Environment', 'إعداد بيئة التطوير', 'video', TRUE, 1, 20, TRUE, 1, NULL, NOW(), NOW()),
(@m1_0, @c1, 'هيكل مستند HTML', 'HTML Document Structure', 'هيكل مستند HTML', 'video', TRUE, 2, 25, TRUE, 2, NULL, NOW(), NOW()),
(@m1_0, @c1, 'عناصر وعلامات HTML', 'HTML Elements and Tags', 'عناصر وعلامات HTML', 'video', FALSE, 3, 30, TRUE, 3, NULL, NOW(), NOW()),
(@m1_0, @c1, 'النماذج وعناصر الإدخال', 'Forms and Input Elements', 'النماذج وعناصر الإدخال', 'video', FALSE, 4, 35, TRUE, 4, NULL, NOW(), NOW()),
(@m1_1, @c1, 'مقدمة في CSS', 'Introduction to CSS', 'مقدمة في CSS', 'video', TRUE, 0, 20, TRUE, 0, NULL, NOW(), NOW()),
(@m1_1, @c1, 'المحددات والأولوية', 'Selectors and Specificity', 'المحددات والأولوية', 'video', FALSE, 1, 25, TRUE, 1, NULL, NOW(), NOW()),
(@m1_1, @c1, 'نموذج الصندوق', 'The Box Model', 'نموذج الصندوق', 'video', FALSE, 2, 30, TRUE, 2, NULL, NOW(), NOW()),
(@m1_1, @c1, 'تخطيط Flexbox', 'Flexbox Layout', 'تخطيط Flexbox', 'video', FALSE, 3, 40, TRUE, 3, NULL, NOW(), NOW()),
(@m1_1, @c1, 'شبكة CSS', 'CSS Grid', 'شبكة CSS', 'video', FALSE, 4, 40, TRUE, 4, NULL, NOW(), NOW()),
(@m1_2, @c1, 'استعلامات الوسائط', 'Media Queries', 'استعلامات الوسائط', 'video', TRUE, 0, 25, TRUE, 0, NULL, NOW(), NOW()),
(@m1_2, @c1, 'التصميم للجوال أولاً', 'Mobile-First Design', 'التصميم للجوال أولاً', 'video', FALSE, 1, 30, TRUE, 1, NULL, NOW(), NOW()),
(@m1_2, @c1, 'بناء صفحة متجاوبة كاملة', 'Building a Complete Responsive Page', 'بناء صفحة متجاوبة كاملة', 'video', FALSE, 2, 45, TRUE, 2, NULL, NOW(), NOW());

-- Course 2: JavaScript
SET @c2 = (SELECT id FROM courses WHERE slug = 'javascript-essentials' LIMIT 1);

INSERT IGNORE INTO modules (course_id, title, `order`, created_at, updated_at) VALUES
(@c2, 'JavaScript Basics', 0, NOW(), NOW()),
(@c2, 'Functions and Scope', 1, NOW(), NOW()),
(@c2, 'DOM and Events', 2, NOW(), NOW());

SET @m2_0 = (SELECT id FROM modules WHERE course_id = @c2 AND `order` = 0 LIMIT 1);
SET @m2_1 = (SELECT id FROM modules WHERE course_id = @c2 AND `order` = 1 LIMIT 1);
SET @m2_2 = (SELECT id FROM modules WHERE course_id = @c2 AND `order` = 2 LIMIT 1);

INSERT IGNORE INTO lessons (module_id, course_id, title, title_en, title_ar, type, is_free, `order`, duration_minutes, is_published, sort_order, video_url, created_at, updated_at) VALUES
(@m2_0, @c2, 'المتغيرات وأنواع البيانات', 'Variables and Data Types', 'المتغيرات وأنواع البيانات', 'video', TRUE, 0, 20, TRUE, 0, NULL, NOW(), NOW()),
(@m2_0, @c2, 'العوامل والتعبيرات', 'Operators and Expressions', 'العوامل والتعبيرات', 'video', TRUE, 1, 25, TRUE, 1, NULL, NOW(), NOW()),
(@m2_0, @c2, 'جمل الشرط', 'Conditional Statements', 'جمل الشرط', 'video', TRUE, 2, 25, TRUE, 2, NULL, NOW(), NOW()),
(@m2_0, @c2, 'الحلقات والتكرار', 'Loops and Iteration', 'الحلقات والتكرار', 'video', FALSE, 3, 30, TRUE, 3, NULL, NOW(), NOW()),
(@m2_1, @c2, 'تعريف الدوال والتعبيرات', 'Function Declarations and Expressions', 'تعريف الدوال والتعبيرات', 'video', TRUE, 0, 25, TRUE, 0, NULL, NOW(), NOW()),
(@m2_1, @c2, 'دوال الأسهم', 'Arrow Functions', 'دوال الأسهم', 'video', FALSE, 1, 20, TRUE, 1, NULL, NOW(), NOW()),
(@m2_1, @c2, 'ال closures والنطاق', 'Closures and Scope', 'ال closures والنطاق', 'video', FALSE, 2, 35, TRUE, 2, NULL, NOW(), NOW()),
(@m2_1, @c2, 'الدوال عالية الرتبة', 'Higher-Order Functions', 'الدوال عالية الرتبة', 'video', FALSE, 3, 35, TRUE, 3, NULL, NOW(), NOW()),
(@m2_2, @c2, 'اختيار وتعديل عناصر DOM', 'Selecting and Manipulating DOM Elements', 'اختيار وتعديل عناصر DOM', 'video', TRUE, 0, 30, TRUE, 0, NULL, NOW(), NOW()),
(@m2_2, @c2, 'التعامل مع الأحداث', 'Event Handling', 'التعامل مع الأحداث', 'video', FALSE, 1, 35, TRUE, 1, NULL, NOW(), NOW()),
(@m2_2, @c2, 'بناء مشروع تفاعلي', 'Building an Interactive Project', 'بناء مشروع تفاعلي', 'video', FALSE, 2, 45, TRUE, 2, NULL, NOW(), NOW());

-- Course 3: React & Next.js
SET @c3 = (SELECT id FROM courses WHERE slug = 'react-nextjs-fullstack' LIMIT 1);

INSERT IGNORE INTO modules (course_id, title, `order`, created_at, updated_at) VALUES
(@c3, 'React Fundamentals', 0, NOW(), NOW()),
(@c3, 'Next.js Core Concepts', 1, NOW(), NOW()),
(@c3, 'Production Deployment', 2, NOW(), NOW());

SET @m3_0 = (SELECT id FROM modules WHERE course_id = @c3 AND `order` = 0 LIMIT 1);
SET @m3_1 = (SELECT id FROM modules WHERE course_id = @c3 AND `order` = 1 LIMIT 1);
SET @m3_2 = (SELECT id FROM modules WHERE course_id = @c3 AND `order` = 2 LIMIT 1);

INSERT IGNORE INTO lessons (module_id, course_id, title, title_en, title_ar, type, is_free, `order`, duration_minutes, is_published, sort_order, video_url, created_at, updated_at) VALUES
(@m3_0, @c3, 'مكونات React و JSX', 'React Components and JSX', 'مكونات React و JSX', 'video', TRUE, 0, 30, TRUE, 0, NULL, NOW(), NOW()),
(@m3_0, @c3, 'الحالة والخصائص', 'State and Props', 'الحالة والخصائص', 'video', TRUE, 1, 35, TRUE, 1, NULL, NOW(), NOW()),
(@m3_0, @c3, 'عمق الـ Hooks', 'Hooks Deep Dive', 'عمق الـ Hooks', 'video', FALSE, 2, 45, TRUE, 2, NULL, NOW(), NOW()),
(@m3_0, @c3, 'React Query لجلب البيانات', 'React Query for Data Fetching', 'React Query لجلب البيانات', 'video', FALSE, 3, 40, TRUE, 3, NULL, NOW(), NOW()),
(@m3_1, @c3, 'App Router والتوجيه بالملفات', 'App Router and File-Based Routing', 'App Router والتوجيه بالملفات', 'video', TRUE, 0, 35, TRUE, 0, NULL, NOW(), NOW()),
(@m3_1, @c3, 'مكونات السيرفر مقابل مكونات العميل', 'Server Components vs Client Components', 'مكونات السيرفر مقابل مكونات العميل', 'video', FALSE, 1, 40, TRUE, 1, NULL, NOW(), NOW()),
(@m3_1, @c3, 'API Routes والبرمجيات الوسيطة', 'API Routes and Middleware', 'API Routes والبرمجيات الوسيطة', 'video', FALSE, 2, 40, TRUE, 2, NULL, NOW(), NOW()),
(@m3_1, @c3, 'المصادقة باستخدام NextAuth', 'Authentication with NextAuth', 'المصادقة باستخدام NextAuth', 'video', FALSE, 3, 45, TRUE, 3, NULL, NOW(), NOW()),
(@m3_2, @c3, 'تكامل قواعد البيانات مع Prisma', 'Database Integration with Prisma', 'تكامل قواعد البيانات مع Prisma', 'video', FALSE, 0, 40, TRUE, 0, NULL, NOW(), NOW()),
(@m3_2, @c3, 'استراتيجيات الاختبار', 'Testing Strategies', 'استراتيجيات الاختبار', 'video', FALSE, 1, 35, TRUE, 1, NULL, NOW(), NOW()),
(@m3_2, @c3, 'النشر على Vercel', 'Deploying to Vercel', 'النشر على Vercel', 'video', FALSE, 2, 30, TRUE, 2, NULL, NOW(), NOW());

-- Course 4: Flutter
SET @c4 = (SELECT id FROM courses WHERE slug = 'mobile-flutter' LIMIT 1);

INSERT IGNORE INTO modules (course_id, title, `order`, created_at, updated_at) VALUES
(@c4, 'Flutter Basics', 0, NOW(), NOW()),
(@c4, 'State Management and Navigation', 1, NOW(), NOW()),
(@c4, 'Publishing', 2, NOW(), NOW());

SET @m4_0 = (SELECT id FROM modules WHERE course_id = @c4 AND `order` = 0 LIMIT 1);
SET @m4_1 = (SELECT id FROM modules WHERE course_id = @c4 AND `order` = 1 LIMIT 1);
SET @m4_2 = (SELECT id FROM modules WHERE course_id = @c4 AND `order` = 2 LIMIT 1);

INSERT IGNORE INTO lessons (module_id, course_id, title, title_en, title_ar, type, is_free, `order`, duration_minutes, is_published, sort_order, video_url, created_at, updated_at) VALUES
(@m4_0, @c4, 'أساسيات لغة Dart', 'Dart Language Fundamentals', 'أساسيات لغة Dart', 'video', TRUE, 0, 30, TRUE, 0, NULL, NOW(), NOW()),
(@m4_0, @c4, 'هيكل مشروع Flutter', 'Flutter Project Structure', 'هيكل مشروع Flutter', 'video', TRUE, 1, 25, TRUE, 1, NULL, NOW(), NOW()),
(@m4_0, @c4, 'الودجات الأساسية', 'Basic Widgets', 'الودجات الأساسية', 'video', TRUE, 2, 35, TRUE, 2, NULL, NOW(), NOW()),
(@m4_0, @c4, 'التخطيطات في Flutter', 'Layouts in Flutter', 'التخطيطات في Flutter', 'video', FALSE, 3, 40, TRUE, 3, NULL, NOW(), NOW()),
(@m4_1, @c4, 'إدارة الحالة مع Riverpod', 'State Management with Riverpod', 'إدارة الحالة مع Riverpod', 'video', TRUE, 0, 40, TRUE, 0, NULL, NOW(), NOW()),
(@m4_1, @c4, 'التنقل والتوجيه', 'Navigation and Routing', 'التنقل والتوجيه', 'video', FALSE, 1, 35, TRUE, 1, NULL, NOW(), NOW()),
(@m4_1, @c4, 'التكامل مع الـ APIs', 'API Integration', 'التكامل مع الـ APIs', 'video', FALSE, 2, 40, TRUE, 2, NULL, NOW(), NOW()),
(@m4_1, @c4, 'التخزين المحلي', 'Local Storage with SharedPreferences', 'التخزين المحلي', 'video', FALSE, 3, 30, TRUE, 3, NULL, NOW(), NOW()),
(@m4_2, @c4, 'الإشعارات', 'Push Notifications', 'الإشعارات', 'video', FALSE, 0, 35, TRUE, 0, NULL, NOW(), NOW()),
(@m4_2, @c4, 'النشر على App Store و Google Play', 'App Store and Google Play Publishing', 'النشر على App Store و Google Play', 'video', FALSE, 1, 40, TRUE, 1, NULL, NOW(), NOW()),
(@m4_2, @c4, 'المشروع التطبيقي النهائي', 'Final Capstone Project', 'المشروع التطبيقي النهائي', 'video', FALSE, 2, 60, TRUE, 2, NULL, NOW(), NOW());

-- ── 6. Create Testimonials ──
INSERT IGNORE INTO testimonials (student_name, student_title, content, rating, is_published, created_at) VALUES
(
  'Mohamed Ali', 'Frontend Developer at Tech Corp',
  'هذه المنصة غيرت مسار حياتي المهنية بالكامل. كورس HTML/CSS كان منظماً بشكل رائع، وانتقلت من لا شيء إلى الحصول على أول وظيفة كمطور في 3 أشهر فقط. المدرس يشرح المفاهيم المعقدة بطريقة بسيطة وعملية جداً.',
  5, TRUE, NOW()
),
(
  'Sara Hassan', 'Full Stack Developer',
  'بوتكامب React و Next.js ممتاز. كنت أعرف أساسيات JavaScript لكن هذا الكورس نقل مهاراتي لمستوى آخر. المشاريع الواقعية كانت قيمة للغاية، والآن أبني تطبيقات إنتاجية بثقة.',
  5, TRUE, NOW()
),
(
  'Omar Khaled', 'Mobile Developer',
  'جربت منصات كثيرة لتعلم Flutter لكن لا شيء يقارن بهذه المنصة. النهج التدريجي، الشرح الواضح بالعربية، والتمارين العملية جعلت التعلم ممتعاً. نشرت أول تطبيق لي على Google Play بعد إتمام هذا الكورس!',
  4, TRUE, NOW()
);

-- ── Verification ──
SELECT 'Seed Complete' AS status;
SELECT CONCAT('Users: ', COUNT(*)) AS info FROM users;
SELECT CONCAT('Categories: ', COUNT(*)) AS info FROM categories;
SELECT CONCAT('Published Courses: ', COUNT(*)) AS info FROM courses WHERE is_published = 1;
SELECT CONCAT('Modules: ', COUNT(*)) AS info FROM modules;
SELECT CONCAT('Lessons: ', COUNT(*)) AS info FROM lessons;
SELECT CONCAT('Testimonials: ', COUNT(*)) AS info FROM testimonials WHERE is_published = 1;
