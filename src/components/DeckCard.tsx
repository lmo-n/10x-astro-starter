import { useState, useRef, useEffect } from "react";
import type { DeckDto } from "@/types";
import { formatDate } from "@/lib/utils";

interface Props {
  deck: DeckDto;
  onDeleted: (id: string) => void;
}

export default function DeckCard({ deck, onDeleted }: Props) {
  const [name, setName] = useState(deck.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deck.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  // Dismiss delete confirmation on Escape.
  useEffect(() => {
    if (!confirmingDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmingDelete(false);
        setDeleteError(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [confirmingDelete]);

  function startEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Deck name must not be empty.");
      return;
    }
    if (trimmed.length > 100) {
      setError("Deck name must be at most 100 characters.");
      return;
    }
    if (trimmed === name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/decks/${deck.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const body: { error?: { message?: string } } = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message ?? "Failed to rename deck.");
        return;
      }

      setName(trimmed);
      setEditing(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") void saveEdit();
    if (e.key === "Escape") cancelEdit();
  }

  async function deleteDeck() {
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/decks/${deck.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body: { error?: { message?: string } } = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setDeleteError(body.error?.message ?? "Failed to delete deck.");
        return;
      }

      // Notify the parent list so it can remove this deck and update the
      // limits bar (React owns the list state).
      onDeleted(deck.id);
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  // col order: Name | Cards (sm+) | Due | Updated (sm+) | Created (md+) | Actions
  return (
    <>
      <tr className="group transition-colors hover:bg-gray-50/60 dark:hover:bg-white/2">
        {/* Name */}
        <td className="py-3 pr-3 pl-4 align-middle text-sm font-medium">
          {editing ? (
            <div className="flex flex-col gap-1.5">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                maxLength={100}
                disabled={saving}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:focus:ring-blue-400/50"
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => void saveEdit()}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500/30 dark:text-blue-200 dark:hover:bg-blue-500/50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/20 dark:text-blue-100/60 dark:hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <a
              href={`/decks/${deck.id}`}
              className="text-gray-900 transition-colors hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300"
            >
              {name}
            </a>
          )}
        </td>

        {/* Cards — hidden on mobile */}
        <td className="hidden px-3 py-3 align-middle text-sm text-gray-500 tabular-nums sm:table-cell dark:text-blue-100/60">
          {deck.flashcardsCount}
        </td>

        {/* Due */}
        <td className="px-3 py-3 align-middle text-sm tabular-nums">
          {deck.dueFlashcardsCount > 0 ? (
            <span className="font-medium text-amber-600 dark:text-amber-300">{deck.dueFlashcardsCount}</span>
          ) : (
            <span className="text-gray-300 dark:text-blue-100/20">—</span>
          )}
        </td>

        {/* Updated — hidden on mobile */}
        <td className="hidden px-3 py-3 align-middle text-sm text-gray-400 sm:table-cell dark:text-blue-100/40">
          {formatDate(deck.updatedAt)}
        </td>

        {/* Created — hidden below md */}
        <td className="hidden px-3 py-3 align-middle text-sm text-gray-400 md:table-cell dark:text-blue-100/40">
          {formatDate(deck.createdAt)}
        </td>

        {/* Actions */}
        <td className="py-3 pr-4 pl-3 align-middle">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={startEdit}
              title="Rename deck"
              className="cursor-pointer rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-blue-100/30 dark:hover:bg-white/10 dark:hover:text-blue-100/70"
            >
              <svg
                className="h-3.5 w-3.5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 0 1 2.828 0l.172.172a2 2 0 0 1 0 2.828L12 16H9v-3z"
                />
              </svg>
            </button>
            <button
              onClick={() => {
                setConfirmingDelete(true);
                setDeleteError(null);
              }}
              title="Delete deck"
              className="cursor-pointer rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-blue-100/30 dark:hover:bg-red-500/20 dark:hover:text-red-300"
            >
              <svg
                className="h-3.5 w-3.5"
                xmlns="http://www.w3.org/2000/svg"
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
            <a
              href={`/decks/${deck.id}`}
              className="ml-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-blue-100/60 dark:hover:border-blue-400/40 dark:hover:text-blue-200"
            >
              Open
            </a>
          </div>
        </td>
      </tr>

      {/* Delete confirmation — spans all 6 columns */}
      {confirmingDelete && (
        <tr>
          <td colSpan={6} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
              <p className="flex-1 text-sm text-red-700 dark:text-red-200">
                Delete <span className="font-semibold">{name}</span> and all its flashcards? This cannot be undone.
              </p>
              {deleteError && <p className="w-full text-xs text-red-400">{deleteError}</p>}
              <button
                onClick={() => void deleteDeck()}
                disabled={deleting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-500/40 dark:text-red-100 dark:hover:bg-red-500/60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/20 dark:text-blue-100/60 dark:hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
