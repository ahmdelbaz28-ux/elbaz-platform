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
  websiteUrl: string;
}

const FALLBACKS: ContactSettings = {
  whatsappNumber: "201061857305",
  phone: "01061857305",
  email: "contact@ahmedelbaz.com",
  whatsappMessageEn: "Hi! I'm interested in your engineering courses. Can you help me?",
  whatsappMessageAr: "مرحباً! أنا مهتم بالكورسات الهندسية. ممكن تساعدني؟",
  youtubeUrl: "#",
  linkedinUrl: "#",
  facebookUrl: "#",
  instagramUrl: "#",
  tiktokUrl: "",
  twitterUrl: "",
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
    websiteUrl: raw?.websiteUrl ?? FALLBACKS.websiteUrl,
  };

  return { data: settings, isLoading };
}
