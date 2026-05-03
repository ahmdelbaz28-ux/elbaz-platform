const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = "google/gemma-2-9b-it:free";

const SYSTEM_PROMPT = "You are an expert electrical engineer. Answer only electrical engineering questions. Be concise and accurate.";

export async function getChatResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
}): Promise<{ success: boolean; reply?: string; error?: string }> {
  if (!OPENROUTER_API_KEY) {
    return { success: false, error: "API key not configured" };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...request.messages.map(m => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "No response.";
    return { success: true, reply };
  } catch (err: any) {
    return { success: false, error: "Service unavailable" };
  }
}