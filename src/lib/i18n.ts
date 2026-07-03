/**
 * Bilingual string helpers.
 *
 * Many UI strings in this project are defined inline as Arabic/English
 * pairs and picked at runtime based on the current language. The naive
 * form is a nested ternary (flagged by SonarCloud S3358), so we route
 * through the helpers below instead.
 *
 * Before:  condition ? (isRTL ? AR1 : EN1) : (isRTL ? AR2 : EN2)
 * After:   condition ? bilingual(AR1, EN1, isRTL) : bilingual(AR2, EN2, isRTL)
 *
 * Each call is a single-level ternary (no nesting) and the intent is
 * clearer. The function is tiny and inlined by the JIT.
 */

/**
 * Return the Arabic string when `isRTL` is true, the English string
 * otherwise. Drop-in replacement for `isRTL ? ar : en`.
 */
export function bilingual(ar: string, en: string, isRTL: boolean): string {
  return isRTL ? ar : en;
}

/**
 * Return the Arabic string when `lang === "ar"`, the English string
 * otherwise. Equivalent to {@link bilingual} but takes the full language
 * code instead of a boolean — useful when the caller already has `lang`
 * in scope and doesn't want to compute `isRTL`.
 */
export function bilingualByLang(ar: string, en: string, lang: string): string {
  return lang === "ar" ? ar : en;
}
