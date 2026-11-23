import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function openDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  if (!sqlite.prepare('SELECT name FROM _local_migrations WHERE name = ?').get('0000_initial')) {
    sqlite.exec(readFileSync(new URL('../drizzle/0000_initial.sql', import.meta.url), 'utf8'));
    sqlite.prepare('INSERT INTO _local_migrations VALUES (?)').run('0000_initial');
  }
  return { sqlite, prepare(sql) { return { bind(...values) { const statement = sqlite.prepare(sql); return { async first() { return statement.get(...values) || null; }, async all() { return { results: statement.all(...values) }; }, async run() { return statement.run(...values); } }; } }; } };
}
