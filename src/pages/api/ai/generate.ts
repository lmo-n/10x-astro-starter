import type { APIRoute } from "astro";
import { z } from "zod";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { generateFlashcardsSchema } from "@/lib/validation/ai";
import type { AiProposalCardDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT = `You are an expert educational flashcard creator. Generate high-quality flashcards from the provided study text.

Flashcard rules:
- front_text: A clear, concise question or prompt. Plain text only (no HTML or markdown). Maximum 2 sentences, maximum 500 characters.
- back_text: A complete, accurate answer. Plain text only (no HTML or markdown). Maximum 3000 characters.

Generate between 5 and 25 flashcards that cover the key concepts, facts, and relationships in the text.

Respond ONLY with valid JSON in this exact format:
{"cards": [{"front_text": "...", "back_text": "..."}, ...]}`;

function buildUserMessage(sourceText: string, instructions: string | undefined, language: string): string {
  const langInstruction =
    language === "auto"
      ? "Use the same language as the source text."
      : language === "pl"
        ? "Generate all flashcard content in Polish."
        : "Generate all flashcard content in English.";

  return [
    `Source text:\n${sourceText}`,
    instructions ? `Additional instructions: ${instructions}` : "",
    langInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseCards(rawJson: string): AiProposalCardDto[] {
  const parsed = JSON.parse(rawJson) as { cards?: unknown[] };
  if (!Array.isArray(parsed.cards)) {
    throw new Error("Invalid response format from AI: missing 'cards' array.");
  }
  return parsed.cards.map((c) => {
    const card = c as Record<string, unknown>;
    return {
      frontText: String(card.front_text ?? "").slice(0, 500),
      backText: String(card.back_text ?? "").slice(0, 3000),
    };
  });
}

async function generateWithOpenRouter(
  sourceText: string,
  instructions: string | undefined,
  language: string,
  model: string,
  apiKey: string,
): Promise<AiProposalCardDto[]> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://10x-flashcards.app",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(sourceText, instructions, language) },
      ],
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `OpenRouter API error: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter.");

  return parseCards(content);
}

/**
 * POST /api/ai/generate — server-side proxy for AI flashcard generation.
 *
 * Validates input, forwards to OpenAI or Anthropic depending on the requested
 * model, and returns the proposed `{front_text, back_text}` cards.
 * The source text and instructions are NEVER persisted.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to generate flashcards.");
  }

  if (!isSameOrigin(context.request)) {
    return jsonError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed.");
  }

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = generateFlashcardsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "Invalid generation parameters.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  const { sourceText, instructions, language, model } = parsed.data;

  try {
    if (!OPENROUTER_API_KEY) {
      return jsonError(503, "AI_NOT_CONFIGURED", "OpenRouter API key is not configured on this server.");
    }

    const cards = await generateWithOpenRouter(sourceText, instructions, language, model, OPENROUTER_API_KEY);

    return jsonOk({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI generation failed.";
    return jsonError(502, "AI_GENERATION_FAILED", message);
  }
};
