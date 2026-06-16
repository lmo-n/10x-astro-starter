import { useState } from "react";
import type { FlashcardDto } from "@/types";
import AddFlashcardForm from "@/components/AddFlashcardForm";
import Flashcard from "@/components/Flashcard";

interface Props {
  /** The deck whose flashcards are listed. */
  deckId: string;
  /** Server-rendered first page of flashcards. */
  initialFlashcards: FlashcardDto[];
}

/**
 * Renders the manual "add flashcard" form and the list of flashcards for a
 * single deck. Newly created cards are prepended to the list so they appear
 * instantly without a full page reload.
 */
export default function FlashcardList({ deckId, initialFlashcards }: Props) {
  const [flashcards, setFlashcards] = useState(initialFlashcards);

  /** Prepend a newly created flashcard to the list. */
  function handleCreated(flashcard: FlashcardDto) {
    setFlashcards((prev) => [flashcard, ...prev]);
  }

  /** Remove a deleted flashcard from the list. */
  function handleDeleted(id: string) {
    setFlashcards((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <>
      <AddFlashcardForm deckId={deckId} onCreated={handleCreated} />

      {flashcards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center dark:border-white/15 dark:bg-white/5">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
            <svg
              className="h-6 w-6"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">No flashcards yet</h3>
          <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-blue-100/60">
            This deck doesn&apos;t have any flashcards yet. Add your first one using the form above.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" data-deck-id={deckId}>
          {flashcards.map((card) => (
            <Flashcard key={card.id} card={card} onDeleted={handleDeleted} />
          ))}
        </ul>
      )}
    </>
  );
}
