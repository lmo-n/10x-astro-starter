import { useState } from "react";
import type {
  ReviewGrade,
  StudyQueueItemDto,
  StudyDueSummaryDto,
  GetStudyDueResponseDto,
  SubmitReviewResponseDto,
} from "@/types";

interface Props {
  /** Server-rendered first page of due cards. */
  initialItems: StudyQueueItemDto[];
  /** Server-rendered queue summary (due / suggested / upcoming counts). */
  summary: StudyDueSummaryDto;
  /** Opaque cursor for the next page of due cards, or `null` when none. */
  initialNextCursor: string | null;
  /** Optional deck filter; preserved when fetching further pages. */
  deckId?: string;
  /** Server-side fetch error message, if any. */
  fetchError: string | null;
}

/** Visual config for each grade button. */
const GRADE_CONFIG: Record<ReviewGrade, { label: string; description: string; className: string }> = {
  again: {
    label: "Again",
    description: "Forgot",
    className:
      "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30 dark:hover:bg-red-500/20",
  },
  hard: {
    label: "Hard",
    description: "Struggled",
    className:
      "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-400/30 dark:hover:bg-orange-500/20",
  },
  good: {
    label: "Good",
    description: "Remembered",
    className:
      "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-500/10 dark:text-green-300 dark:border-green-400/30 dark:hover:bg-green-500/20",
  },
  easy: {
    label: "Easy",
    description: "Perfect",
    className:
      "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-400/30 dark:hover:bg-blue-500/20",
  },
};

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

/**
 * Interactive study session for the due-card queue. Cards are shown one at a
 * time; the user flips a card to reveal the answer, then grades themselves with
 * `again / hard / good / easy` which submits the review to `POST /api/study/reviews`
 * and advances to the next card. Further pages are loaded lazily from
 * `GET /api/study/due` using the cursor so large queues never block the initial render.
 */
