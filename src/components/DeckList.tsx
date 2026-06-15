import { useState } from "react";
import type { DeckDto, DeckLimitsDto } from "@/types";
import type { ListDecksInput } from "@/lib/validation/decks";
import DeckCard from "@/components/DeckCard";
import DeckEmptyState from "@/components/DeckEmptyState";

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

const SORT_OPTIONS = [
  { value: "createdAt", label: "Created" },
  { value: "updatedAt", label: "Updated" },
  { value: "name", label: "Name" },
] as const;

export default function DeckList({ initialDecks, initialLimits, query, searchParams, nextCursor, fetchError }: Props) {
  const [decks, setDecks] = useState(initialDecks);
  const [limits, setLimits] = useState(initialLimits);

  /** Remove a deck from the list and refresh the limits bar (React way). */
  function handleDeleted(id: string) {
    setDecks((prev) => prev.filter((d) => d.id !== id));
    setLimits((prev) => (prev ? { ...prev, deckCount: Math.max(prev.deckCount - 1, 0), canCreateDeck: true } : prev));
  }

  /** Prepend a newly created deck and refresh the limits bar. */
  function handleCreated(deck: DeckDto, newLimits: DeckLimitsDto) {
    setDecks((prev) => [deck, ...prev]);
    setLimits(newLimits);
  }

  /** Build a URL relative to the current query, resetting pagination. */
  function buildUrl(overrides: Record<string, string | undefined>) {
    const p = new URLSearchParams(searchParams);
    p.delete("cursor"); // reset pagination when changing filters/sort
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

  const usedPct = limits ? Math.min((limits.deckCount / limits.deckLimit) * 100, 100) : 0;

  return (
    <>
      {/* Deck limits bar */}
      {limits && (
        <div className="mb-6 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between text-sm">
            <span className="text-blue-100/70">
              <span className="font-semibold text-white">{limits.deckCount}</span> / <span>{limits.deckLimit}</span>{" "}
              decks used
            </span>
            {!limits.canCreateDeck && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                Deck limit reached
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-linear-to-r from-blue-400 to-purple-400 transition-all"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Search + Sort toolbar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search form */}
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
              className="w-full rounded-lg border border-white/20 bg-white/10 py-2 pr-4 pl-9 text-sm text-white placeholder:text-blue-100/40 focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
            />
            <svg
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-blue-100/40"
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
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm whitespace-nowrap transition-colors hover:bg-white/20"
          >
            Search
          </button>
        </form>

        {/* Divider */}
        <div className="hidden h-6 w-px bg-white/10 sm:block" />

        {/* Sort buttons */}
        <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
          <span className="text-xs tracking-wide text-blue-100/40 uppercase">Sort:</span>
          {SORT_OPTIONS.map(({ value, label }) => {
            const isActive = query.sort === value;
            const toggleOrder = isActive && query.order === "asc" ? "desc" : "asc";
            const href = buildUrl({ sort: value, order: isActive ? toggleOrder : query.order });
            return (
              <a
                key={value}
                href={href}
                className={[
                  "flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                  isActive
                    ? "border-blue-400/50 bg-blue-500/20 text-blue-200"
                    : "border-white/20 bg-white/5 text-blue-100/60 hover:bg-white/10",
                ].join(" ")}
              >
                {label}
                {isActive && (
                  <svg
                    className={`h-3 w-3 transition-transform${query.order === "desc" ? "rotate-180" : ""}`}
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {fetchError && (
        <div className="mb-6 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {fetchError}
        </div>
      )}

      {/* Deck grid */}
      {decks.length === 0 && !fetchError ? (
        <DeckEmptyState isSearchResult={Boolean(query.search)} searchTerm={query.search} onCreated={handleCreated} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {nextPageUrl && (
        <div className="mt-8 flex justify-center">
          <a
            href={nextPageUrl}
            className="rounded-lg border border-white/20 bg-white/10 px-6 py-2 text-sm transition-colors hover:bg-white/20"
          >
            Next page
          </a>
        </div>
      )}
    </>
  );
}
