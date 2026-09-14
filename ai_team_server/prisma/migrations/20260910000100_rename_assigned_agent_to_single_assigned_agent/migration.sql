-- Renames AssignedAgent -> SingleAssignedAgent and monthlyTokenLimit -> tokenLimit,
-- and drops the four threshold*Notified flags (only ever written as false, never
-- read anywhere in the codebase).
--
-- Written by hand as renames on purpose. Prisma diffs a model rename as
-- DROP TABLE + CREATE TABLE, which would delete every agent assignment on the
-- platform; ALTER ... RENAME keeps every row, every id and every foreign key.
--
-- Safe to re-run: each step checks the catalog before acting.

-- RenameTable
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'AssignedAgent'
      AND c.relkind = 'r'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE "AssignedAgent" RENAME TO "SingleAssignedAgent";
  END IF;
END
$mig$;

-- RenameColumn
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'SingleAssignedAgent'
      AND column_name = 'monthlyTokenLimit'
  ) THEN
    ALTER TABLE "SingleAssignedAgent" RENAME COLUMN "monthlyTokenLimit" TO "tokenLimit";
  END IF;
END
$mig$;

-- DropColumn: the notification flags were reset to false in one place and read
-- in none, so no behaviour depends on their values.
ALTER TABLE "SingleAssignedAgent"
    DROP COLUMN IF EXISTS "threshold50Notified",
    DROP COLUMN IF EXISTS "threshold80Notified",
    DROP COLUMN IF EXISTS "threshold90Notified",
    DROP COLUMN IF EXISTS "threshold100Notified";

-- Postgres leaves index and constraint names untouched when a table is renamed,
-- but Prisma derives the names it expects from the model name and reports drift
-- on the next migrate. Rename them by pattern, so this works whether the table
-- was first created by a migration or by `prisma db push`.
DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"SingleAssignedAgent"'::regclass
      AND conname LIKE 'AssignedAgent\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE "SingleAssignedAgent" RENAME CONSTRAINT %I TO %I',
      r.conname,
      'SingleAssignedAgent' || substring(r.conname from 14)
    );
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND n.nspname = current_schema()
      AND c.relname LIKE 'AssignedAgent\_%'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      r.relname,
      'SingleAssignedAgent' || substring(r.relname from 14)
    );
  END LOOP;
END
$mig$;
