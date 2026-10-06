-- Lead Defteri · zero-knowledge sync storage
--
-- The app encrypts every record on the device (AES-256-GCM) with a key derived
-- from the user's sync code. This database only ever receives:
--   space       HMAC-derived 64-hex id of the sync space (not the code itself)
--   rid         HMAC of the record id (no names, dates or ids in clear text)
--   payload     base64 ciphertext
--   updated_at  client timestamp in ms (last-write-wins)
-- Nothing stored here is readable without the sync code, which never leaves the
-- user's devices.
--
-- Run once in a Supabase project (SQL editor). Region: eu-central-1 (Frankfurt).
-- Clients call only the three RPC functions below with the publishable key;
-- the table itself is not reachable through the API.

create schema if not exists lead_defteri;
create sequence if not exists lead_defteri.seq;

create table if not exists lead_defteri.records (
  space      text    not null check (space ~ '^[0-9a-f]{64}$'),
  rid        text    not null check (rid ~ '^[0-9a-f]{64}$'),
  updated_at bigint  not null,
  deleted    boolean not null default false,
  payload    text    not null check (length(payload) <= 262144),
  seq        bigint  not null,
  primary key (space, rid)
);
create index if not exists records_space_seq on lead_defteri.records (space, seq);

alter table lead_defteri.records enable row level security;
revoke all on schema lead_defteri from public, anon, authenticated;
revoke all on all tables in schema lead_defteri from public, anon, authenticated;
revoke all on all sequences in schema lead_defteri from public, anon, authenticated;

-- Upsert a batch of encrypted records; older versions never overwrite newer ones.
create or replace function public.ld_push(p_space text, p_rows jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  n int;
begin
  if p_space !~ '^[0-9a-f]{64}$' then raise exception 'invalid space'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid rows'; end if;
  n := jsonb_array_length(p_rows);
  if n > 500 then raise exception 'too many rows in one call'; end if;
  if (select count(*) from lead_defteri.records where space = p_space) + n > 100000 then
    raise exception 'space quota exceeded';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    insert into lead_defteri.records as t (space, rid, updated_at, deleted, payload, seq)
    values (p_space, r->>'rid', (r->>'u')::bigint, coalesce((r->>'d')::boolean, false),
            coalesce(r->>'p', ''), nextval('lead_defteri.seq'))
    on conflict (space, rid) do update
      set updated_at = excluded.updated_at,
          deleted    = excluded.deleted,
          payload    = excluded.payload,
          seq        = excluded.seq
      where t.updated_at < excluded.updated_at;
  end loop;
  return coalesce((select max(seq) from lead_defteri.records where space = p_space), 0);
end;
$$;

-- Records changed after p_since, oldest first, at most 1000 per call.
create or replace function public.ld_pull(p_space text, p_since bigint)
returns table (rid text, updated_at bigint, deleted boolean, payload text, seq bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rid, r.updated_at, r.deleted, r.payload, r.seq
  from lead_defteri.records r
  where r.space = p_space and r.seq > p_since
  order by r.seq
  limit 1000;
$$;

-- Remove every record of a space (used by "Buluttan tamamen sil").
create or replace function public.ld_wipe(p_space text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from lead_defteri.records where space = p_space;
$$;

revoke all on function public.ld_push(text, jsonb) from public;
revoke all on function public.ld_pull(text, bigint) from public;
revoke all on function public.ld_wipe(text) from public;
grant execute on function public.ld_push(text, jsonb) to anon, authenticated;
grant execute on function public.ld_pull(text, bigint) to anon, authenticated;
grant execute on function public.ld_wipe(text) to anon, authenticated;
