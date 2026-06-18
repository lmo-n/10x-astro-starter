import { useState, useMemo } from "react";
import type { FlashcardDto } from "@/types";
import AddFlashcardForm from "@/components/AddFlashcardForm";
import { formatDate } from "@/lib/utils";
import Flashcard from "@/components/Flashcard";

type SortCol = "front" | "back" | "due" | "created" | "ai";
type SortDir = "asc" | "desc";

interface SortableThProps {
  col: SortCol;
  label: string;
  active: SortCol;
  dir: SortDir;
  onSort: (col: SortCol) => void;
  className?: string;
}

function SortableTh({ col, label, active, dir, onSort, className = "" }: SortableThProps) {
  const isActive = active === col;
  return (
    <th className={`py-3 text-left ${className}`}>
      <button
        onClick={() => {
          onSort(col);
        }}
        className={[
          "inline-flex items-center gap-1 text-xs font-semibold tracking-wide uppercase transition-colors select-none",
          isActive
            ? "text-blue-600 dark:text-blue-300"
            : "text-gray-400 hover:text-gray-700 dark:text-blue-100/40 dark:hover:text-blue-100/80",
        ].join(" ")}
      >
        {label}
        <svg
          className={[
            "h-3 w-3 transition-transform",
            isActive && dir === "desc" ? "rotate-180" : "",
            !isActive ? "opacity-40" : "",
          ].join(" ")}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </th>
  );
}

interface Props {
  /** The deck whose flashcards are listed. */
  deckId: string;
  /** Server-rendered first page of flashcards. */
  initialFlashcards: FlashcardDto[];
  /** Called after all flashcards have been successfully cleared. */
  onCleared?: () => void;
  /** Slot for the deck name heading rendered above the count badge. */
  deckName: string;
  /** Last-updated timestamp string (ISO 8601) from the server. */
  updatedAt: string;
}

/**
 * Renders the manual "add flashcard" form and the list of flashcards for a
 * single deck. Newly created cards are prepended to the list so they appear
 * instantly without a full page reload.
 */
export default function FlashcardList({ deckId, initialFlashcards, onCleared, deckName, updatedAt }: Props) {
  const [flashcards, setFlashcards] = useState(initialFlashcards);
  const [sortCol, setSortCol] = useState<SortCol>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const today = new Date().toISOString().slice(0, 10);
  const dueCount = flashcards.filter((c) => c.sm2.dueAt <= today).length;
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  /** Toggle sort column / direction. */
  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sortedFlashcards = useMemo(() => {
    return [...flashcards].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "front":
          cmp = a.frontText.localeCompare(b.frontText);
          break;
        case "back":
          cmp = a.backText.localeCompare(b.backText);
          break;
        case "due":
          cmp = a.sm2.dueAt.localeCompare(b.sm2.dueAt);
          break;
        case "ai":
          cmp = Number(a.createdByAi) - Number(b.createdByAi);
          break;
        case "created":
        default:
          cmp = a.createdAt.localeCompare(b.createdAt);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [flashcards, sortCol, sortDir]);

  /** Prepend a newly created flashcard to the list. */
  function handleCreated(flashcard: FlashcardDto) {
    setFlashcards((prev) => [flashcard, ...prev]);
  }

  /** Remove a deleted flashcard from the list. */
  function handleDeleted(id: string) {
    setFlashcards((prev) => prev.filter((c) => c.id !== id));
  }

  /** Replace an updated flashcard in the list. */
  function handleUpdated(updated: FlashcardDto) {
    setFlashcards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  /** Clear all flashcards from local state after a successful bulk delete. */
  function handleCleared() {
    setFlashcards([]);
    onCleared?.();
  }

  async function clearAllFlashcards() {
    setClearing(true);
    setClearError(null);
    try {
      const res = await fetch(`/api/decks/${deckId}/flashcards`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setClearError(body.error?.message ?? "Failed to clear flashcards.");
        return;
      }
      handleCleared();
      setConfirmingClear(false);
    } catch {
      setClearError("Network error. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      {/* Deck header — rendered inside the island so counts stay live */}
      <div className="mb-8">
        <h1 className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-2xl font-bold wrap-break-word text-transparent sm:text-3xl dark:from-blue-200 dark:to-purple-200">
          {deckName}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-blue-100/60">
          <span>
            <span className="font-semibold text-gray-900 dark:text-white">{flashcards.length}</span> cards
          </span>
          {dueCount > 0 && <span className="text-amber-600 dark:text-amber-300">{dueCount} due</span>}
          <span>Updated {formatDate(updatedAt)}</span>
        </div>
      </div>

      <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Flashcards</h2>

      <AddFlashcardForm deckId={deckId} onCreated={handleCreated} />

      {flashcards.length > 0 && (
        <div className="mb-4 flex items-center justify-end gap-3">
          {clearError && <p className="text-sm text-red-500 dark:text-red-400">{clearError}</p>}
          {confirmingClear ? (
            <>
              <span className="text-sm text-gray-600 dark:text-blue-100/70">Remove all {flashcards.length} cards?</span>
              <button
                onClick={() => {
                  setConfirmingClear(false);
                }}
                disabled={clearing}
                className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/20 dark:text-blue-100/60 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={clearAllFlashcards}
                disabled={clearing}
                className="cursor-pointer rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-500/40 dark:text-red-100 dark:hover:bg-red-500/60"
              >
                {clearing ? "Removing…" : "Yes, remove all"}
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setClearError(null);
                setConfirmingClear(true);
              }}
              className="cursor-pointer rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-400/40 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Remove all flashcards
            </button>
          )}
        </div>
      )}

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
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
                <SortableTh
                  col="front"
                  label="Front"
                  active={sortCol}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-[30%] pr-3 pl-4"
                />
                <SortableTh
                  col="back"
                  label="Back"
                  active={sortCol}
                  dir={sortDir}
                  onSort={handleSort}
                  className="w-[35%] px-3"
                />
                <SortableTh col="due" label="Due" active={sortCol} dir={sortDir} onSort={handleSort} className="px-3" />
                <SortableTh
                  col="created"
                  label="Created"
                  active={sortCol}
                  dir={sortDir}
                  onSort={handleSort}
                  className="hidden px-3 md:table-cell"
                />
                <SortableTh
                  col="ai"
                  label="AI"
                  active={sortCol}
                  dir={sortDir}
                  onSort={handleSort}
                  className="hidden px-3 sm:table-cell"
                />
                <th className="py-3 pr-4 pl-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/6">
              {sortedFlashcards.map((card) => (
                <Flashcard key={card.id} card={card} onDeleted={handleDeleted} onUpdated={handleUpdated} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
