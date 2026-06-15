import { useState } from "react";
import type { CreateDeckResponseDto, DeckDto, DeckLimitsDto } from "@/types";

/**
 * Encapsulates the "create a deck" flow (client-side validation + POST
 * /api/decks). Shared by the empty state and the toolbar "New deck" button so
 * the network/validation logic lives in a single place.
 *
 * @param onCreated Called with the new deck and refreshed limits on success.
 */
export function useCreateDeck(onCreated: (deck: DeckDto, limits: DeckLimitsDto) => void) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Validate and create a deck. Returns `true` on success so callers can close
   * inline forms or reset inputs.
   */
  async function create(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Deck name must not be empty.");
      return false;
    }
    if (trimmed.length > 100) {
      setError("Deck name must be at most 100 characters.");
      return false;
    }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const body: { error?: { message?: string } } = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message ?? "Failed to create deck.");
        return false;
      }

      const result = (await res.json()) as CreateDeckResponseDto;
      onCreated(result.deck, result.limits);
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
