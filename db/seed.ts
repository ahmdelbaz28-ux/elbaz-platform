import { getDb } from "../api/queries/connection";
import {
  categories,
  courses,
  lessons,
  testimonials,
  quizQuestions,
  users,
} from "./schema";
import { hashPassword } from "../api/lib/password";
import { eq } from "drizzle-orm";

async function seed() {
  const db = getDb();

  // ─── Seed admin user ───
  const adminExists = await db.select().from(users).where(eq(users.username, "AHMEDETAP")).limit(1);
  if (adminExists.length === 0) {
    const adminHash = await hashPassword("AHMED123");
    await db.insert(users).values({
      username: "AHMEDETAP",
      passwordHash: adminHash,
      name: "Eng Ahmed Elbaz",
      email: "admin@engahmedelbaz.com",
      role: "admin",
    });
    console.log("Admin user created: AHMEDETAP / AHMED123");
  }

  // ─── Seed demo user ───
  const demoExists = await db.select().from(users).where(eq(users.username, "demo")).limit(1);
  if (demoExists.length === 0) {
    const demoHash = await hashPassword("demo123");
    await db.insert(users).values({
      username: "demo",
      passwordHash: demoHash,
      name: "Demo Student",
      email: "demo@example.com",
      role: "user",
    });
    console.log("Demo user created: demo / demo123");
  }

  // ─── Seed categories ───
  const existingCategories = await db.select().from(categories);
  if (existingCategories.length === 0) {
    await db.insert(categories).values([
      { slug: "electrical-networks", nameEn: "Electrical Networks", nameAr: "الشبكات الكهربية", icon: "Zap", sortOrder: 1 },
      { slug: "electrical-design", nameEn: "Electrical Design", nameAr: "التصاميم الكهربية", icon: "CircuitBoard", sortOrder: 2 },
      { slug: "engineering-software", nameEn: "Engineering Software", nameAr: "البرامج الهندسية", icon: "Cpu", sortOrder: 3 },
      { slug: "certification-prep", nameEn: "Certification Prep", nameAr: "التحضير للشهادات", icon: "FileCheck", sortOrder: 4 },
    ]);
    console.log("Categories seeded");
  }

  // ─── Seed courses ───
  const existingCourses = await db.select().from(courses);
  if (existingCourses.length === 0) {
    await db.insert(courses).values([
      {
        slug: "etap-complete-course",
        categoryId: 3,
        titleEn: "ETAP Complete Course — Power System Analysis & Design",
        titleAr: "ETAP — تحليل وتصميم منظومات القدرة",
        shortDescEn: "Master ETAP for load flow, short circuit, arc flash, and protection coordination studies.",
        shortDescAr: "أتقن ETAP لدراسات تدفق الحمل والدائرة القصيرة ومتابعة الحماية.",
        descriptionEn: "Comprehensive ETAP training covering power system modeling, load flow analysis, short circuit calculations, arc flash studies, motor starting, and protection coordination. This course is designed for electrical engineers working in power system design and analysis.",
        descriptionAr: "تدريب شامل على ETAP يغطي نمذجة منظومات القدرة وتحليل تدفق الحمل وحسابات الدائرة القصيرة ودراسات ومضات القوس الكهربي وبدء المحركات وتنسيق الحماية.",
        thumbnail: "/course-etap.jpg",
        level: "intermediate",
        isPremium: true,
        price: "49.00",
        originalPrice: "99.00",
        durationHours: 42,
        rating: "4.9",
        reviewCount: 180,
        studentCount: 2400,
        isFeatured: true,
        isPublished: true,
        learningOutcomesEn: ["Build complete power system models in ETAP", "Perform load flow and short circuit studies", "Design protection coordination schemes", "Generate arc flash reports"],
        learningOutcomesAr: ["بناء نماذج كاملة لمنظومات القدرة في ETAP", "إجراء دراسات تدفق الحمل والدائرة القصيرة", "تصميم مخططات تنسيق الحماية", "إنشاء تقارير ومضات القوس الكهربي"],
      },
      {
        slug: "advanced-cable-sizing",
        categoryId: 2,
        titleEn: "Advanced Cable Sizing & Voltage Drop Calculations",
        titleAr: "تحديد حجم الكابلات المتقدم وهبوط الجهد",
        shortDescEn: "Learn industry-standard methods for cable sizing, derating, and voltage drop analysis.",
        shortDescAr: "تعلم الطرق القياسية لتحديد حجم الكابلات والتصنيف وهبوط الجهد.",
        descriptionEn: "Deep dive into cable sizing methodologies per IEC and NEC standards. Covers ampacity calculations, correction factors, voltage drop analysis, and short-circuit withstand ratings.",
        descriptionAr: "غوص عميق في منهجيات تحديد حجم الكابلات حسب معايير IEC وNEC.",
        thumbnail: "/course-cable.jpg",
        level: "intermediate",
        isPremium: false,
        price: "0.00",
        originalPrice: "0.00",
        durationHours: 18,
        rating: "4.8",
        reviewCount: 95,
        studentCount: 1500,
        isFeatured: true,
        isPublished: true,
        learningOutcomesEn: ["Size cables per IEC 60364 and NEC Article 310", "Calculate voltage drop for 3-phase and 1-phase systems", "Apply derating factors for grouping and temperature", "Select cables for short-circuit withstand"],
        learningOutcomesAr: ["تحديد حجم الكابلات حسب IEC 60364 وNEC", "حساب هبوط الجهد لأنظمة 3 و1 فاز", "تطبيق عوامل التصنيف", "اختيار كابلات مقاومة الدائرة القصيرة"],
      },
      {
        slug: "skm-protection-coordination",
        categoryId: 3,
        titleEn: "SKM PowerTools for Protection Coordination",
        titleAr: "SKM PowerTools لتنسيق الحماية",
        shortDescEn: "Master SKM Dapper and CAPTOR for protection studies and TCC curve plotting.",
        shortDescAr: "أتقن SKM Dapper وCAPTOR لدراسات الحماية ومنحنيات TCC.",
        descriptionEn: "Complete SKM PowerTools training for protection engineers. Build TCC curves, perform time-current coordination, set relay parameters, and validate protection schemes.",
        descriptionAr: "تدريب كامل على SKM PowerTools لمهندسي الحماية.",
        thumbnail: "/course-skm.jpg",
        level: "advanced",
        isPremium: true,
        price: "59.00",
        originalPrice: "119.00",
        durationHours: 28,
        rating: "4.9",
        reviewCount: 124,
        studentCount: 980,
        isFeatured: true,
        isPublished: true,
        learningOutcomesEn: ["Build TCC curves in SKM CAPTOR", "Perform time-current coordination studies", "Set relay pickup and time dial settings", "Validate protection for motor, transformer, and feeder circuits"],
        learningOutcomesAr: ["بناء منحنيات TCC في SKM", "إجراء دراسات التنسيق الزمني", "ضبط إعدادات الريلاي", "التحقق من حماية المحركات والمحولات"],
      },
      {
        slug: "pvsyst-solar-design",
        categoryId: 1,
        titleEn: "PVSyst — Solar PV System Design Masterclass",
        titleAr: "PVSyst — تصميم أنظمة الطاقة الشمسية",
        shortDescEn: "From site survey to performance ratio — design complete solar PV systems in PVSyst.",
        shortDescAr: "من المسح الميداني إلى نسبة الأداء — تصميم أنظمة شمسية كاملة في PVSyst.",
        descriptionEn: "Comprehensive PVSyst training covering meteorological data analysis, 3D shading simulation, system sizing, electrical design, loss diagram analysis, and production forecasting.",
        descriptionAr: "تدريب شامل على PVSyst يغطي تحليل البيانات الجوية والمحاكاة ثلاثية الأبعاد وتصميم الأنظمة.",
        thumbnail: "/course-pvsyst.jpg",
        level: "intermediate",
        isPremium: true,
        price: "45.00",
        originalPrice: "89.00",
        durationHours: 22,
        rating: "4.7",
        reviewCount: 210,
        studentCount: 1800,
        isFeatured: true,
        isPublished: true,
        learningOutcomesEn: ["Analyze meteorological data for solar projects", "Perform 3D shading analysis", "Size PV arrays and inverters", "Generate yield forecasts and PR analysis"],
        learningOutcomesAr: ["تحليل البيانات الجوية لمشاريع الطاقة الشمسية", "إجراء تحليل الظل ثلاثي الأبعاد", "تحديد حجم المصفوفات والمحولات", "إنشاء توقعات الإنتاج وتحليل PR"],
      },
      {
        slug: "powerfactory-loadflow",
        categoryId: 3,
        titleEn: "PowerFactory — Load Flow & Short Circuit",
        titleAr: "PowerFactory — تدفق الحمل والدائرة القصيرة",
        shortDescEn: "Learn DIgSILENT PowerFactory for transmission and distribution system studies.",
        shortDescAr: "تعلم DIgSILENT PowerFactory لدراسات أنظمة النقل والتوزيع.",
        descriptionEn: "Hands-on PowerFactory training for load flow, short circuit, and stability analysis. Covers DSL modeling, RMS simulation, and integration with renewable energy sources.",
        descriptionAr: "تدريب عملي على PowerFactory لتدفق الحمل والدائرة القصيرة.",
        thumbnail: "/course-powerfactory.jpg",
        level: "advanced",
        isPremium: false,
        price: "0.00",
        originalPrice: "0.00",
        durationHours: 16,
        rating: "4.8",
        reviewCount: 67,
        studentCount: 750,
        isFeatured: false,
        isPublished: true,
        learningOutcomesEn: ["Build network models in PowerFactory", "Run load flow and short circuit simulations", "Model renewable energy sources", "Perform stability analysis"],
        learningOutcomesAr: ["بناء نماذج الشبكة في PowerFactory", "تشغيل محاكاة تدفق الحمل والدائرة القصيرة", "نمذجة مصادر الطاقة المتجددة", "إجراء تحليل الاستقرارية"],
      },
      {
        slug: "electrical-panel-design",
        categoryId: 2,
        titleEn: "Electrical Panel Design with AutoCAD",
        titleAr: "تصميم لوحات التوزيع الكهربية باستخدام AutoCAD",
        shortDescEn: "Design LV/MV electrical panels, MCCs, and switchboards from scratch.",
        shortDescAr: "تصميم لوحات الجهد المنخفض/المتوسط ولوحات MCC من الصفر.",
        descriptionEn: "Step-by-step electrical panel design training. Learn busbar sizing, breaker selection, layout optimization, wiring diagrams, and BOM generation using AutoCAD Electrical and EPLAN.",
        descriptionAr: "تدريب تصميم لوحات كهربية خطوة بخطوة.",
        thumbnail: "/course-panel.jpg",
        level: "intermediate",
        isPremium: true,
        price: "39.00",
        originalPrice: "79.00",
        durationHours: 14,
        rating: "4.9",
        reviewCount: 143,
        studentCount: 1200,
        isFeatured: true,
        isPublished: true,
        learningOutcomesEn: ["Design LV/MV switchboards per IEC 61439", "Size busbars and select breakers", "Create wiring and single-line diagrams", "Generate BOM and panel schedules"],
        learningOutcomesAr: ["تصميم لوحات الجهد المنخفض/المتوسط حسب IEC 61439", "تحديد حجم القضبان واختيار القواطع", "إنشاء مخططات الأسلاك", "توليد BOM وجداول اللوحات"],
      },
    ]);
    console.log("Courses seeded");
  }

  // ─── Seed lessons for ETAP course ───
  const existingLessons = await db.select().from(lessons);
  if (existingLessons.length === 0) {
    await db.insert(lessons).values([
      { courseId: 1, titleEn: "Introduction to ETAP Interface", titleAr: "مقدمة لواجهة ETAP", durationMinutes: 25, sortOrder: 1, isFree: true },
      { courseId: 1, titleEn: "Creating One-Line Diagrams", titleAr: "إنشاء المخططات أحادية الخط", durationMinutes: 45, sortOrder: 2 },
      { courseId: 1, titleEn: "Load Flow Analysis Basics", titleAr: "أساسيات تحليل تدفق الحمل", durationMinutes: 55, sortOrder: 3 },
      { courseId: 1, titleEn: "Short Circuit Calculations", titleAr: "حسابات الدائرة القصيرة", durationMinutes: 60, sortOrder: 4 },
      { courseId: 1, titleEn: "Protection Device Coordination", titleAr: "تنسيق أجهزة الحماية", durationMinutes: 50, sortOrder: 5 },
      { courseId: 1, titleEn: "Arc Flash Analysis", titleAr: "تحليل ومضات القوس الكهربي", durationMinutes: 40, sortOrder: 6 },
      { courseId: 1, titleEn: "Motor Starting Study", titleAr: "دراسة بدء المحركات", durationMinutes: 35, sortOrder: 7 },
      { courseId: 1, titleEn: "Project Report Generation", titleAr: "إنشاء تقارير المشاريع", durationMinutes: 30, sortOrder: 8, isFree: true },
    ]);
    console.log("Lessons seeded");
  }

  // ─── Seed quiz questions ───
  const existingQuestions = await db.select().from(quizQuestions);
  if (existingQuestions.length === 0) {
    await db.insert(quizQuestions).values([
      {
        lessonId: 1,
        questionEn: "What is the first step when creating a new project in ETAP?",
        questionAr: "ما هي الخطوة الأولى عند إنشاء مشروع جديد في ETAP؟",
        optionsEn: ["Draw the one-line diagram", "Configure project settings and base values", "Run load flow analysis", "Add protection devices"],
        optionsAr: ["رسم المخطط أحادي الخط", "تهيئة إعدادات المشروع والقيم الأساسية", "تشغيل تحليل تدفق الحمل", "إضافة أجهزة الحماية"],
        correctOptionIndex: 1,
        explanationEn: "Before drawing, you must set the project base values (kV, MVA) and frequency.",
        explanationAr: "قبل الرسم، يجب ضبط القيم الأساسية للمشروع (kV, MVA) والتردد.",
      },
      {
        lessonId: 1,
        questionEn: "Which ETAP module is used for short circuit calculations?",
        questionAr: "أي وحدة في ETAP تُستخدم لحسابات الدائرة القصيرة؟",
        optionsEn: ["Load Flow", "Short Circuit", "Arc Flash", "Harmonic Analysis"],
        optionsAr: ["تدفق الحمل", "الدائرة القصيرة", "ومضات القوس", "تحليل التوافقيات"],
        correctOptionIndex: 1,
        explanationEn: "The Short Circuit module calculates fault currents for different fault types.",
        explanationAr: "وحدة الدائرة القصيرة تحسب تيارات العطل لأنواع مختلفة من الأعطال.",
      },
      {
        lessonId: 2,
        questionEn: "What symbol represents a transformer in a one-line diagram?",
        questionAr: "ما هو الرمز الذي يمثل المحول في المخطط أحادي الخط؟",
        optionsEn: ["Circle with 'G' inside", "Two overlapping circles", "Rectangle with diagonal lines", "Triangle pointing up"],
        optionsAr: ["دائرة بها G داخلها", "دائرتان متداخلتان", "مستطيل بخطوط قطرية", "مثلث يشير لأعلى"],
        correctOptionIndex: 1,
        explanationEn: "Transformers are represented by two overlapping circles in one-line diagrams.",
        explanationAr: "تمثل المحولات بدائرتين متداخلتين في المخططات أحادية الخط.",
      },
    ]);
    console.log("Quiz questions seeded");
  }

  // ─── Seed testimonials ───
  const existingTestimonials = await db.select().from(testimonials);
  if (existingTestimonials.length === 0) {
    await db.insert(testimonials).values([
      {
        name: "Mohamed Khaled",
        title: "Protection Engineer",
        company: "EEHC",
        content: "The ETAP course completely changed how I approach power system studies. Ahmed explains complex short-circuit calculations in a way that finally made sense. Worth every penny.",
        rating: 5,
      },
      {
        name: "Sara El-Naggar",
        title: "Renewable Energy Consultant",
        company: "Green Power Co.",
        content: "I went from knowing nothing about PVSyst to designing a 5MW solar farm in 3 weeks. The quiz after each section really cemented the concepts.",
        rating: 5,
      },
      {
        name: "Ahmed Hassan",
        title: "MEP Design Engineer",
        company: "Al-Futtaim Engineering",
        content: "The video protection system gave me confidence to enroll. I know my subscription supports real content creation, not piracy. The cable sizing modules are unmatched.",
        rating: 5,
      },
    ]);
    console.log("Testimonials seeded");
  }

  console.log("Seed completed!");
}

seed().catch(console.error);
