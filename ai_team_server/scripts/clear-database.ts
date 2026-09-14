/**
 * Delete every application row while preserving tables, schema, and Prisma's
 * migration history.
 *
 * Usage: npx ts-node scripts/clear-database.ts
 */
import { Client } from 'pg';
import * as path from 'node:path';

function loadEnv() {
  try {
    process.loadEnvFile(path.join(process.cwd(), '.env'));
  } catch {
    // Render and CI inject environment variables without an .env file.
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function clearDatabase() {
  loadEnv();

  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Neither DIRECT_URL nor DATABASE_URL is set.');
  }

  const target = new URL(connectionString);
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const identity = await client.query<{
      database_name: string;
      database_user: string;
    }>(
      'SELECT current_database() AS database_name, current_user AS database_user;',
    );

    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
        ORDER BY table_name;`,
    );
    const tables = rows.map((row) => row.table_name);

    console.log(
      `Target: ${identity.rows[0].database_name} on ${target.hostname}:${target.port || '5432'} as ${identity.rows[0].database_user}`,
    );
    console.log(
      `Clearing ${tables.length} application tables; preserving _prisma_migrations.`,
    );

    if (tables.length === 0) {
      console.log('No application tables found.');
      return;
    }

    let rowsBefore = 0;
    for (const table of tables) {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)};`,
      );
      const count = Number(result.rows[0].count);
      rowsBefore += count;
      if (count > 0) console.log(`  ${table}: ${count} rows`);
    }

    await client.query('BEGIN;');
    try {
      const identifiers = tables.map(quoteIdentifier).join(', ');
      await client.query(
        `TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE;`,
      );
      await client.query('COMMIT;');
    } catch (error) {
      await client.query('ROLLBACK;');
      throw error;
    }

    let rowsAfter = 0;
    for (const table of tables) {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)};`,
      );
      rowsAfter += Number(result.rows[0].count);
    }

    if (rowsAfter !== 0) {
      throw new Error(
        `Verification failed: ${rowsAfter} application rows remain.`,
      );
    }

    console.log(
      `Deleted ${rowsBefore} rows. All application tables are empty.`,
    );
  } finally {
    await client.end();
  }
}

clearDatabase().catch((error) => {
  console.error(
    'Database clear failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
