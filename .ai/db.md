```markdown
# AI Flashcard Generator: Database Schema

## 1. Tables, Columns, Data Types, and Constraints

### `public.users_profiles`

Application-level profile table extending Supabase Auth users.

| Column                  | Type          | Constraints                                                            |
| ----------------------- | ------------- | ---------------------------------------------------------------------- |
| `id`                    | `uuid`        | Primary key, foreign key references `auth.users(id)` on delete cascade |
| `plan_type`             | `text`        | Not null, default `'free'`, check `plan_type IN ('free')`              |
| `ai_credits_limit`      | `integer`     | Not null, default value to be finalized, check `ai_credits_limit >= 0` |
| `ai_credits_used`       | `integer`     | Not null, default `0`, check `ai_credits_used >= 0`                    |
| `ai_credits_reset_date` | `date`        | Not null                                                               |
| `created_at`            | `timestamptz` | Not null, default `now()`                                              |
| `updated_at`            | `timestamptz` | Not null, default `now()`                                              |

Additional constraints:

- `ai_credits_used <= ai_credits_limit`
- One row per authenticated user.
- Created automatically after a new Supabase Auth user is created.

---

### `public.decks`

Stores user-owned flashcard decks.

| Column       | Type          | Constraints                                                                    |
| ------------ | ------------- | ------------------------------------------------------------------------------ |
| `id`         | `uuid`        | Primary key, default generated UUID                                            |
| `user_id`    | `uuid`        | Not null, foreign key references `public.users_profiles(id)` on delete cascade |
| `name`       | `text`        | Not null                                                                       |
| `created_at` | `timestamptz` | Not null, default `now()`                                                      |
| `updated_at` | `timestamptz` | Not null, default `now()`                                                      |

Additional constraints:

- `length(trim(name)) > 0`
- No uniqueness constraint on `(user_id, name)`.
- A user may have a maximum of 120 decks.
- The 120-deck limit must be enforced at the database layer, preferably through a trigger or controlled RPC.

---

### `public.flashcards`

Stores both manual and AI-generated flashcards.

| Column             | Type           | Constraints                                                                    |
| ------------------ | -------------- | ------------------------------------------------------------------------------ |
| `id`               | `uuid`         | Primary key, default generated UUID                                            |
| `user_id`          | `uuid`         | Not null, foreign key references `public.users_profiles(id)` on delete cascade |
| `deck_id`          | `uuid`         | Not null, foreign key references `public.decks(id)` on delete cascade          |
| `front_text`       | `text`         | Not null                                                                       |
| `back_text`        | `text`         | Not null                                                                       |
| `created_by_ai`    | `boolean`      | Not null, default `false`                                                      |
| `sm2_interval`     | `integer`      | Not null, default `0`, check `sm2_interval >= 0`                               |
| `sm2_repetition`   | `integer`      | Not null, default `0`, check `sm2_repetition >= 0`                             |
| `sm2_ease_factor`  | `numeric(4,2)` | Not null, default `2.50`, check `sm2_ease_factor > 0`                          |
| `due_at`           | `date`         | Not null, default `current_date`                                               |
| `last_reviewed_at` | `date`         | Nullable                                                                       |
| `created_at`       | `timestamptz`  | Not null, default `now()`                                                      |
| `updated_at`       | `timestamptz`  | Not null, default `now()`                                                      |

Additional constraints:

- `length(trim(front_text)) > 0`
- `length(trim(back_text)) > 0`
- `char_length(front_text) <= 500`
- `char_length(back_text) <= 3000`
- `user_id` must match the owner of `deck_id`.
- `user_id` should be set automatically from `decks.user_id` using a trigger or RPC.
- Moving flashcards between decks is out of scope for MVP.
- Updating `front_text` or `back_text` must not reset SM-2 fields.
- `created_by_ai` represents the original creation source and remains unchanged after later user edits.

---

### `public.ai_generation_logs`

Stores metadata for successful AI flashcard generation only.

| Column                 | Type          | Constraints                                                                    |
| ---------------------- | ------------- | ------------------------------------------------------------------------------ |
| `id`                   | `uuid`        | Primary key, default generated UUID                                            |
| `user_id`              | `uuid`        | Not null, foreign key references `public.users_profiles(id)` on delete cascade |
| `deck_id`              | `uuid`        | Nullable, foreign key references `public.decks(id)`                            |
| `proposed_cards_count` | `integer`     | Not null, check `proposed_cards_count >= 0`                                    |
| `saved_cards_count`    | `integer`     | Not null, check `saved_cards_count >= 0`                                       |
| `model`                | `text`        | Not null                                                                       |
| `created_at`           | `timestamptz` | Not null, default `now()`                                                      |

Additional constraints:

- `saved_cards_count <= proposed_cards_count`
- Stores successful generation metadata only.
- Does not store pasted source text.
- Does not store custom user prompt/instructions.
- Does not store detected language.
- Does not store AI errors, timeout details, or content filter results.
- Recommended `deck_id` behavior: `ON DELETE SET NULL` if analytics should survive deck deletion, or `ON DELETE CASCADE` if all deck-related metadata should be removed with the deck.

---

## 2. Relationships Between Tables

### `auth.users` to `public.users_profiles`

**Cardinality:** one-to-one.

- Each Supabase Auth user has exactly one application profile.
- `users_profiles.id` references `auth.users.id`.
- Profile rows should be created automatically through a `handle_new_user()` trigger.

---

### `public.users_profiles` to `public.decks`

**Cardinality:** one-to-many.

- One user can own many decks.
- Each deck belongs to exactly one user.
- A user can own at most 120 decks.
- Deleting a user cascades to their decks.

---

### `public.decks` to `public.flashcards`

**Cardinality:** one-to-many.

- One deck can contain many flashcards.
- Each flashcard belongs to exactly one deck.
- Deleting a deck physically deletes its flashcards.

---

### `public.users_profiles` to `public.flashcards`

**Cardinality:** one-to-many, denormalized for security and performance.

- One user owns many flashcards.
- Each flashcard stores `user_id` directly.
- This is intentionally denormalized even though ownership can be derived through `deck_id`.
- The denormalization simplifies RLS and due-card queries.

---

### `public.users_profiles` to `public.ai_generation_logs`

**Cardinality:** one-to-many.

- One user can have many successful AI generation logs.
- Each log belongs to exactly one user.

---

### `public.decks` to `public.ai_generation_logs`

**Cardinality:** one-to-many, optional from the log side.

- One deck can have many AI generation logs.
- Each log may reference one deck.
- `deck_id` can be nullable if analytics should remain after deck deletion.

---

## 3. Indexes

### Recommended Indexes

1. `users_profiles(id)`

   Primary key index, created automatically.

2. `decks(user_id, created_at)`

   Supports listing a user’s decks in creation order.

3. `decks(user_id, updated_at)`

   Supports dashboard views sorted by recent activity.

4. `flashcards(deck_id, created_at)`

   Supports listing cards inside a deck.

5. `flashcards(user_id, due_at)`

   Supports study mode by finding due cards for the authenticated user.

6. `flashcards(user_id, created_by_ai)`

   Supports AI adoption-rate analytics.

7. `ai_generation_logs(user_id, created_at)`

   Supports AI usage history and monthly credit-related lookups.

8. `ai_generation_logs(deck_id, created_at)`

   Supports deck-level AI generation analytics, if needed.

### Optional Indexes

1. `flashcards(deck_id, due_at)`

   Useful if study mode is commonly scoped to one deck.

2. `flashcards(user_id, deck_id)`

   Useful for validating and querying user-owned cards by deck.

---

## 4. PostgreSQL Policies and Security

### General RLS Requirement

Enable RLS on all domain tables:

- `public.users_profiles`
- `public.decks`
- `public.flashcards`
- `public.ai_generation_logs`

All policies should use `auth.uid()` and prevent users from reading or modifying records owned by another user.

---

### `public.users_profiles` RLS

#### Select Policy

- Users can select only their own profile.
- Condition: `id = auth.uid()`

#### Update Policy

- Users can update only their own profile.
- Condition: `id = auth.uid()`
- Recommended restriction: users should not directly update sensitive limit fields such as `ai_credits_limit`, `ai_credits_used`, or `ai_credits_reset_date` unless done through controlled functions.

#### Insert Policy

- Direct user inserts should generally be disallowed.
- Profile creation should happen through a trusted `handle_new_user()` trigger.

#### Delete Policy

- Direct user deletes should generally be disallowed.
- Account deletion should be handled through Supabase Auth/admin flow.

---

### `public.decks` RLS

#### Select Policy

- Users can select decks where `user_id = auth.uid()`.

#### Insert Policy

- Users can insert decks only for themselves.
- Condition: `user_id = auth.uid()`.
- The database must also enforce the 120-deck limit.

#### Update Policy

- Users can update only decks where `user_id = auth.uid()`.

#### Delete Policy

- Users can delete only decks where `user_id = auth.uid()`.

---

### `public.flashcards` RLS

#### Select Policy

- Users can select flashcards where `user_id = auth.uid()`.

#### Insert Policy

- Users can insert flashcards only into their own decks.
- Recommended implementation: use an RPC or trigger that derives `user_id` from `deck_id`.
- The frontend should not be trusted to provide `user_id`.

#### Update Policy

- Users can update flashcards where `user_id = auth.uid()`.
- Updating text must not reset SM-2 fields.
- Moving a card to another deck is out of scope and should be blocked or tightly restricted.

#### Delete Policy

- Users can delete flashcards where `user_id = auth.uid()`.

---

### `public.ai_generation_logs` RLS

#### Select Policy

- Users can select logs where `user_id = auth.uid()`.

#### Insert Policy

- Direct inserts should preferably happen through the AI approve-and-save RPC.
- If direct inserts are allowed, they must require `user_id = auth.uid()` and a user-owned `deck_id`.

#### Update Policy

- Updates should generally be disallowed.
- AI generation logs are append-only metadata.

#### Delete Policy

- Deletes should generally be disallowed for users.
- Log lifecycle should be controlled by retention policy or cascade behavior.

---

## 5. Required Functions and Triggers

### 1. `handle_new_user()`

**Purpose:**

- Create one `users_profiles` row after a new `auth.users` row is created.

**Behavior:**

- Set `id = new.id`.
- Set `plan_type = 'free'`.
- Set `ai_credits_used = 0`.
- Set `ai_credits_limit` to the configured free monthly proposed-card limit.
- Set `ai_credits_reset_date` based on account creation date plus one month, or the chosen monthly reset rule.

---

### 2. `set_updated_at()`

**Purpose:**

- Maintain `updated_at` automatically on mutable tables.

**Applies to:**

- `users_profiles`
- `decks`
- `flashcards`

---

### 3. `enforce_deck_limit()`

**Purpose:**

- Prevent creating a 121st deck for a user.

**Behavior:**

- Before insert on `decks`, count existing decks for `new.user_id`.
- Reject insert if count is already 120 or greater.

---

### 4. `set_flashcard_user_id_from_deck()`

**Purpose:**

- Ensure `flashcards.user_id` always matches the owner of the referenced deck.

**Behavior:**

- Before insert on `flashcards`, read `decks.user_id` for `new.deck_id`.
- Set `new.user_id` to the deck owner.
- On update, prevent changing `deck_id` for MVP or ensure the new deck belongs to the same user.

---

### 5. `approve_ai_generated_flashcards(...)`

**Purpose:**

- Transactionally save selected AI-generated cards and log generation metadata.

**Behavior:**

- Validate the authenticated user owns the target deck.
- Validate proposed and saved counts.
- Validate AI credit availability using proposed card count.
- Insert selected flashcards with `created_by_ai = true`.
- Increment `users_profiles.ai_credits_used` by `proposed_cards_count`.
- Insert one `ai_generation_logs` row.
- Do not store source text, prompt text, language, or AI error details.

---

## 6. Additional Notes and Design Explanations

1. The schema is normalized for the MVP, with one intentional denormalization: `flashcards.user_id`. This is justified because it simplifies RLS, improves due-card query performance, and avoids repeated joins through `decks`.

2. The pasted source text used for AI generation must never be stored in the database. This applies to both successful and failed AI generation attempts.

3. AI generation errors are not logged in the database according to the planning decision. Error handling should remain in the application UI.

4. AI usage limits are counted by proposed flashcards, not saved flashcards or API request count.

5. AI usage resets monthly based on the user’s account creation date.

6. AI acceptance rate can be calculated from `ai_generation_logs.saved_cards_count / ai_generation_logs.proposed_cards_count`.

7. AI adoption rate can be calculated from the ratio of flashcards where `created_by_ai = true` to all flashcards.

8. Review history is intentionally excluded from MVP. Study progress is represented only by current SM-2 fields on `flashcards`.

9. `due_at` and `last_reviewed_at` use `date`, because the product is focused on exam preparation and day-level scheduling is sufficient.

10. `created_at` and `updated_at` use `timestamptz`, because they represent exact moments in time and should remain unambiguous across time zones.

11. Physical deletion is used for decks and flashcards. Soft deletion, restore flows, audit logs, and deck sharing are outside MVP scope.

12. Deck names are not unique per user. This avoids unnecessary friction for students who may create similarly named exam-preparation decks.

13. The exact monthly free AI credit limit still needs to be finalized before migration implementation.

14. The exact maximum `front_text` length should be finalized before migration implementation. A recommended MVP value is 500 characters.

15. The recommended SM-2 defaults are:
    - `sm2_interval = 0`
    - `sm2_repetition = 0`
    - `sm2_ease_factor = 2.50`
    - `due_at = current_date`
    - `last_reviewed_at = null`
```
