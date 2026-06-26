import { useState, useEffect, useCallback } from "react";
import type { AiGenerationLogListItemDto, PaginationDto } from "@/types";

const MODEL_LABELS: Record<string, string> = {
  "openai/gpt-4o-mini": "GPT-4o mini",
  "anthropic/claude-3-haiku": "Claude 3 Haiku",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function AcceptanceBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 75 ? "bg-emerald-400" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums dark:text-blue-100/50">{pct}%</span>
    </div>
  );
}

interface Props {
  /** SSR-prefetched first page. When provided the initial client-side fetch is skipped. */
  initialLogs?: AiGenerationLogListItemDto[];
  initialPagination?: PaginationDto;
}

export default function AiGenerationHistory({ initialLogs, initialPagination }: Props) {
  const hasInitialData = initialLogs !== undefined;

  const [logs, setLogs] = useState<AiGenerationLogListItemDto[]>(initialLogs ?? []);
  const [pagination, setPagination] = useState<PaginationDto>(
    initialPagination ?? { nextCursor: null, hasMore: false },
  );
  const [loading, setLoading] = useState(!hasInitialData);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ limit: "5" });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`/api/ai/generation-logs?${params.toString()}`);
    const body = (await res.json()) as {
      data?: AiGenerationLogListItemDto[];
      pagination?: PaginationDto;
      error?: { message?: string };
    };

    if (!res.ok) throw new Error(body.error?.message ?? "Failed to load history.");
    return { data: body.data ?? [], pagination: body.pagination ?? { nextCursor: null, hasMore: false } };
  }, []);

  useEffect(() => {
    if (hasInitialData) return;
    void fetchPage()
      .then(({ data, pagination: pg }) => {
        setLogs(data);
        setPagination(pg);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load history.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [fetchPage]);

  async function loadMore() {
    if (!pagination.nextCursor) return;
    setLoadingMore(true);
    try {
      const { data, pagination: pg } = await fetchPage(pagination.nextCursor);
      setLogs((prev) => [...prev, ...data]);
      setPagination(pg);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-6 dark:border-white/10 dark:bg-white/5">
        <div className="mb-4 h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-200 dark:bg-white/10" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (logs.length === 0) return null;

  return (
    <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300">
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
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AI generation history</h3>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 dark:border-white/10">
              <th className="pb-2 text-left font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                Date
              </th>
              <th className="pb-2 text-left font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                Model
              </th>
              <th className="pb-2 text-right font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                Proposed
              </th>
              <th className="pb-2 text-right font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                Saved
              </th>
              <th className="pb-2 pl-4 text-left font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                Acceptance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {logs.map((log) => (
              <tr key={log.id} className="group">
                <td className="py-2.5 text-gray-600 dark:text-blue-100/70">{formatDate(log.createdAt)}</td>
                <td className="py-2.5 text-gray-600 dark:text-blue-100/70">{MODEL_LABELS[log.model] ?? log.model}</td>
                <td className="py-2.5 text-right text-gray-600 tabular-nums dark:text-blue-100/70">
                  {log.proposedCardsCount}
                </td>
                <td className="py-2.5 text-right text-gray-600 tabular-nums dark:text-blue-100/70">
                  {log.savedCardsCount}
                </td>
                <td className="py-2.5 pl-4">
                  <AcceptanceBar rate={log.acceptanceRate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {pagination.hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
