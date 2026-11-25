#!/usr/bin/env node
// Turns a Drive backup (droos-backup-*.json.gz or .json) into one SQL file that restores it.
//
//   node backup/restore-sql.mjs droos-backup-2026-11-24_0300.json.gz > restore.sql
//
// Run restore.sql in the Supabase SQL editor of a project that already has all migrations.
// It REPLACES the current data of every table in the backup (one transaction: all or nothing).
// Triggers (audit, guards, notifications) are switched off during the load, so the restored
// rows keep their original ids, codes, dates and authors.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const file = process.argv[2]
if (!file) {
  console.error('usage: node restore-sql.mjs <backup.json.gz>')
  process.exit(1)
}
let raw = readFileSync(file)
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw)
const backup = JSON.parse(raw.toString('utf8'))
if (backup.app !== 'droos-volunteers' || !backup.tables) throw new Error('not a droos-volunteers backup')

// Dollar-quote tag that cannot appear in the data
let tag = 'bk'
const body = JSON.stringify(backup.tables)
while (body.includes(`$${tag}$`)) tag += 'x'

const tables = Object.keys(backup.tables)
// 'volunteers' → public."volunteers" ; 'students.notes' → "students"."notes"
const rel = (t) => (t.includes('.') ? t.split('.') : ['public', t]).map((x) => `"${x}"`).join('.')
if (!tables.includes('students.students')) {
  console.error('warning: this backup is from before the students part; restoring it empties the students\' classes.')
}
const out = []
out.push(`-- restore of backup taken ${backup.exported_at} (${backup.rows} rows)`)
out.push('begin;')
out.push('set local session_replication_role = replica;')
out.push(`truncate ${[...tables].reverse().map(rel).join(', ')} cascade;`)
out.push(`create temp table _backup (data jsonb) on commit drop;`)
out.push(`insert into _backup values ($${tag}$${body}$${tag}$);`)
// Old rows may break rules that only apply to new data (CHECK ... NOT VALID): lift those
// rules during the load and put them back, still NOT VALID, afterwards.
out.push(`create temp table _lax on commit drop as
  select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
    from pg_constraint
   where contype = 'c' and not convalidated and connamespace in ('public'::regnamespace, 'students'::regnamespace);`)
out.push(`do $lax$ declare r record; begin
  for r in select * from _lax loop execute format('alter table %s drop constraint %I', r.tbl, r.conname); end loop;
end $lax$;`)
out.push(`do $restore$
declare
  t text;
  cols text;
  n bigint;
begin
  foreach t in array array[${tables.map((t) => `'${t}'`).join(', ')}] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = app.backup_schema(t) and table_name = app.backup_name(t) and is_generated = 'NEVER';
    execute format(
      'insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, (select data -> %L from _backup))',
      app.backup_rel(t), cols, cols, app.backup_rel(t), t);
    get diagnostics n = row_count;
    raise notice '% : % rows', t, n;
  end loop;
end
$restore$;`)
// Identity columns continue after the restored ids
out.push(`do $seq$
declare r record;
begin
  for r in select table_schema, table_name, column_name from information_schema.columns
            where is_identity = 'YES' and (table_schema, table_name) in
              (select app.backup_schema(x), app.backup_name(x) from unnest(array[${tables.map((t) => `'${t}'`).join(', ')}]) x) loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from %I.%I), 0) + 1, false)',
                   format('%I.%I', r.table_schema, r.table_name), r.column_name, r.column_name, r.table_schema, r.table_name);
  end loop;
end
$seq$;`)
out.push(`do $lax$ declare r record; begin
  for r in select * from _lax loop execute format('alter table %s add constraint %I %s not valid', r.tbl, r.conname, r.def); end loop;
end $lax$;`)
out.push('commit;')
out.push(`select ${tables.map((t) => `(select count(*) from ${rel(t)}) as "${t}"`).join(', ')};`)
process.stdout.write(out.join('\n') + '\n')
