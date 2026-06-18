import { useState, useEffect } from "react";
import type { FlashcardDto } from "@/types";
import { frontTextSchema, backTextSchema } from "@/lib/validation/flashcards";
import { formatDate } from "@/lib/utils";
import { playRemoveSound, playSuccessSound, prepareRemoveSound, prepareSuccessSound } from "@/lib/sounds";

interface Props {
  card: FlashcardDto;
  onDeleted: (id: string) => void;
  onUpdated: (updated: FlashcardDto) => void;
}

/**
 * Return a human-readable due label and a Tailwind colour class based on how
 * far away (or overdue) the card's `dueAt` date is, relative to today.
 */
function dueBadge(dueAt: string): { label: string; className: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueAt}T00:00:00`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) {
    const n = Math.abs(diffDays);
    return {
      label: `Overdue by ${n} day${n === 1 ? "" : "s"}`,
      className:
        "bg-red-100 text-red-800 border border-red-300 dark:bg-red-500/25 dark:text-red-300 dark:border-red-500/50",
    };
  }
  if (diffDays === 0) {
    return {
      label: "Due today",
      className:
        "bg-orange-100 text-orange-800 border border-orange-300 dark:bg-orange-500/25 dark:text-orange-300 dark:border-orange-500/50",
    };
  }
  if (diffDays <= 2) {
    return {
      label: `Due in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
      className:
        "bg-yellow-100 text-yellow-800 border border-yellow-300 dark:bg-yellow-500/20 dark:text-yellow-300 dark:border-yellow-500/40",
    };
  }
  if (diffDays <= 6) {
    return {
      label: `Due in ${diffDays} days`,
      className:
        "bg-teal-100 text-teal-800 border border-teal-300 dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-500/40",
    };
  }
  return {
    label: `Due ${formatDate(due)}`,
    className:
      "bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40",
  };
}

/** Validate both text fields and return per-field error strings. */
function validateEditFields(front: string, back: string): { front: string | null; back: string | null } {
  const frontResult = frontTextSchema.safeParse(front);
  const backResult = backTextSchema.safeParse(back);
  return {
    front: frontResult.success ? null : (frontResult.error.issues[0]?.message ?? "Front text is invalid."),
    back: backResult.success ? null : (backResult.error.issues[0]?.message ?? "Back text is invalid."),
  };
}

