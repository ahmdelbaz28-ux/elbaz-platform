/**
 * ADMIN CHATBOT — feedback review procedures (tRPC)
 *
 *   chatbotFeedback — review feed + up/down stats for the admin "Chatbot" tab.
 *                     Worst conversations (👎) become test fixtures for the
 *                     next prompt iteration of the evolution loop.
 */
import { z } from "zod";
import { adminQuery } from "./middleware";
import { listChatbotFeedback, getChatbotFeedbackStats } from "./lib/chatbot-feedback.js";

export const adminChatbotProcedures = {
  chatbotFeedback: adminQuery
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        rating: z.enum(["up", "down", "all"]).default("all"),
      })
    )
    .query(async ({ input }) => {
      const [items, stats] = await Promise.all([
        listChatbotFeedback({ limit: input.limit, rating: input.rating === "all" ? undefined : input.rating }),
        getChatbotFeedbackStats(),
      ]);
      return { items, stats };
    }),
};
