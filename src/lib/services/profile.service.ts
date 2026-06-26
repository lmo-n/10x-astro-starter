import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GetAiCreditsResponseDto,
  GetProfileResponseDto,
  ProfileDto,
  ProfileStatsDto,
  UsersProfileRow,
} from "@/types";
import { DECK_LIMIT } from "@/lib/services/deck.service";

/** Error codes surfaced by the profile service so the route can map them to HTTP. */
export type ProfileServiceErrorCode = "PROFILE_NOT_FOUND" | "PROFILE_FETCH_FAILED";

/**
 * Domain error thrown by the profile service. The `code` is mapped to an HTTP
 * status / `ApiErrorDto.error.code` by the route handler.
 */
export class ProfileServiceError extends Error {
  readonly code: ProfileServiceErrorCode;

  constructor(code: ProfileServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProfileServiceError";
    this.code = code;
  }
}

/**
 * Map a `users_profiles` row to the public `ProfileDto`: snake_case columns are
 * remapped to camelCase, internal fields are dropped, and the computed
 * `aiCreditsRemaining` (`ai_credits_limit - ai_credits_used`) is added.
 */
function mapProfileRow(row: UsersProfileRow): ProfileDto {
  return {
    id: row.id,
    planType: row.plan_type,
    aiCreditsLimit: row.ai_credits_limit,
    aiCreditsUsed: row.ai_credits_used,
    aiCreditsRemaining: row.ai_credits_limit - row.ai_credits_used,
    aiCreditsResetDate: row.ai_credits_reset_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch the authenticated user's profile together with dashboard counters.
 *
 * Runs one profile select plus four `head`-only count queries in parallel
 * (`Promise.all`) to minimize latency. All reads are scoped by `id`/`user_id`
 * (defence in depth with RLS), so a user can only read their own data.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes reads to the user).
 * @param userId   Owner id, always derived from the session — never the request.
 * @throws {ProfileServiceError} `PROFILE_NOT_FOUND` when no profile row exists;
 *         `PROFILE_FETCH_FAILED` for any query failure.
 */
export async function getProfile(supabase: SupabaseClient, userId: string): Promise<GetProfileResponseDto> {
  // `due_at` is a `date`; compare against today's date (`YYYY-MM-DD`).
  const today = new Date().toISOString().slice(0, 10);

  const [profileResult, deckCountResult, totalCardsResult, dueCardsResult, aiCardsResult] = await Promise.all([
    supabase
      .from("users_profiles")
      .select("id, plan_type, ai_credits_limit, ai_credits_used, ai_credits_reset_date, created_at, updated_at")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("decks").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("flashcards").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("flashcards").select("id", { count: "exact", head: true }).eq("user_id", userId).lte("due_at", today),
    supabase
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("created_by_ai", true),
  ]);

  // Surface any query failure as a single generic 500-class error.
  const queryError =
    profileResult.error ??
    deckCountResult.error ??
    totalCardsResult.error ??
    dueCardsResult.error ??
    aiCardsResult.error;
  if (queryError) {
    throw new ProfileServiceError("PROFILE_FETCH_FAILED", "Failed to load profile.", { cause: queryError });
  }

  // The profile row is created by the `handle_new_user()` trigger; a missing row
  // is an exceptional state surfaced as 404.
  if (!profileResult.data) {
    throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.");
  }

  const profile = mapProfileRow(profileResult.data);

  const stats: ProfileStatsDto = {
    deckCount: deckCountResult.count ?? 0,
    deckLimit: DECK_LIMIT,
    dueFlashcardsCount: dueCardsResult.count ?? 0,
    totalFlashcardsCount: totalCardsResult.count ?? 0,
    aiCreatedFlashcardsCount: aiCardsResult.count ?? 0,
  };

  return { profile, stats };
}

/**
 * Fetch the authenticated user's AI credit status for the generation UI.
 *
 * Runs a single lightweight `SELECT` with only the three credit columns —
 * no aggregate counts needed.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes reads to the user).
 * @param userId   Owner id, always derived from the session — never the request.
 * @throws {ProfileServiceError} `PROFILE_NOT_FOUND` when no profile row exists;
 *         `PROFILE_FETCH_FAILED` for any query failure.
 */
export async function getAiCredits(supabase: SupabaseClient, userId: string): Promise<GetAiCreditsResponseDto> {
  const { data, error } = await supabase
    .from("users_profiles")
    .select("ai_credits_limit, ai_credits_used, ai_credits_reset_date")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new ProfileServiceError("PROFILE_FETCH_FAILED", "Failed to load AI credits.", { cause: error });
  }

  if (!data) {
    throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found.");
  }

  const limit: number = data.ai_credits_limit;
  const used: number = data.ai_credits_used;
  const remaining = Math.max(0, limit - used);
  const message =
    remaining === 0
      ? "You have used all your AI generations for this period."
      : `You can generate ${remaining} more flashcard${remaining === 1 ? "" : "s"} this period.`;

  return {
    aiCredits: {
      limit,
      used,
      remaining,
      resetDate: data.ai_credits_reset_date,
      message,
    },
  };
}
