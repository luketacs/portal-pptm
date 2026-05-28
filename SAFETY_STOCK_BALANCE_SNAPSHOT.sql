-- Snapshot de saldo do Estoque de Seguranca para compartilhamento entre usuarios.
-- Admin publica a atualizacao; demais perfis apenas visualizam.

create table if not exists public.safety_stock_balance_snapshot (
  material_code text primary key,
  current_stock numeric,
  error_message text,
  checked_at timestamptz not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_safety_stock_balance_snapshot_checked_at
  on public.safety_stock_balance_snapshot (checked_at desc);

create or replace function public.set_safety_stock_balance_snapshot_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_safety_stock_balance_snapshot_updated_at on public.safety_stock_balance_snapshot;
create trigger trg_safety_stock_balance_snapshot_updated_at
before update on public.safety_stock_balance_snapshot
for each row
execute function public.set_safety_stock_balance_snapshot_updated_at();

grant select, insert, update, delete
on table public.safety_stock_balance_snapshot
to authenticated;

alter table public.safety_stock_balance_snapshot enable row level security;

drop policy if exists "safety_stock_snapshot_select_authenticated"
on public.safety_stock_balance_snapshot;
create policy "safety_stock_snapshot_select_authenticated"
on public.safety_stock_balance_snapshot
for select
to authenticated
using (true);

drop policy if exists "safety_stock_snapshot_insert_admin"
on public.safety_stock_balance_snapshot;
create policy "safety_stock_snapshot_insert_admin"
on public.safety_stock_balance_snapshot
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'Admin'
  )
);

drop policy if exists "safety_stock_snapshot_update_admin"
on public.safety_stock_balance_snapshot;
create policy "safety_stock_snapshot_update_admin"
on public.safety_stock_balance_snapshot
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'Admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'Admin'
  )
);

drop policy if exists "safety_stock_snapshot_delete_admin"
on public.safety_stock_balance_snapshot;
create policy "safety_stock_snapshot_delete_admin"
on public.safety_stock_balance_snapshot
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'Admin'
  )
);
