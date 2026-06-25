import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { approveAiFlashcardsSchema } from "@/lib/validation/ai";
import { toFlashcardDto } from "@/lib/services/flashcard.service";
import type { FlashcardDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/** Columns selected from `flashcards` to build a FlashcardDto. */
const FLASHCARD_COLUMNS =
  "id, user_id, deck_id, front_text, back_text, created_by_ai, sm2_interval, sm2_repetition, sm2_ease_factor, due_at, last_reviewed_at, created_at, updated_at";

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * POST /api/ai/approve — atomically save approved AI-generated flashcards.
 *
 * Delegates to the `approve_ai_generated_flashcards` database function which:
 *  - Verifies deck ownership (RLS + explicit check).
 *  - Validates and deducts AI credits from `users_profiles`.
 *  - Inserts flashcards with `created_by_ai = true`.
 *  - Logs the generation event in `ai_generation_logs`.
 *
 * After the RPC, queries the newly inserted rows to return them as DTOs.
 */
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to approve flashcards.");
  }

  if (!isSameOrigin(context.request)) {
    return jsonError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed.");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = approveAiFlashcardsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "Invalid approval data.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  const { deckId, proposedCardsCount, model, cards } = parsed.data;

  // Record timestamp before the RPC so we can retrieve the inserted rows afterwards.
  const beforeApprove = new Date().toISOString();

  // Call the DB function — atomically inserts cards, logs the event, deducts credits.
  const { error: rpcError } = await supabase.rpc("approve_ai_generated_flashcards", {
    p_deck_id: deckId,
    p_cards: cards.map((c) => ({ front_text: c.frontText, back_text: c.backText })),
    p_proposed_count: proposedCardsCount,
    p_model: model,
  });

  if (rpcError) {
    const msg = rpcError.message ?? "";
    if (msg.includes("Insufficient AI credits")) {
      return jsonError(403, "INSUFFICIENT_CREDITS", "You have used all your AI credits for this period.");
    }
    if (msg.includes("Deck not found")) {
      return jsonError(404, "DECK_NOT_FOUND", "Deck not found or access denied.");
    }
    return jsonError(500, "APPROVE_FAILED", msg || "Failed to save flashcards.");
  }

  // Retrieve the rows that were just inserted (created_at >= beforeApprove).
  const { data: savedRows, error: fetchError } = await supabase
    .from("flashcards")
    .select(FLASHCARD_COLUMNS)
    .eq("deck_id", deckId)
    .eq("user_id", user.id)
    .eq("created_by_ai", true)
    .gte("created_at", beforeApprove)
    .order("created_at", { ascending: true });

  if (fetchError) {
    // RPC succeeded — cards are saved; just can't return them.
    return jsonOk({ savedCards: [] as FlashcardDto[] });
  }

  const savedCards = (savedRows ?? []).map(toFlashcardDto);
  return jsonOk({ savedCards });
};
