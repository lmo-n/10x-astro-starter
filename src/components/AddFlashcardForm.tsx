import { useState } from "react";
import type { FlashcardDto } from "@/types";
import { useCreateFlashcard, FRONT_TEXT_MAX_LENGTH, BACK_TEXT_MAX_LENGTH } from "@/components/hooks/useCreateFlashcard";

interface Props {
  /** The deck that will receive the new flashcard. */
  deckId: string;
  /** Called with the created flashcard so the parent can prepend it. */
  onCreated: (flashcard: FlashcardDto) => void;
}

/**
 * Inline form for manually adding a plain-text flashcard to a deck (PRD §5.5 /
 * User Story 8). Renders Front + Back inputs with live character counters and
 * client-side validation that mirrors the API, then POSTs to
 * `/api/decks/{deckId}/flashcards`.
 */
export default function AddFlashcardForm({ deckId, onCreated }: Props) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const { creating, error, setError, create } = useCreateFlashcard(deckId, (flashcard) => {
    onCreated(flashcard);
    setFront("");
    setBack("");
  });

  async function handleSubmit() {
    await create(front, back);
  }

  const frontLeft = FRONT_TEXT_MAX_LENGTH - front.length;
  const backLeft = BACK_TEXT_MAX_LENGTH - back.length;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-white/5"
    >
      <h3 className="mb-4 text-base font-semibold text-gray-900 dark:text-white">Add a flashcard</h3>

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
            value={front}
            onChange={(e) => {
              setFront(e.target.value);
              if (error) setError(null);
            }}
            rows={2}
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
            rows={2}
            maxLength={BACK_TEXT_MAX_LENGTH}
            disabled={creating}
            placeholder="The answer…"
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={creating || !front.trim() || !back.trim()}
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
          {creating ? "Adding…" : "Add flashcard"}
        </button>
      </div>
    </form>
  );
}
