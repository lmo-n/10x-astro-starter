import { useEffect, useRef, useState } from "react";
import type { FlashcardDto } from "@/types";
import { useCreateFlashcard, FRONT_TEXT_MAX_LENGTH, BACK_TEXT_MAX_LENGTH } from "@/components/hooks/useCreateFlashcard";

interface Props {
  /** The deck that will receive the new flashcard. */
  deckId: string;
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the modal should close. */
  onClose: () => void;
  /** Called with the created flashcard so the parent can prepend it. */
  onCreated: (flashcard: FlashcardDto) => void;
}

/**
 * Modal form for manually adding a plain-text flashcard to a deck.
 * Renders Front + Back inputs with live character counters and
 * client-side validation that mirrors the API, then POSTs to
 * `/api/decks/{deckId}/flashcards`.
 */
export default function AddFlashcardForm({ deckId, open, onClose, onCreated }: Props) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const { creating, error, setError, create } = useCreateFlashcard(deckId, (flashcard) => {
    onCreated(flashcard);
    setFront("");
    setBack("");
    onClose();
  });

  function close() {
    setFront("");
    setBack("");
    setError(null);
    onClose();
  }

  // Focus front textarea when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => frontRef.current?.focus(), 0);
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

  if (!open) return null;

  const frontLeft = FRONT_TEXT_MAX_LENGTH - front.length;
  const backLeft = BACK_TEXT_MAX_LENGTH - back.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-gray-900">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Add a flashcard</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(front, back);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Front */}
            <div>
              <label
                htmlFor="flashcard-front"
                className="mb-1 flex items-center justify-between text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40"
              >
                <span>Front</span>
                <span className={frontLeft < 0 ? "text-red-400" : ""}>{frontLeft}</span>
              </label>
              <textarea
                id="flashcard-front"
                ref={frontRef}
                value={front}
                onChange={(e) => {
                  setFront(e.target.value);
                  if (error) setError(null);
                }}
                rows={3}
                maxLength={FRONT_TEXT_MAX_LENGTH}
                disabled={creating}
                placeholder="Short question (max 2 sentences)…"
                className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
              />
            </div>

            {/* Back */}
            <div>
              <label
                htmlFor="flashcard-back"
                className="mb-1 flex items-center justify-between text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40"
              >
                <span>Back</span>
                <span className={backLeft < 0 ? "text-red-400" : ""}>{backLeft}</span>
              </label>
              <textarea
                id="flashcard-back"
                value={back}
                onChange={(e) => {
                  setBack(e.target.value);
                  if (error) setError(null);
                }}
                rows={3}
                maxLength={BACK_TEXT_MAX_LENGTH}
                disabled={creating}
                placeholder="The answer…"
                className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
              />
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={creating}
              className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !front.trim() || !back.trim()}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/50"
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
              {creating ? "Adding…" : "Add flashcard"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
