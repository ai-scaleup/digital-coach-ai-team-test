-- Adds the agent tier's own usage rollup to SingleAssignedAgent: total spend,
-- the input/output split, and the remaining balance. These mirror what
-- UserAgentTokenUsage tracks per (user, agent), but scoped to one grant so the
-- agent tier can be read and enforced without joining the legacy table.
--
-- DailyTokenUsage remains the source of truth for cycle maths; these four are a
-- rollup that nothing writes yet.
--
-- Additive only: no column is dropped, renamed or retyped, and every added
-- column either carries a default or is nullable, so existing rows stay valid.

-- AddColumn
ALTER TABLE "SingleAssignedAgent"
    ADD COLUMN IF NOT EXISTS "usedTokens"   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "inputTokens"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "tokensLeft"   INTEGER;

-- Seed the balance for grants that already carry an allowance. usedTokens is 0
-- on every existing row, so this is just tokenLimit; it is written as a
-- subtraction to stay correct if this migration is re-run after usage accrues.
UPDATE "SingleAssignedAgent"
SET "tokensLeft" = GREATEST(0, "tokenLimit" - "usedTokens")
WHERE "tokenLimit" IS NOT NULL
  AND "tokensLeft" IS NULL;