export default function Flashcard({ card, onDeleted, onUpdated }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editFront, setEditFront] = useState(card.frontText);
  const [editBack, setEditBack] = useState(card.backText);
  const [saving, setSaving] = useState(false);
  const [frontError, setFrontError] = useState<string | null>(null);
  const [backError, setBackError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Cancel edit on Escape (document-level so it works reliably inside a table).
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
        setFrontError(null);
        setBackError(null);
        setServerError(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
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
    setEditFront(card.frontText);
    setEditBack(card.backText);
    setFrontError(null);
    setBackError(null);
    setServerError(null);
    setConfirmingDelete(false);
    setDeleteError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setFrontError(null);
    setBackError(null);
    setServerError(null);
  }

  async function saveEdit() {
    prepareSuccessSound();
    // Validate on the client before hitting the network.
    const errors = validateEditFields(editFront, editBack);
    setFrontError(errors.front);
    setBackError(errors.back);
    if (errors.front || errors.back) return;

    setSaving(true);
    setServerError(null);

    const body: Record<string, string> = {};
    if (editFront.trim() !== card.frontText) body.frontText = editFront;
    if (editBack.trim() !== card.backText) body.backText = editBack;

    // Always send both when editing so at least one field is present.
    const payload = { frontText: editFront, backText: editBack };

    try {
      const res = await fetch(`/api/flashcards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setServerError(data.error?.message ?? "Failed to save changes.");
        return;
      }

      const data = (await res.json()) as { flashcard: FlashcardDto };
      playSuccessSound();
      onUpdated(data.flashcard);
      setEditing(false);
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteFlashcard() {
    prepareRemoveSound();
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

      playRemoveSound();
      onDeleted(card.id);
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <tr className="group align-top transition-colors hover:bg-gray-50/60 dark:hover:bg-white/2">
        {/* Front */}
        <td className="py-3 pr-3 pl-4 align-top text-sm text-gray-900 dark:text-white">
          {editing ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40">Front</label>
                <span
                  className={`text-xs tabular-nums ${editFront.trim().length > 500 ? "text-red-500" : "text-gray-400 dark:text-blue-100/40"}`}
                >
                  {editFront.trim().length}/500
                </span>
              </div>
              <textarea
                value={editFront}
                onChange={(e) => {
                  setEditFront(e.target.value);
                  setFrontError(null);
                }}
                rows={3}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none dark:bg-white/5 dark:text-white ${frontError ? "border-red-400 bg-red-50 dark:border-red-500/60 dark:bg-red-500/10" : "border-gray-200 bg-white focus:border-blue-500 dark:border-white/10 dark:focus:border-blue-400"}`}
              />
              {frontError && <p className="text-xs text-red-500 dark:text-red-400">{frontError}</p>}
            </div>
          ) : (
            <span className="line-clamp-3 wrap-break-word">{card.frontText}</span>
          )}
        </td>

        {/* Back */}
        <td className="px-3 py-3 align-top text-sm text-gray-600 dark:text-blue-100/70">
          {editing ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40">Back</label>
                <span
                  className={`text-xs tabular-nums ${editBack.trim().length > 3000 ? "text-red-500" : "text-gray-400 dark:text-blue-100/40"}`}
                >
                  {editBack.trim().length}/3000
                </span>
              </div>
              <textarea
                value={editBack}
                onChange={(e) => {
                  setEditBack(e.target.value);
                  setBackError(null);
                }}
                rows={3}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-gray-600 focus:outline-none dark:bg-white/5 dark:text-blue-100/70 ${backError ? "border-red-400 bg-red-50 dark:border-red-500/60 dark:bg-red-500/10" : "border-gray-200 bg-white focus:border-blue-500 dark:border-white/10 dark:focus:border-blue-400"}`}
              />
              {backError && <p className="text-xs text-red-500 dark:text-red-400">{backError}</p>}
            </div>
          ) : (
            <span className="line-clamp-3 wrap-break-word">{card.backText}</span>
          )}
        </td>

        {/* Due */}
        <td className="px-3 py-3 align-top">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${dueBadge(card.sm2.dueAt).className}`}
          >
            {dueBadge(card.sm2.dueAt).label}
          </span>
        </td>

        {/* Created — hidden below md */}
        <td className="hidden px-3 py-3 align-top text-sm text-gray-400 md:table-cell dark:text-blue-100/40">
          {formatDate(card.createdAt)}
        </td>

        {/* AI — hidden on mobile */}
        <td className="hidden px-3 py-3 align-top sm:table-cell">
          {card.createdByAi ? (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
              AI
            </span>
          ) : (
            <span className="text-gray-300 dark:text-blue-100/20">—</span>
          )}
        </td>

        {/* Actions */}
        <td className="py-3 pr-4 pl-3 align-top">
          {editing ? (
            <div className="flex flex-col gap-1.5">
              {serverError && <p className="text-xs text-red-500 dark:text-red-400">{serverError}</p>}
              <div className="flex gap-1.5">
                <button
                  onClick={() => void saveEdit()}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500/40 dark:text-blue-100 dark:hover:bg-blue-500/60"
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
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={startEdit}
                title="Edit flashcard"
                className="cursor-pointer rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-100 hover:text-blue-600 dark:text-blue-100/30 dark:hover:bg-blue-500/20 dark:hover:text-blue-300"
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
                    d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>
              <button
                onClick={() => {
                  setConfirmingDelete(true);
                  setDeleteError(null);
                }}
                title="Delete flashcard"
                className="cursor-pointer rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-blue-100/30 dark:hover:bg-red-500/20 dark:hover:text-red-300"
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
          )}
        </td>
      </tr>

      {/* Delete confirmation — spans all columns */}
      {confirmingDelete && (
        <tr>
          <td colSpan={6} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
              <p className="flex-1 text-sm text-red-700 dark:text-red-200">
                Delete this flashcard? This cannot be undone.
              </p>
              {deleteError && <p className="w-full text-xs text-red-400">{deleteError}</p>}
              <button
                onClick={() => void deleteFlashcard()}
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
