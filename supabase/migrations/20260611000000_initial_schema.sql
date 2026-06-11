-- =============================================================================
-- Migration: initial_schema
-- Date: 2026-06-11
-- Purpose: Create the complete initial database schema for AI Flashcard Generator.
-- Tables: users_profiles, decks, flashcards, ai_generation_logs
-- Functions: set_updated_at, handle_new_user, enforce_deck_limit,
--            set_flashcard_user_id_from_deck, approve_ai_generated_flashcards
-- RLS: enabled on all domain tables with granular per-role, per-operation policies
-- Special considerations:
--   - Free tier AI credit limit is set to 100 proposed cards/month.
--     Finalize this value before going to production.
--   - flashcards.user_id is intentionally denormalized (see db.md §6, note 1).
--   - Pasted source text and AI errors are NEVER stored in the database.
-- =============================================================================


-- =============================================================================
-- TABLE: public.users_profiles
-- =============================================================================
-- Application-level profile that extends auth.users one-to-one.
-- Rows are created automatically by the handle_new_user trigger.
-- Direct inserts and deletes by users are disallowed via RLS.
create table public.users_profiles (
    id                    uuid           primary key references auth.users (id) on delete cascade,
    plan_type             text           not null default 'free'
                                         check (plan_type in ('free')),
    -- NOTE: free monthly proposed-card limit; finalize before production
    ai_credits_limit      integer        not null default 100
                                         check (ai_credits_limit >= 0),
    ai_credits_used       integer        not null default 0
                                         check (ai_credits_used >= 0),
    ai_credits_reset_date date           not null,
    created_at            timestamptz    not null default now(),
    updated_at            timestamptz    not null default now(),

    -- credits used must never exceed the plan limit
    constraint ai_credits_used_lte_limit check (ai_credits_used <= ai_credits_limit)
);

comment on table public.users_profiles is
    'Application-level profile for each Supabase Auth user. Created automatically via trigger.';


