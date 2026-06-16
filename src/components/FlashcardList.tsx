import type { FlashcardDto } from "@/types";

interface Props {
  /** The deck whose flashcards are listed (used for "create" actions later). */
  deckId: string;
  /** Server-rendered first page of flashcards. */
  initialFlashcards: FlashcardDto[];
}

/**
 * Renders the list of flashcards for a single deck.
 *
 * This is the scaffold the deck view uses to display flashcards. Card data is
 * passed in from the server; when the list is empty it shows an empty state.
 */
export default function FlashcardList({ deckId, initialFlashcards }: Props) {
  const flashcards = initialFlashcards;

  if (flashcards.length === 0) {
    return (
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
          This deck doesn&apos;t have any flashcards yet. They&apos;ll appear here once you add them.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3" data-deck-id={deckId}>
      {flashcards.map((card) => (
        <li
          key={card.id}
          className="rounded-2xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 dark:hover:bg-white/10"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40">Front</p>
              <p className="text-sm wrap-break-word text-gray-900 dark:text-white">{card.frontText}</p>
            </div>
            <div className="sm:border-l sm:border-gray-100 sm:pl-4 dark:sm:border-white/10">
              <p className="mb-1 text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40">Back</p>
              <p className="text-sm wrap-break-word text-gray-600 dark:text-blue-100/70">{card.backText}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-blue-100/40">
            {card.createdByAi && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
                AI
              </span>
            )}
            <span>Due {new Date(card.sm2.dueAt).toLocaleDateString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
