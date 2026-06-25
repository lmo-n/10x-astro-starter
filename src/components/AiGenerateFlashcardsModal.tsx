import { useState, useEffect, useRef, useCallback } from "react";
import type { FlashcardDto } from "@/types";
import { SOURCE_TEXT_MIN_LENGTH, SOURCE_TEXT_MAX_LENGTH, INSTRUCTIONS_MAX_LENGTH } from "@/lib/validation/ai";

interface Props {
  /** The deck that will receive the approved flashcards. */
  deckId: string;
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the modal should close. */
  onClose: () => void;
  /** Called with the saved flashcards so the parent can prepend them to the list. */
  onCreated: (flashcards: FlashcardDto[]) => void;
}

type ModalState = "input" | "generating" | "error" | "preview" | "saving";

interface ProposedCard {
  /** Client-side key. */
  id: number;
  frontText: string;
  backText: string;
  /** When true the card is excluded from the approval set. */
  deleted: boolean;
}

/**
 * Two-step modal for AI-powered flashcard generation:
 *  1. Input — source text (5 000–10 000 chars), optional instructions, language,
 *     and model selection.
 *  2. Preview — editable list of AI-proposed cards; user approves the selection.
 */
export default function AiGenerateFlashcardsModal({ deckId, open, onClose, onCreated }: Props) {
  const [state, setState] = useState<ModalState>("input");
  const [sourceText, setSourceText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState<"auto" | "pl" | "en">("auto");
  const [model, setModel] = useState<"openai/gpt-4o-mini" | "anthropic/claude-3-haiku">("openai/gpt-4o-mini");
  const [cards, setCards] = useState<ProposedCard[]>([]);
  const [proposedCount, setProposedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => {
    setState("input");
    setSourceText("");
    setInstructions("");
    setLanguage("auto");
    setCards([]);
    setProposedCount(0);
    setErrorMessage("");
    onClose();
  }, [onClose]);

  // Focus source text area when modal opens.
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open]);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && (state === "input" || state === "error")) close();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open, state]);

  async function handleGenerate() {
    setState("generating");
    setErrorMessage("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceText,
          instructions: instructions.trim() || undefined,
          language,
          model,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        cards?: { frontText: string; backText: string }[];
        error?: { message?: string };
      };

      if (!res.ok) {
        setErrorMessage(body.error?.message ?? "Generation failed. Please try again.");
        setState("error");
        return;
      }

      const proposed = body.cards ?? [];
      setProposedCount(proposed.length);
      setCards(proposed.map((c, i) => ({ id: i, frontText: c.frontText, backText: c.backText, deleted: false })));
      setState("preview");
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setState("error");
    }
  }

  async function handleApprove() {
    const selected = cards.filter((c) => !c.deleted);
    if (selected.length === 0) return;
    setState("saving");
    try {
      const res = await fetch("/api/ai/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deckId,
          proposedCardsCount: proposedCount,
          model,
          cards: selected.map((c) => ({ frontText: c.frontText, backText: c.backText })),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        savedCards?: FlashcardDto[];
        error?: { message?: string };
      };

      if (!res.ok) {
        setErrorMessage(body.error?.message ?? "Failed to save flashcards. Please try again.");
        setState("error");
        return;
      }

      onCreated(body.savedCards ?? []);
      close();
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setState("error");
    }
  }

  function updateCard(id: number, field: "frontText" | "backText", value: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }

  function toggleDeleted(id: number) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, deleted: !c.deleted } : c)));
  }

  if (!open) return null;

  const sourceLen = sourceText.length;
  const canGenerate = sourceLen >= SOURCE_TEXT_MIN_LENGTH && sourceLen <= SOURCE_TEXT_MAX_LENGTH;
  const selectedCards = cards.filter((c) => !c.deleted);

  /** Character-count indicator colour for the source text area. */
  function sourceCountClass() {
    if (sourceLen < SOURCE_TEXT_MIN_LENGTH) return "text-amber-500 dark:text-amber-400";
    if (sourceLen > SOURCE_TEXT_MAX_LENGTH) return "text-red-500 dark:text-red-400";
    return "text-green-600 dark:text-green-400";
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onClick={(e) => {
        if (e.target === e.currentTarget && (state === "input" || state === "error")) close();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-gray-900">
        {/* ------------------------------------------------------------------ */}
        {/* STATE: input                                                        */}
        {/* ------------------------------------------------------------------ */}
        {state === "input" && (
          <div className="p-6">
            <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-white">Generate flashcards with AI</h2>
            <p className="mb-5 text-sm text-gray-500 dark:text-blue-100/60">
              Paste your study notes below. The AI will extract key concepts into flashcards for you.
            </p>

            {/* Source text */}
            <div className="mb-4">
              <label
                htmlFor="ai-source-text"
                className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40"
              >
                <span>Source text</span>
                <span className={sourceCountClass()}>
                  {sourceLen.toLocaleString()} / {SOURCE_TEXT_MAX_LENGTH.toLocaleString()}
                  {sourceLen < SOURCE_TEXT_MIN_LENGTH && (
                    <span className="ml-1">({(SOURCE_TEXT_MIN_LENGTH - sourceLen).toLocaleString()} more needed)</span>
                  )}
                </span>
              </label>
              <textarea
                id="ai-source-text"
                ref={textareaRef}
                value={sourceText}
                onChange={(e) => {
                  setSourceText(e.target.value);
                }}
                rows={10}
                placeholder={`Paste your study notes here (${SOURCE_TEXT_MIN_LENGTH.toLocaleString()}–${SOURCE_TEXT_MAX_LENGTH.toLocaleString()} characters)…`}
                className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
              />
            </div>

            {/* Optional instructions */}
            <div className="mb-4">
              <label
                htmlFor="ai-instructions"
                className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40"
              >
                <span>
                  Instructions{" "}
                  <span className="font-normal text-gray-400 normal-case dark:text-blue-100/30">(optional)</span>
                </span>
                <span className={instructions.length > INSTRUCTIONS_MAX_LENGTH ? "text-red-500" : ""}>
                  {instructions.length}/{INSTRUCTIONS_MAX_LENGTH}
                </span>
              </label>
              <input
                id="ai-instructions"
                type="text"
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                }}
                maxLength={INSTRUCTIONS_MAX_LENGTH}
                placeholder='e.g. "Focus only on dates and names"'
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-white/20 dark:bg-white/10 dark:text-white dark:placeholder:text-blue-100/40 dark:focus:ring-blue-400/50"
              />
            </div>

            {/* Language + model selectors */}
            <div className="mb-6 grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="ai-language"
                  className="mb-1 block text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40"
                >
                  Language
                </label>
                <select
                  id="ai-language"
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value as typeof language);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-white/20 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-400/50"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="pl">Polish</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="ai-model"
                  className="mb-1 block text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40"
                >
                  Model
                </label>
                <select
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value as typeof model)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/50 focus:outline-none dark:border-white/20 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-400/50"
                >
                  <option value="openai/gpt-4o-mini">GPT-4o mini</option>
                  <option value="anthropic/claude-3-haiku">Claude 3 Haiku</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!canGenerate}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-purple-500/30 dark:text-purple-100 dark:hover:bg-purple-500/50"
              >
                <svg
                  className="h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
                Generate
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE: generating                                                   */}
        {/* ------------------------------------------------------------------ */}
        {state === "generating" && (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            {/* Spinner */}
            <svg
              className="h-10 w-10 animate-spin text-purple-600 dark:text-purple-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <div>
              <p className="text-base font-semibold text-gray-900 dark:text-white">Generating flashcards…</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-blue-100/60">This may take a moment.</p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE: error                                                        */}
        {/* ------------------------------------------------------------------ */}
        {state === "error" && (
          <div className="p-6">
            <div className="mb-5 rounded-xl border border-red-300 bg-red-50 px-4 py-4 dark:border-red-400/30 dark:bg-red-500/10">
              <p className="mb-1 font-semibold text-red-700 dark:text-red-300">Generation failed</p>
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            </div>

            <p className="mb-4 text-sm text-gray-600 dark:text-blue-100/60">
              You can try again, or{" "}
              <button
                type="button"
                onClick={close}
                className="font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                add flashcards manually
              </button>{" "}
              instead.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setState("input");
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm text-white transition-colors hover:bg-purple-700 dark:bg-purple-500/30 dark:text-purple-100 dark:hover:bg-purple-500/50"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE: preview                                                      */}
        {/* ------------------------------------------------------------------ */}
        {(state === "preview" || state === "saving") && (
          <div className="p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Review generated flashcards</h2>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-blue-100/60">
                  {selectedCards.length} of {cards.length} selected — edit or remove cards before saving.
                </p>
              </div>
            </div>

            <div className="mb-5 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className={[
                    "rounded-xl border p-4 transition-opacity",
                    card.deleted
                      ? "border-gray-200 opacity-40 dark:border-white/10"
                      : "border-gray-200 dark:border-white/10",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-blue-100/40">
                      Card {card.id + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        toggleDeleted(card.id);
                      }}
                      title={card.deleted ? "Restore card" : "Remove card"}
                      className={[
                        "rounded p-1 transition-colors",
                        card.deleted
                          ? "text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-500/10"
                          : "text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10",
                      ].join(" ")}
                    >
                      {card.deleted ? (
                        /* Restore icon */
                        <svg
                          className="h-4 w-4"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                      ) : (
                        /* Trash icon */
                        <svg
                          className="h-4 w-4"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      )}
                    </button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-0.5 block text-xs text-gray-400 dark:text-blue-100/40">Front</label>
                      <textarea
                        value={card.frontText}
                        onChange={(e) => {
                          updateCard(card.id, "frontText", e.target.value);
                        }}
                        disabled={card.deleted || state === "saving"}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:ring-blue-400/50"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs text-gray-400 dark:text-blue-100/40">Back</label>
                      <textarea
                        value={card.backText}
                        onChange={(e) => {
                          updateCard(card.id, "backText", e.target.value);
                        }}
                        disabled={card.deleted || state === "saving"}
                        rows={3}
                        className="w-full resize-y rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:ring-blue-400/50"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setState("input");
                }}
                disabled={state === "saving"}
                className="cursor-pointer rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-blue-100/70 dark:hover:bg-white/10"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={selectedCards.length === 0 || state === "saving"}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500/30 dark:text-blue-100 dark:hover:bg-blue-500/50"
              >
                {state === "saving" ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Saving…
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Approve and save {selectedCards.length} card{selectedCards.length !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
