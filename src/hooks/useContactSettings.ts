import { trpc } from "@/providers/trpc";

export interface ContactSettings {
  whatsappNumber: string;
  phone: string;
  email: string;
  whatsappMessageEn: string;
  whatsappMessageAr: string;
  youtubeUrl: string;
  linkedinUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  twitterUrl: string;
  telegramUrl: string;
  websiteUrl: string;
}

const FALLBACKS: ContactSettings = {
  whatsappNumber: "201061857305",
  phone: "01061857305",
  email: "contact@ahmedelbaz.com",
  whatsappMessageEn: "Hi! I'm interested in your engineering courses. Can you help me?",
  whatsappMessageAr: "مرحباً! أنا مهتم بالكورسات الهندسية. ممكن تساعدني؟",
  // Official social platform links (also seeded into siteSettings on boot —
  // DB values win once present; these keep the icons alive if the query fails).
  youtubeUrl: "https://youtube.com/playlist?list=PLeeb5_Qjhcgc",
  linkedinUrl: "#",
  facebookUrl: "https://www.facebook.com/share/1Cm6U14ihR/",
  instagramUrl: "https://www.instagram.com/ahmedetap1",
  tiktokUrl: "https://www.tiktok.com/@ahmedetap",
  twitterUrl: "",
  telegramUrl: "https://t.me/engahmedetap",
  websiteUrl: "https://ahmedelbaz.qzz.io",
};

export function useContactSettings() {
  const { data, isLoading } = trpc.settings.getSection.useQuery(
    { section: "contact" },
    { enabled: true, staleTime: 1000 * 60 },
  );

  const raw = data as Record<string, string> | undefined;

  const settings: ContactSettings = {
    whatsappNumber: raw?.whatsappNumber ?? FALLBACKS.whatsappNumber,
    phone: raw?.phone ?? FALLBACKS.phone,
    email: raw?.email ?? FALLBACKS.email,
    whatsappMessageEn: raw?.whatsappMessageEn ?? FALLBACKS.whatsappMessageEn,
    whatsappMessageAr: raw?.whatsappMessageAr ?? FALLBACKS.whatsappMessageAr,
    youtubeUrl: raw?.youtubeUrl ?? FALLBACKS.youtubeUrl,
    linkedinUrl: raw?.linkedinUrl ?? FALLBACKS.linkedinUrl,
    facebookUrl: raw?.facebookUrl ?? FALLBACKS.facebookUrl,
    instagramUrl: raw?.instagramUrl ?? FALLBACKS.instagramUrl,
    tiktokUrl: raw?.tiktokUrl ?? FALLBACKS.tiktokUrl,
    twitterUrl: raw?.twitterUrl ?? FALLBACKS.twitterUrl,
    telegramUrl: raw?.telegramUrl ?? FALLBACKS.telegramUrl,
    websiteUrl: raw?.websiteUrl ?? FALLBACKS.websiteUrl,
  };

  return { data: settings, isLoading };
}
