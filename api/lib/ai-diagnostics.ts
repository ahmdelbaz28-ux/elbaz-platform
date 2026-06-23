import { env } from "./env.js";

/**
 * 🧠 Elite AI Diagnostics v1
 * ══════════════════════════
 * Automatically analyzes server errors using AI and provides actionable repair advice.
 * This is the ultimate "Elite" tool for zero-downtime maintenance.
 */
export async function diagnoseError(error: Error | string, context: string = "Server Runtime") {
  if (!env.OPENROUTER_API_KEY || env.NODE_ENV !== "production") {
    console.log("[AI-Diagnostics] Skipped (API Key missing or Dev mode)");
    return null;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.FRONTEND_URL,
        "X-Title": "Elbaz Platform AI Guardian",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content: "You are an Elite DevSecOps Engineer. Analyze the provided error from a Hono/Node.js app on HuggingFace Spaces. Provide a concise (max 3 bullet points) diagnostic and the exact fix for Eng. Ahmed Elbaz."
          },
          {
            role: "user",
            content: `Context: ${context}\nError: ${errorMessage}\nStack: ${errorStack}`
          }
        ]
      })
    });

    const data: any = await response.json();
    const diagnosis = data.choices?.[0]?.message?.content || "Could not generate AI diagnosis.";
    
    console.log("\n" + "═".repeat(60));
    console.log("🧠 [AI REPAIR ADVISOR] Analysis Complete:");
    console.log(diagnosis);
    console.log("═".repeat(60) + "\n");

    return diagnosis;
  } catch (err) {
    console.warn("[AI-Diagnostics] Failed to communicate with OpenRouter:", err);
    return null;
  }
}
