import { useEffect, useRef, useState } from "react";
import type { DeckDto, DeckLimitsDto } from "@/types";
import { useCreateDeck } from "@/components/hooks/useCreateDeck";

interface Props {
  /** Whether the user is below their deck quota. */
  canCreate: boolean;
  /** Called after a deck is created so the parent can update its list/limits. */
  onCreated: (deck: DeckDto, limits: DeckLimitsDto) => void;
}

/**
 * Toolbar control for creating a deck. Renders a "New deck" button that opens
 * a modal dialog with a name input.
 */
export default function NewDeckButton({ canCreate, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={!canCreate}
        title={canCreate ? "Create a new deck" : "Deck limit reached"}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm whitespace-nowrap text-white transition-colors hover:bg-blue-700 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/50"
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

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-gray-900">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">New deck</h2>

            <label
              htmlFor="new-deck-name"
              className="mb-1 block text-xs font-medium tracking-wide text-gray-500 uppercase dark:text-blue-100/50"
            >
              Deck name
            </label>
            <input
              id="new-deck-name"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create(name);
              }}
              maxLength={100}
              disabled={creating}
              placeholder="Deck name…"
              className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
            />

            {error && <p className="mb-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={creating}
                className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void create(name)}
                disabled={creating || name.trim().length === 0}
                className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/50"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
