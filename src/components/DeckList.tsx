import { useState } from "react";
import type { DeckDto, DeckLimitsDto } from "@/types";
import type { ListDecksInput } from "@/lib/validation/decks";
import DeckCard from "@/components/DeckCard";
import DeckEmptyState from "@/components/DeckEmptyState";
import NewDeckButton from "@/components/NewDeckButton";

interface Props {
  /** Server-rendered first page of decks. */
  initialDecks: DeckDto[];
  /** Server-rendered deck quota, or `undefined` when unavailable. */
  initialLimits: DeckLimitsDto | undefined;
  /** Parsed query parameters that produced this page. */
  query: ListDecksInput;
  /** Raw query string of the current request (e.g. `?sort=name`). */
  searchParams: string;
  /** Opaque cursor for the next page, or `null` when none. */
  nextCursor: string | null;
  /** Server-side fetch error message, if any. */
  fetchError: string | null;
}

type SortColumn = "name" | "updatedAt" | "createdAt";

interface SortableThProps {
  column: SortColumn;
  label: string;
  currentSort: string;
  currentOrder: string;
  className?: string;
  buildUrl: (overrides: Record<string, string | undefined>) => string;
}

function SortableTh({ column, label, currentSort, currentOrder, className = "", buildUrl }: SortableThProps) {
  const isActive = currentSort === column;
  const nextOrder = isActive && currentOrder === "asc" ? "desc" : "asc";
  const href = buildUrl({ sort: column, order: isActive ? nextOrder : "desc" });
  return (
    <th className={`py-3 text-left ${className}`}>
      <a
        href={href}
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
            isActive && currentOrder === "desc" ? "rotate-180" : "",
            !isActive ? "opacity-40" : "",
          ].join(" ")}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
      </a>
    </th>
  );
}

export default function DeckList({ initialDecks, initialLimits, query, searchParams, nextCursor, fetchError }: Props) {
  const [decks, setDecks] = useState(initialDecks);
  const [limits, setLimits] = useState(initialLimits);

  function handleDeleted(id: string) {
    setDecks((prev) => prev.filter((d) => d.id !== id));
    setLimits((prev) => (prev ? { ...prev, deckCount: Math.max(prev.deckCount - 1, 0), canCreateDeck: true } : prev));
  }

  function handleCreated(deck: DeckDto, newLimits: DeckLimitsDto) {
    setDecks((prev) => [deck, ...prev]);
    setLimits(newLimits);
  }

  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams(searchParams);
    p.delete("cursor");
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined && v !== "") p.set(k, v);
      else p.delete(k);
    }
    return `?${p.toString()}`;
  }

  const nextPageUrl = (() => {
    if (!nextCursor) return null;
    const p = new URLSearchParams(searchParams);
    p.set("cursor", nextCursor);
    return `?${p.toString()}`;
  })();

  return (
    <>
      {/* Toolbar: search + new deck */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form method="GET" className="flex w-full items-center gap-2 sm:flex-1">
          <input type="hidden" name="sort" value={query.sort} />
          <input type="hidden" name="order" value={query.order} />
          {query.limit !== 20 && <input type="hidden" name="limit" value={query.limit} />}
          <div className="relative flex-1">
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="Search decks…"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pr-4 pl-9 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
            />
            <svg
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-blue-100/40"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm whitespace-nowrap text-gray-700 transition-colors hover:bg-gray-200 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
          >
            Search
          </button>
        </form>
        <div className="hidden h-6 w-px bg-gray-200 sm:block dark:bg-white/10" />
        <NewDeckButton canCreate={limits ? limits.canCreateDeck : true} onCreated={handleCreated} />
      </div>

      {/* Error state */}
      {fetchError && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
          {fetchError}
        </div>
      )}

      {/* Table or empty state */}
      {decks.length === 0 && !fetchError ? (
        <DeckEmptyState isSearchResult={Boolean(query.search)} searchTerm={query.search} onCreated={handleCreated} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
                <SortableTh
                  column="name"
                  label="Name"
                  currentSort={query.sort ?? "createdAt"}
                  currentOrder={query.order ?? "desc"}
                  className="pr-3 pl-4"
                  buildUrl={buildUrl}
                />
                <th className="hidden px-3 py-3 text-left text-xs font-semibold tracking-wide text-gray-400 uppercase sm:table-cell dark:text-blue-100/40">
                  Cards
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                  Due
                </th>
                <SortableTh
                  column="updatedAt"
                  label="Updated"
                  currentSort={query.sort ?? "createdAt"}
                  currentOrder={query.order ?? "desc"}
                  className="hidden px-3 sm:table-cell"
                  buildUrl={buildUrl}
                />
                <SortableTh
                  column="createdAt"
                  label="Created"
                  currentSort={query.sort ?? "createdAt"}
                  currentOrder={query.order ?? "desc"}
                  className="hidden px-3 md:table-cell"
                  buildUrl={buildUrl}
                />
                <th className="py-3 pr-4 pl-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/6">
              {decks.map((deck) => (
                <DeckCard key={deck.id} deck={deck} onDeleted={handleDeleted} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {nextPageUrl && (
        <div className="mt-8 flex justify-center">
          <a
            href={nextPageUrl}
            className="rounded-lg border border-gray-300 bg-white px-6 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
          >
            Next page
          </a>
        </div>
      )}
    </>
  );
}
