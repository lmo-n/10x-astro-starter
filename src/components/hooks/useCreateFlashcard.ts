import { useState } from "react";
import type { CreateFlashcardResponseDto, FlashcardDto } from "@/types";

/** Client-side mirror of the server text limits (see `validation/flashcards.ts`). */
export const FRONT_TEXT_MAX_LENGTH = 500;
export const BACK_TEXT_MAX_LENGTH = 3000;

/** Conservative HTML-like markup detector, mirrors the server validation. */
const HTML_LIKE_PATTERN = /<\/?[a-z][\s\S]*?>/i;

/** Maximum sentence-ending punctuation marks allowed in `frontText`. */
const MAX_FRONT_SENTENCE_TERMINATORS = 2;

/**
 * Validate the front/back text the same way the API does, so the user gets
 * instant feedback before a request is sent. Returns an error message or `null`.
 */
function validate(frontText: string, backText: string): string | null {
  if (!frontText) return "Front text must not be empty.";
  if (frontText.length > FRONT_TEXT_MAX_LENGTH) {
    return `Front text must be at most ${FRONT_TEXT_MAX_LENGTH} characters.`;
  }
  if (HTML_LIKE_PATTERN.test(frontText)) {
    return "Front text must be plain text and must not contain HTML markup.";
  }
  const terminators = frontText.match(/[.?!]/g);
  if ((terminators?.length ?? 0) > MAX_FRONT_SENTENCE_TERMINATORS) {
    return "Front text should be a short question (at most two sentences).";
  }
  if (!backText) return "Back text must not be empty.";
  if (backText.length > BACK_TEXT_MAX_LENGTH) {
    return `Back text must be at most ${BACK_TEXT_MAX_LENGTH} characters.`;
  }
  if (HTML_LIKE_PATTERN.test(backText)) {
    return "Back text must be plain text and must not contain HTML markup.";
  }
  return null;
}

/**
 * Encapsulates the "add a manual flashcard" flow (client-side validation + POST
 * `/api/decks/{deckId}/flashcards`). Mirrors the `useCreateDeck` pattern so the
 * network/validation logic lives in a single place.
 *
 * @param deckId    The deck that will receive the new flashcard.
 * @param onCreated Called with the created flashcard on success.
 */
export function useCreateFlashcard(deckId: string, onCreated: (flashcard: FlashcardDto) => void) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Validate and create a flashcard. Returns `true` on success so callers can
   * reset their inputs.
   */
  async function create(frontText: string, backText: string): Promise<boolean> {
    const trimmedFront = frontText.trim();
    const trimmedBack = backText.trim();

    const validationError = validate(trimmedFront, trimmedBack);
    if (validationError) {
      setError(validationError);
      return false;
    }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch(`/api/decks/${deckId}/flashcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontText: trimmedFront, backText: trimmedBack }),
      });

      if (!res.ok) {
        const body: { error?: { message?: string } } = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message ?? "Failed to add flashcard.");
        return false;
      }

      const result = (await res.json()) as CreateFlashcardResponseDto;
      onCreated(result.flashcard);
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setCreating(false);
    }
  }

  return { creating, error, setError, create };
}