export default function StudySession({ initialItems, summary, initialNextCursor, deckId, fetchError }: Props) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  // nextDueCount updated after each review submission.
  const [remainingDue, setRemainingDue] = useState(summary.dueCount);
  // Track how many cards were reviewed this session.
  const [reviewedCount, setReviewedCount] = useState(0);

  const current = items[index];
  const progressPct = summary.dueCount > 0 ? Math.min((reviewedCount / summary.dueCount) * 100, 100) : 0;

  /** Fetch the next page of due cards using the current deck filter + cursor. */
  async function loadMore(): Promise<StudyQueueItemDto[]> {
    const params = new URLSearchParams();
    if (deckId) params.set("deckId", deckId);
    if (nextCursor) params.set("cursor", nextCursor);

    const res = await fetch(`/api/study/due?${params.toString()}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? "Failed to load more cards.");
    }
    const data = (await res.json()) as GetStudyDueResponseDto;
    setNextCursor(data.pagination.nextCursor);
    return data.data;
  }

  /** Submit a grade for the current card, then advance to the next. */
  async function submitGrade(grade: ReviewGrade) {
    if (submitting) return;

    setSubmitting(true);
    setLoadError(null);

    try {
      const res = await fetch("/api/study/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flashcardId: current.id, grade }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Failed to submit review.");
      }

      const data = (await res.json()) as SubmitReviewResponseDto;
      setRemainingDue(data.nextDueCount);
      setReviewedCount((n) => n + 1);

      // Advance to the next card.
      const nextIndex = index + 1;

      if (nextIndex < items.length) {
        setIndex(nextIndex);
        setRevealed(false);
        return;
      }

      // No more loaded cards, but another page exists → fetch it.
      if (nextCursor) {
        setLoadingMore(true);
        try {
          const more = await loadMore();
          if (more.length > 0) {
            setItems((prev) => [...prev, ...more]);
            setIndex(nextIndex);
            setRevealed(false);
          } else {
            setFinished(true);
          }
        } catch (e) {
          setLoadError(e instanceof Error ? e.message : "Failed to load more cards.");
        } finally {
          setLoadingMore(false);
        }
        return;
      }

      // Nothing left.
      setFinished(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  }

  /** Reveal the answer for the current card. */
  function reveal() {
    setRevealed(true);
  }

  /** Restart the session from the first loaded card. */
  function restart() {
    setIndex(0);
    setRevealed(false);
    setFinished(false);
    setLoadError(null);
    setReviewedCount(0);
    setRemainingDue(summary.dueCount);
  }

  // --- Error state ---------------------------------------------------------
  if (fetchError) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
        {fetchError}
      </div>
    );
  }

  // --- Empty state ---------------------------------------------------------
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-16 text-center dark:border-white/15 dark:bg-white/5">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-300">
          <svg
            className="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">All caught up!</h3>
        <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-blue-100/60">
          You have no flashcards due for review right now. Check back later or add more cards to your decks.
        </p>
        <a
          href="/dashboard"
          className="mt-6 inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
        >
          Back to decks
        </a>
      </div>
    );
  }

  // --- Completion state ----------------------------------------------------
  if (finished) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-16 text-center dark:border-white/10 dark:bg-white/5">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
          <svg
            className="h-6 w-6"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">Session complete</h3>
        <p className="mx-auto max-w-sm text-sm text-gray-500 dark:text-blue-100/60">
          You reviewed {reviewedCount} {reviewedCount === 1 ? "card" : "cards"} in this session.
          {remainingDue > 0 && ` ${remainingDue} card${remainingDue === 1 ? "" : "s"} still due.`}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={restart}
            className="inline-flex cursor-pointer items-center rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 dark:bg-blue-500/40 dark:text-blue-100 dark:hover:bg-blue-500/60"
          >
            Review again
          </button>
          <a
            href="/dashboard"
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
          >
            Back to decks
          </a>
        </div>
      </div>
    );
  }

  // --- Active card ---------------------------------------------------------
  return (
    <div>
      {/* Progress bar + counters */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-sm text-gray-500 dark:text-blue-100/60">
          <span>
            Card <span className="font-semibold text-gray-900 dark:text-white">{reviewedCount + 1}</span> of{" "}
            {summary.dueCount} due
          </span>
          {summary.upcomingCount > 0 && <span>{summary.upcomingCount} upcoming</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-linear-to-r from-blue-400 to-purple-400 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10 dark:border-white/10 dark:bg-white/5">
        <p className="mb-2 text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40">Front</p>
        <p className="text-lg wrap-break-word text-gray-900 sm:text-xl dark:text-white">{current.frontText}</p>

        {revealed && (
          <div className="mt-6 border-t border-gray-100 pt-6 dark:border-white/10">
            <p className="mb-2 text-xs tracking-wide text-gray-400 uppercase dark:text-blue-100/40">Back</p>
            <p className="text-base wrap-break-word text-gray-600 sm:text-lg dark:text-blue-100/70">
              {current.backText}
            </p>
          </div>
        )}
      </div>

      {loadError && <p className="mt-4 text-sm text-red-500 dark:text-red-400">{loadError}</p>}

      {/* Controls */}
      <div className="mt-6 flex items-center justify-center gap-3">
        {!revealed ? (
          <button
            onClick={reveal}
            className="inline-flex cursor-pointer items-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500/40 dark:text-blue-100 dark:hover:bg-blue-500/60"
          >
            Show answer
          </button>
        ) : (
          <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <p className="text-xs text-gray-400 dark:text-blue-100/40">How well did you remember?</p>
            <div className="flex gap-2">
              {GRADES.map((grade) => {
                const cfg = GRADE_CONFIG[grade];
                return (
                  <button
                    key={grade}
                    onClick={() => void submitGrade(grade)}
                    disabled={submitting || loadingMore}
                    className={`inline-flex cursor-pointer flex-col items-center rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cfg.className}`}
                  >
                    <span className="font-semibold">{cfg.label}</span>
                    <span className="opacity-70">{cfg.description}</span>
                  </button>
                );
              })}
            </div>
            {(submitting || loadingMore) && (
              <span className="text-xs text-gray-400 dark:text-blue-100/40">
                {loadingMore ? "Loading…" : "Saving…"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
