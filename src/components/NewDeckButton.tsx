import { useState } from "react";
import type { DeckDto, DeckLimitsDto } from "@/types";
import { useCreateDeck } from "@/components/hooks/useCreateDeck";

interface Props {
  /** Whether the user is below their deck quota. */
  canCreate: boolean;
  /** Called after a deck is created so the parent can update its list/limits. */
  onCreated: (deck: DeckDto, limits: DeckLimitsDto) => void;
}

/**
 * Toolbar control for creating a deck when the list is non-empty. Renders a
 * "New deck" button that expands into an inline name input.
 */
export default function NewDeckButton({ canCreate, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { creating, error, setError, create } = useCreateDeck((deck, limits) => {
    onCreated(deck, limits);
    setName("");
    setOpen(false);
  });

  function close() {
    setOpen(false);
    setName("");
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={!canCreate}
        title={canCreate ? "Create a new deck" : "Deck limit reached"}
        className="flex items-center gap-1.5 rounded-lg bg-blue-500/30 px-4 py-2 text-sm whitespace-nowrap text-blue-100 transition-colors enabled:cursor-pointer hover:bg-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          className="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New deck
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create(name);
            if (e.key === "Escape") close();
          }}
          maxLength={100}
          disabled={creating}
          placeholder="Deck name…"
          className="w-44 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-blue-100/40 focus:ring-2 focus:ring-blue-400/50 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void create(name)}
          disabled={creating}
          className="cursor-pointer rounded-lg bg-blue-500/30 px-4 py-2 text-sm whitespace-nowrap text-blue-100 transition-colors hover:bg-blue-500/50 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={creating}
          className="cursor-pointer rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm whitespace-nowrap text-blue-100/70 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
