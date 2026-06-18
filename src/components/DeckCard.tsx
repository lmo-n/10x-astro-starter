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
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deleteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  // Dismiss delete modal on Escape.
  useEffect(() => {
    if (!deleteModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDeleteModal();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [deleteModalOpen]);

  // Focus modal input when it opens.
  useEffect(() => {
    if (deleteModalOpen) {
      setTimeout(() => deleteInputRef.current?.focus(), 0);
    }
  }, [deleteModalOpen]);

  function openDeleteModal() {
    setConfirmName("");
    setDeleteError(null);
    setDeleteModalOpen(true);
  }

  function closeDeleteModal() {
    setDeleteModalOpen(false);
    setConfirmName("");
    setDeleteError(null);
  }

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
      closeDeleteModal();
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
              onClick={openDeleteModal}
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

      {/* Delete confirmation modal */}
      {deleteModalOpen && (
        <tr>
          <td colSpan={6} className="p-0">
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeDeleteModal();
              }}
            >
              <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-gray-900">
                <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Delete deck?</h2>
                <p className="mb-4 text-sm text-gray-500 dark:text-blue-100/60">
                  This will permanently delete{" "}
                  <span className="font-semibold text-gray-900 dark:text-white">{name}</span> and all its flashcards.
                  This cannot be undone. Type the deck name to confirm:
                </p>
                <p className="mb-2 text-xs font-medium text-gray-700 dark:text-blue-100/70">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-white/10">{name}</span>
                </p>
                <input
                  ref={deleteInputRef}
                  type="text"
                  value={confirmName}
                  onChange={(e) => {
                    setConfirmName(e.target.value);
                    if (deleteError) setDeleteError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && confirmName === name) void deleteDeck();
                  }}
                  disabled={deleting}
                  placeholder="Deck name…"
                  className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-red-500/50 focus:outline-none disabled:opacity-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40"
                />
                {deleteError && <p className="mb-3 text-xs text-red-500 dark:text-red-400">{deleteError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={deleting}
                    className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteDeck()}
                    disabled={deleting || confirmName !== name}
                    className="cursor-pointer rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500/40 dark:text-red-100 dark:hover:bg-red-500/60"
                  >
                    {deleting ? "Deleting…" : "Delete deck"}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
