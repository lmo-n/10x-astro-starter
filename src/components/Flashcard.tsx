import { useState } from "react";
import type { FlashcardDto } from "@/types";

interface Props {
  card: FlashcardDto;
  onDeleted: (id: string) => void;
}

export default function Flashcard({ card, onDeleted }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteFlashcard() {
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/flashcards/${card.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setDeleteError(body.error?.message ?? "Failed to delete flashcard.");
        return;
      }

      onDeleted(card.id);
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="group rounded-2xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 dark:hover:bg-white/10">
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400 dark:text-blue-100/40">
          {card.createdByAi && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
              AI
            </span>
          )}
          <span>Due {new Date(card.sm2.dueAt).toLocaleDateString()}</span>
        </div>

        <button
          onClick={() => {
            setConfirmingDelete(true);
            setDeleteError(null);
          }}
          title="Delete flashcard"
          className="shrink-0 cursor-pointer rounded p-1 text-gray-400 transition-opacity hover:bg-red-100 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 dark:text-blue-100/40 dark:hover:bg-red-500/20 dark:hover:text-red-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      {confirmingDelete && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-sm text-red-700 dark:text-red-200">Delete this flashcard? This cannot be undone.</p>
          {deleteError && <p className="mt-1.5 text-xs text-red-400">{deleteError}</p>}
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={() => void deleteFlashcard()}
              disabled={deleting}
              className="rounded-md bg-red-600 px-3 py-1 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-500/40 dark:text-red-100 dark:hover:bg-red-500/60"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              onClick={() => {
                setConfirmingDelete(false);
                setDeleteError(null);
              }}
              disabled={deleting}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/20 dark:text-blue-100/60 dark:hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
