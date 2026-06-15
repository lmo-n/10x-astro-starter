import { useState } from "react";
import type { DeckDto, DeckLimitsDto } from "@/types";
import { useCreateDeck } from "@/components/hooks/useCreateDeck";

interface Props {
  /** When true, the empty state is the result of a search with no matches. */
  isSearchResult: boolean;
  /** Current search term (used to render the "no matches" message). */
  searchTerm?: string;
  /** Called after a deck is created so the parent can update its list/limits. */
  onCreated: (deck: DeckDto, limits: DeckLimitsDto) => void;
}

/**
 * Empty-state card shown when the deck list is empty. For a non-search empty
 * state it also owns the "create your first deck" flow (POST /api/decks),
 * notifying the parent via {@link Props.onCreated} on success.
 */
export default function DeckEmptyState({ isSearchResult, searchTerm, onCreated }: Props) {
  const [newName, setNewName] = useState("");
  const { creating, error: createError, create } = useCreateDeck(onCreated);

  /** Create a deck, clearing the input on success. */
  async function handleCreate() {
    const ok = await create(newName);
    if (ok) setNewName("");
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 py-16 text-center backdrop-blur">
      <p className="text-lg font-medium text-blue-100/60">
        {isSearchResult ? `No decks matching "${searchTerm}"` : "No decks yet"}
      </p>
      <p className="mt-1 text-sm text-blue-100/40">
        {isSearchResult ? "Try a different search term." : "Create your first deck to get started."}
      </p>
      {!isSearchResult && (
        <div className="mx-auto mt-6 flex max-w-sm flex-col items-center gap-2">
          <div className="flex w-full items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              maxLength={100}
              disabled={creating}
              placeholder="Deck name…"
              className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:ring-2 focus:ring-blue-400/50 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="cursor-pointer rounded-lg bg-blue-500/30 px-4 py-2 text-sm whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-500/50 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create deck"}
            </button>
          </div>
          {createError && <p className="text-xs text-red-400">{createError}</p>}
        </div>
      )}
    </div>
  );
}
