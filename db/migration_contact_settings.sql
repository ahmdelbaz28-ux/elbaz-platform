-- Migration: Add contact section to siteSettings
-- This seeds the default contact information that can be managed from the admin dashboard.
-- All contact info across the site (WhatsApp button, footer social links, etc.) reads from these settings.

-- Reusable section literal (SonarCloud plsql:S1192 — define a constant
-- instead of duplicating 'contact' across all 12 rows below).
SET @contact_section = 'contact';

INSERT INTO siteSettings (section, `key`, value, type, sortOrder) VALUES
(@contact_section, 'whatsappNumber', '201061857305', 'text', 1),
(@contact_section, 'phone', '01061857305', 'text', 2),
(@contact_section, 'email', 'contact@ahmedelbaz.com', 'text', 3),
(@contact_section, 'whatsappMessageEn', 'Hi! I''m interested in your engineering courses. Can you help me?', 'text', 4),
(@contact_section, 'whatsappMessageAr', 'مرحباً! أنا مهتم بالكورسات الهندسية. ممكن تساعدني؟', 'text', 5),
(@contact_section, 'youtubeUrl', '#', 'url', 10),
(@contact_section, 'linkedinUrl', '#', 'url', 11),
(@contact_section, 'facebookUrl', '#', 'url', 12),
(@contact_section, 'instagramUrl', '#', 'url', 13),
(@contact_section, 'tiktokUrl', '', 'url', 14),
(@contact_section, 'twitterUrl', '', 'url', 15),
(@contact_section, 'websiteUrl', 'https://ahmedelbaz.qzz.io', 'url', 16)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
