-- Migration Step 11: Add Composite Indexes for Performance
-- These indexes optimize common admin queries and payment expiry cleanup.

-- Composite index for payments: user + status (used in admin payment listing by user)
ALTER TABLE payments ADD INDEX idx_payments_user_status (userId, status);

-- Composite index for payments: status + expiresAt (used in expireOldPayments cleanup)
ALTER TABLE payments ADD INDEX idx_payments_pending_expires (status, expiresAt);

-- Composite index for support tickets: user + status (used in admin ticket listing)
ALTER TABLE supportTickets ADD INDEX idx_tickets_user_status (userId, status);
