-- Migration: Add contact section to siteSettings
-- This seeds the default contact information that can be managed from the admin dashboard.
-- All contact info across the site (WhatsApp button, footer social links, etc.) reads from these settings.

INSERT INTO siteSettings (section, `key`, value, type, sortOrder) VALUES
('contact', 'whatsappNumber', '201061857305', 'text', 1),
('contact', 'phone', '01061857305', 'text', 2),
('contact', 'email', 'contact@ahmedelbaz.com', 'text', 3),
('contact', 'whatsappMessageEn', 'Hi! I''m interested in your engineering courses. Can you help me?', 'text', 4),
('contact', 'whatsappMessageAr', 'مرحباً! أنا مهتم بالكورسات الهندسية. ممكن تساعدني؟', 'text', 5),
('contact', 'youtubeUrl', '#', 'url', 10),
('contact', 'linkedinUrl', '#', 'url', 11),
('contact', 'facebookUrl', '#', 'url', 12),
('contact', 'instagramUrl', '#', 'url', 13),
('contact', 'tiktokUrl', '', 'url', 14),
('contact', 'twitterUrl', '', 'url', 15),
('contact', 'websiteUrl', 'https://ahmedelbaz.qzz.io', 'url', 16)
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
