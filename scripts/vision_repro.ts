/**
 * Local PASS-1 vision repro — calls readImageViaVisionModels directly with a
 * real image and the real Kilo gateway (KILOCODE_API_KEY from env).
 * Surfaces every [Chatbot/Vision] + [AiRouter] log line to pinpoint which
 * reader stage fails in production (honesty-note path).
 */
import fs from "node:fs";
import { readImageViaVisionModels } from "../api/lib/chatbot-vision.js";
import type { ChatApiMessage } from "../api/lib/chatbot.js";

const imgPath = new URL("../public/etap-category.jpg", import.meta.url);
const img = fs.readFileSync(imgPath);
const dataurl = `data:image/jpeg;base64,${img.toString("base64")}`;
console.log(`image b64 chars=${dataurl.length}`);

const messages: ChatApiMessage[] = [
  {
    role: "user",
    content: [
      { type: "text", text: "ما الذي تظهره هذه الصورة؟ اذكر نوع البرنامج الظاهر فيها بإيجاز" },
      { type: "image_url", image_url: { url: dataurl } },
    ],
  },
];

const t0 = Date.now();
const r = await readImageViaVisionModels(messages, "ar");
console.log("=== PASS-1 RESULT ===");
console.log(
  JSON.stringify(
    {
      ok: r.ok,
      visionModel: r.visionModel ?? null,
      descLen: r.description?.length ?? 0,
      head: (r.description ?? "").slice(0, 200),
    },
    null,
    2,
  ),
);
console.log("elapsed:", Date.now() - t0, "ms");