-- =============================================================================
-- TABLE: public.decks
-- =============================================================================
-- User-owned flashcard decks. Each deck belongs to exactly one user.
-- Maximum 120 decks per user is enforced by the enforce_deck_limit trigger.
create table public.decks (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        not null references public.users_profiles (id) on delete cascade,
    name        text        not null check (length(trim(name)) > 0),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

comment on table public.decks is
    'User-owned flashcard decks. Maximum 120 per user, enforced by trigger.';


-- =============================================================================
-- TABLE: public.flashcards
-- =============================================================================
-- Stores both manual and AI-generated flashcards.
-- user_id is intentionally denormalized from decks.user_id for simpler RLS
-- and efficient due-card queries. It is set automatically via trigger on insert
-- and cannot be changed by moving a card to a different deck (MVP restriction).
-- SM-2 fields represent the spaced-repetition scheduling state.
create table public.flashcards (
    id                uuid           primary key default gen_random_uuid(),
    user_id           uuid           not null references public.users_profiles (id) on delete cascade,
    deck_id           uuid           not null references public.decks (id) on delete cascade,

    -- card content
    -- NOTE: front_text max length set to 500 chars; finalize before production
    front_text        text           not null
                                     check (length(trim(front_text)) > 0
                                            and char_length(front_text) <= 500),
    back_text         text           not null
                                     check (length(trim(back_text)) > 0
                                            and char_length(back_text) <= 3000),

    -- represents the original creation source; unchanged after user edits
    created_by_ai     boolean        not null default false,

    -- SM-2 spaced repetition fields
    sm2_interval      integer        not null default 0     check (sm2_interval >= 0),
    sm2_repetition    integer        not null default 0     check (sm2_repetition >= 0),
    sm2_ease_factor   numeric(4,2)   not null default 2.50  check (sm2_ease_factor > 0),
    due_at            date           not null default current_date,
    last_reviewed_at  date,

    created_at        timestamptz    not null default now(),
    updated_at        timestamptz    not null default now()
);

comment on table public.flashcards is
    'Flashcards belonging to a deck. user_id is denormalized for RLS and due-card query performance.';


-- =============================================================================
-- TABLE: public.ai_generation_logs
-- =============================================================================
-- Append-only metadata for successful AI flashcard generation events.
-- Does NOT store: source text, custom prompt, detected language,
--                 AI errors, timeout details, or content-filter results.
-- deck_id uses ON DELETE SET NULL so analytics survive deck deletion.
create table public.ai_generation_logs (
    id                    uuid        primary key default gen_random_uuid(),
    user_id               uuid        not null references public.users_profiles (id) on delete cascade,
    -- nullable: ON DELETE SET NULL preserves the log when the deck is deleted
    deck_id               uuid        references public.decks (id) on delete set null,
    proposed_cards_count  integer     not null check (proposed_cards_count >= 0),
    saved_cards_count     integer     not null check (saved_cards_count >= 0),
    model                 text        not null,
    created_at            timestamptz not null default now(),

    -- saved count cannot exceed the number of cards that were proposed
    constraint saved_lte_proposed check (saved_cards_count <= proposed_cards_count)
);

comment on table public.ai_generation_logs is
    'Append-only metadata for successful AI generation events. No source text or errors stored.';


-- =============================================================================
-- INDEXES
-- =============================================================================

-- decks: list a user's decks ordered by creation time
create index idx_decks_user_id_created_at  on public.decks (user_id, created_at);
-- decks: dashboard view sorted by most-recently updated deck
create index idx_decks_user_id_updated_at  on public.decks (user_id, updated_at);

-- flashcards: list all cards inside a deck in creation order
create index idx_flashcards_deck_id_created_at    on public.flashcards (deck_id, created_at);
-- flashcards: study mode — find cards due today for the authenticated user
create index idx_flashcards_user_id_due_at        on public.flashcards (user_id, due_at);
-- flashcards: AI adoption-rate analytics
create index idx_flashcards_user_id_created_by_ai on public.flashcards (user_id, created_by_ai);

-- ai_generation_logs: AI usage history and monthly credit lookups
create index idx_ai_logs_user_id_created_at on public.ai_generation_logs (user_id, created_at);
-- ai_generation_logs: deck-level AI generation analytics
create index idx_ai_logs_deck_id_created_at on public.ai_generation_logs (deck_id, created_at);

-- optional indexes for common access patterns
-- flashcards: study mode scoped to a single deck
create index idx_flashcards_deck_id_due_at   on public.flashcards (deck_id, due_at);
-- flashcards: validate and query user-owned cards by deck
create index idx_flashcards_user_id_deck_id  on public.flashcards (user_id, deck_id);


-- =============================================================================
-- FUNCTION: set_updated_at()
-- =============================================================================
-- Generic trigger function that sets updated_at = now() on any update.
-- Attached to all mutable domain tables.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- attach to users_profiles
create trigger trg_users_profiles_updated_at
    before update on public.users_profiles
    for each row execute function public.set_updated_at();

-- attach to decks
create trigger trg_decks_updated_at
    before update on public.decks
    for each row execute function public.set_updated_at();

-- attach to flashcards
create trigger trg_flashcards_updated_at
    before update on public.flashcards
    for each row execute function public.set_updated_at();


-- =============================================================================
-- FUNCTION + TRIGGER: handle_new_user()
-- =============================================================================
-- Creates a users_profiles row immediately after a new auth.users row is
-- inserted (i.e., after every new sign-up).
-- Sets the initial AI credit allowance and the first monthly reset date.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.users_profiles (
        id,
        plan_type,
        ai_credits_limit,
        ai_credits_used,
        -- reset date is the same calendar date one month after sign-up
        ai_credits_reset_date
    ) values (
        new.id,
        'free',
        100,    -- free tier monthly proposed-card limit; finalize before production
        0,
        (now() + interval '1 month')::date
    );
    return new;
end;
$$;

create trigger trg_on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- =============================================================================
-- FUNCTION + TRIGGER: enforce_deck_limit()
-- =============================================================================
-- Prevents a user from owning more than 120 decks.
-- Fires before each INSERT on public.decks and raises an exception
-- if the user already has 120 or more decks.
create or replace function public.enforce_deck_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deck_count integer;
begin
    select count(*)
    into   v_deck_count
    from   public.decks
    where  user_id = new.user_id;

    if v_deck_count >= 120 then
        raise exception
            'Deck limit reached: a user may own at most 120 decks.';
    end if;

    return new;
end;
$$;

create trigger trg_enforce_deck_limit
    before insert on public.decks
    for each row execute function public.enforce_deck_limit();


-- =============================================================================
-- FUNCTION + TRIGGER: set_flashcard_user_id_from_deck()
-- =============================================================================
-- Ensures flashcards.user_id always matches the owner of the referenced deck.
-- On INSERT: derives user_id from decks.user_id, preventing the client from
--            supplying an arbitrary user_id.
-- On UPDATE: blocks changing deck_id (moving cards between decks is out of
--            scope for MVP).
create or replace function public.set_flashcard_user_id_from_deck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deck_owner uuid;
begin
    if tg_op = 'INSERT' then
        -- derive user_id from the deck owner; reject if deck does not exist
        select user_id
        into   v_deck_owner
        from   public.decks
        where  id = new.deck_id;

        if v_deck_owner is null then
            raise exception 'Referenced deck does not exist.';
        end if;

        new.user_id = v_deck_owner;

    elsif tg_op = 'UPDATE' then
        -- moving a flashcard to a different deck is not supported in MVP
        if new.deck_id <> old.deck_id then
            raise exception
                'Moving a flashcard to a different deck is not supported.';
        end if;
    end if;

    return new;
end;
$$;

create trigger trg_set_flashcard_user_id
    before insert or update on public.flashcards
    for each row execute function public.set_flashcard_user_id_from_deck();


-- =============================================================================
-- FUNCTION: approve_ai_generated_flashcards(...)
-- =============================================================================
-- Transactionally saves selected AI-generated flashcards and records the
-- generation event in ai_generation_logs.
--
-- Credit accounting: ai_credits_used is incremented by p_proposed_count
-- (the number of cards the AI proposed), NOT by the number saved.
-- This prevents gaming the system by rejecting cards to save credits.
--
-- Parameters:
--   p_deck_id        uuid   — target deck owned by the caller
--   p_cards          jsonb  — array of {front_text, back_text} objects to save
--   p_proposed_count integer — total cards proposed by the AI in this session
--   p_model          text   — AI model identifier used for generation
create or replace function public.approve_ai_generated_flashcards(
    p_deck_id        uuid,
    p_cards          jsonb,
    p_proposed_count integer,
    p_model          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id       uuid;
    v_credits_used  integer;
    v_credits_limit integer;
    v_saved_count   integer;
    v_card          jsonb;
begin
    -- resolve the calling user from the session JWT
    v_user_id = auth.uid();
    if v_user_id is null then
        raise exception 'Not authenticated.';
    end if;

    -- verify the caller owns the target deck
    if not exists (
        select 1
        from   public.decks
        where  id = p_deck_id and user_id = v_user_id
    ) then
        raise exception 'Deck not found or access denied.';
    end if;

    -- validate proposed count
    if p_proposed_count < 0 then
        raise exception 'p_proposed_count must be >= 0.';
    end if;

    -- validate saved count does not exceed proposed count
    v_saved_count = jsonb_array_length(p_cards);
    if v_saved_count > p_proposed_count then
        raise exception
            'saved_cards_count (%) cannot exceed proposed_cards_count (%).',
            v_saved_count, p_proposed_count;
    end if;

    -- check that the user has sufficient AI credits
    select ai_credits_used, ai_credits_limit
    into   v_credits_used, v_credits_limit
    from   public.users_profiles
    where  id = v_user_id;

    if (v_credits_used + p_proposed_count) > v_credits_limit then
        raise exception
            'Insufficient AI credits. Used: %, Limit: %, Requested: %.',
            v_credits_used, v_credits_limit, p_proposed_count;
    end if;

    -- insert selected flashcards
    -- user_id will be set automatically by set_flashcard_user_id_from_deck trigger
    for v_card in select * from jsonb_array_elements(p_cards) loop
        insert into public.flashcards (deck_id, front_text, back_text, created_by_ai)
        values (
            p_deck_id,
            v_card->>'front_text',
            v_card->>'back_text',
            true
        );
    end loop;

    -- debit the proposed count (not the saved count) from the user's credits
    update public.users_profiles
    set    ai_credits_used = ai_credits_used + p_proposed_count
    where  id = v_user_id;

    -- record the generation event
    insert into public.ai_generation_logs (
        user_id,
        deck_id,
        proposed_cards_count,
        saved_cards_count,
        model
    ) values (
        v_user_id,
        p_deck_id,
        p_proposed_count,
        v_saved_count,
        p_model
    );
end;
$$;


-- =============================================================================
-- ROW LEVEL SECURITY: public.users_profiles
-- =============================================================================
alter table public.users_profiles enable row level security;

-- select: each user can only read their own profile row
create policy "users_profiles: anon cannot select"
    on public.users_profiles for select to anon
    using (false);

create policy "users_profiles: authenticated can select own"
    on public.users_profiles for select to authenticated
    using (id = auth.uid());

-- insert: profile creation is handled exclusively by the handle_new_user trigger;
--         direct inserts from any role are blocked
create policy "users_profiles: anon cannot insert"
    on public.users_profiles for insert to anon
    with check (false);

create policy "users_profiles: authenticated cannot insert directly"
    on public.users_profiles for insert to authenticated
    with check (false);

-- update: users may update only their own row;
--         sensitive credit fields (ai_credits_limit, ai_credits_used,
--         ai_credits_reset_date) should be modified only via controlled RPCs
create policy "users_profiles: anon cannot update"
    on public.users_profiles for update to anon
    using (false);

create policy "users_profiles: authenticated can update own"
    on public.users_profiles for update to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- delete: account deletion is handled through Supabase Auth admin flow only;
--         direct deletes from any role are blocked
create policy "users_profiles: anon cannot delete"
    on public.users_profiles for delete to anon
    using (false);

create policy "users_profiles: authenticated cannot delete"
    on public.users_profiles for delete to authenticated
    using (false);


-- =============================================================================
-- ROW LEVEL SECURITY: public.decks
-- =============================================================================
alter table public.decks enable row level security;

-- select: users can only list their own decks
create policy "decks: anon cannot select"
    on public.decks for select to anon
    using (false);

create policy "decks: authenticated can select own"
    on public.decks for select to authenticated
    using (user_id = auth.uid());

-- insert: users can only create decks for themselves;
--         the enforce_deck_limit trigger additionally caps at 120 decks
create policy "decks: anon cannot insert"
    on public.decks for insert to anon
    with check (false);

create policy "decks: authenticated can insert own"
    on public.decks for insert to authenticated
    with check (user_id = auth.uid());

-- update: users can only rename or modify their own decks
create policy "decks: anon cannot update"
    on public.decks for update to anon
    using (false);

create policy "decks: authenticated can update own"
    on public.decks for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- delete: users can only delete their own decks
create policy "decks: anon cannot delete"
    on public.decks for delete to anon
    using (false);

create policy "decks: authenticated can delete own"
    on public.decks for delete to authenticated
    using (user_id = auth.uid());


-- =============================================================================
-- ROW LEVEL SECURITY: public.flashcards
-- =============================================================================
alter table public.flashcards enable row level security;

-- select: users can only read their own flashcards
create policy "flashcards: anon cannot select"
    on public.flashcards for select to anon
    using (false);

create policy "flashcards: authenticated can select own"
    on public.flashcards for select to authenticated
    using (user_id = auth.uid());

-- insert: user_id is derived from deck ownership by the trigger;
--         the WITH CHECK confirms the final row is owned by the caller and
--         that the target deck belongs to them
create policy "flashcards: anon cannot insert"
    on public.flashcards for insert to anon
    with check (false);

create policy "flashcards: authenticated can insert into own decks"
    on public.flashcards for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (
            select 1 from public.decks
            where id = deck_id and user_id = auth.uid()
        )
    );

-- update: users can update their own flashcards (SM-2 fields and text);
--         changing deck_id is blocked by the set_flashcard_user_id_from_deck trigger
create policy "flashcards: anon cannot update"
    on public.flashcards for update to anon
    using (false);

create policy "flashcards: authenticated can update own"
    on public.flashcards for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

-- delete: users can delete their own flashcards
create policy "flashcards: anon cannot delete"
    on public.flashcards for delete to anon
    using (false);

create policy "flashcards: authenticated can delete own"
    on public.flashcards for delete to authenticated
    using (user_id = auth.uid());


-- =============================================================================
-- ROW LEVEL SECURITY: public.ai_generation_logs
-- =============================================================================
alter table public.ai_generation_logs enable row level security;

-- select: users can only view their own generation logs
create policy "ai_generation_logs: anon cannot select"
    on public.ai_generation_logs for select to anon
    using (false);

create policy "ai_generation_logs: authenticated can select own"
    on public.ai_generation_logs for select to authenticated
    using (user_id = auth.uid());

-- insert: rows are normally created via approve_ai_generated_flashcards (security definer);
--         direct inserts are allowed only for the row owner as a fallback,
--         but prefer going through the RPC to ensure credit accounting
create policy "ai_generation_logs: anon cannot insert"
    on public.ai_generation_logs for insert to anon
    with check (false);

create policy "ai_generation_logs: authenticated can insert own"
    on public.ai_generation_logs for insert to authenticated
    with check (user_id = auth.uid());

-- update: logs are append-only; no role may update them
create policy "ai_generation_logs: anon cannot update"
    on public.ai_generation_logs for update to anon
    using (false);

create policy "ai_generation_logs: authenticated cannot update"
    on public.ai_generation_logs for update to authenticated
    using (false);

-- delete: log lifecycle is controlled by cascade or admin policy only
create policy "ai_generation_logs: anon cannot delete"
    on public.ai_generation_logs for delete to anon
    using (false);

create policy "ai_generation_logs: authenticated cannot delete"
    on public.ai_generation_logs for delete to authenticated
    using (false);
