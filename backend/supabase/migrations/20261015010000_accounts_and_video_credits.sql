-- Aprobacion de cuentas + contador de videos (ver plan-monetizacion-y-seguridad.md,
-- fases 3 a 5).
--
-- - Toda cuenta nueva queda 'pending' hasta que un admin la aprueba; al
--   aprobarla recibe los videos de bienvenida.
-- - Cada proyecto descuenta 1 video la primera vez que se aprieta Renderizar
--   (charge_render). Si el render falla definitivamente sin haber dejado
--   nunca un video final, se devuelve (refund_render). Re-renderizar un
--   proyecto ya cobrado no descuenta.
-- - Las cuentas 'unlimited' (el equipo) no descuentan.
--
-- Todo lo escribe solo el backend (service_role): ninguna tabla ni funcion
-- de aca es accesible con la key publica.

-- --- Tablas -------------------------------------------------------------

create table if not exists public.user_accounts (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null default '',
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  unlimited   boolean not null default false,
  created_at  timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

create index if not exists user_accounts_status_idx on public.user_accounts (status, created_at);

create table if not exists public.video_credits (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  used       integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now()
);

-- Historial de cada carga, uso y devolucion: es lo que mira el admin para
-- saber quien pago y cuanto.
create table if not exists public.video_credit_movements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     integer not null,
  reason     text not null check (reason in
             ('welcome', 'admin_load', 'admin_remove', 'render', 'render_refund')),
  project_id uuid references public.video_projects(id) on delete set null,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists video_credit_movements_user_idx
  on public.video_credit_movements (user_id, created_at desc);

-- true desde que el proyecto descuenta su video (primer Renderizar) hasta
-- que se devuelve por un render fallido.
alter table public.video_projects
  add column if not exists render_charged boolean not null default false;

-- Proyectos que ya tienen un video final de antes de esta migracion: cuentan
-- como ya cobrados (re-renderizarlos no descuenta). Sin esto, el primer
-- re-render de un proyecto viejo cobraba, y si fallaba no se devolvia
-- (refund_render ve el render final viejo y asume que el video se uso).
update public.video_projects p
set render_charged = true
where exists (
  select 1 from public.assets a
  where a.video_project_id = p.id
    and a.type = 'VIDEO'
    and a.metadata->>'kind' = 'final_render'
);

-- Las cuentas que ya existen son del equipo: quedan aprobadas y sin limite,
-- para no dejar a nadie afuera al desplegar. Desde el panel de admin se les
-- puede sacar el "sin limite".
insert into public.user_accounts (user_id, email, status, unlimited, reviewed_at)
select u.id, coalesce(u.email, ''), 'approved', true, now()
from auth.users u
on conflict (user_id) do nothing;

insert into public.video_credits (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

revoke all on public.user_accounts, public.video_credits, public.video_credit_movements
  from anon, authenticated;

-- --- Funciones ----------------------------------------------------------

-- Crea la cuenta 'pending' (y su saldo en 0) la primera vez que un usuario
-- hace un pedido -- cubre registro con mail y con Google por igual.
create or replace function public.ensure_user_account(p_user_id uuid, p_email text)
returns setof public.user_accounts
language plpgsql
set search_path = public
as $$
begin
  insert into public.user_accounts (user_id, email)
  values (p_user_id, coalesce(p_email, ''))
  on conflict (user_id) do nothing;

  insert into public.video_credits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  return query select * from public.user_accounts where user_id = p_user_id;
end;
$$;

-- Aprueba la cuenta y da los videos de bienvenida UNA sola vez (aprobar de
-- nuevo, o aprobar despues de haberla rechazado, no los vuelve a dar).
create or replace function public.approve_user_account(
  p_user_id uuid,
  p_admin_id uuid,
  p_welcome_videos integer
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_balance integer;
begin
  update public.user_accounts
  set status = 'approved', reviewed_by = p_admin_id, reviewed_at = now()
  where user_id = p_user_id;
  if not found then
    raise exception 'account_not_found';
  end if;

  insert into public.video_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  if p_welcome_videos > 0 and not exists (
    select 1 from public.video_credit_movements
    where user_id = p_user_id and reason = 'welcome'
  ) then
    update public.video_credits
    set balance = balance + p_welcome_videos, updated_at = now()
    where user_id = p_user_id;
    insert into public.video_credit_movements (user_id, amount, reason, created_by)
    values (p_user_id, p_welcome_videos, 'welcome', p_admin_id);
  end if;

  select balance into v_balance from public.video_credits where user_id = p_user_id;
  return v_balance;
end;
$$;

-- Suma (amount > 0) o resta (amount < 0) videos a mano desde el admin. Nunca
-- deja el saldo en negativo.
create or replace function public.adjust_video_credits(
  p_user_id uuid,
  p_amount integer,
  p_note text,
  p_admin_id uuid
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount = 0 then
    raise exception 'amount_zero';
  end if;

  insert into public.video_credits (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  update public.video_credits
  set balance = balance + p_amount, updated_at = now()
  where user_id = p_user_id and balance + p_amount >= 0
  returning balance into v_balance;
  if not found then
    raise exception 'insufficient_balance';
  end if;

  insert into public.video_credit_movements (user_id, amount, reason, note, created_by)
  values (p_user_id, p_amount, case when p_amount > 0 then 'admin_load' else 'admin_remove' end, p_note, p_admin_id);

  return v_balance;
end;
$$;

-- Al apretar Renderizar. Devuelve:
--   'already_charged' -> re-render de un proyecto ya cobrado: no descuenta
--   'unlimited'       -> el dueno es una cuenta sin limite: no descuenta
--   'charged'         -> se desconto 1 video
--   'no_credits'      -> sin saldo: no se renderiza
-- Bloquea la fila del proyecto: dos clicks (o dos pestanas) a la vez sobre
-- el mismo proyecto no cobran dos veces, y dos proyectos a la vez con 1
-- video solo dejan pasar a uno (el update del saldo es condicional).
create or replace function public.charge_render(p_project_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_charged boolean;
begin
  select user_id, render_charged into v_owner, v_charged
  from public.video_projects
  where id = p_project_id
  for update;
  if not found then
    raise exception 'project_not_found';
  end if;

  if v_charged then
    return 'already_charged';
  end if;

  if exists (select 1 from public.user_accounts where user_id = v_owner and unlimited) then
    return 'unlimited';
  end if;

  update public.video_credits
  set balance = balance - 1, used = used + 1, updated_at = now()
  where user_id = v_owner and balance > 0;
  if not found then
    return 'no_credits';
  end if;

  update public.video_projects set render_charged = true where id = p_project_id;
  insert into public.video_credit_movements (user_id, amount, reason, project_id)
  values (v_owner, -1, 'render', p_project_id);
  return 'charged';
end;
$$;

-- Devuelve el video de un proyecto cobrado cuyo render fallo
-- definitivamente. Si el proyecto ya tuvo alguna vez un render terminado
-- (asset final_render), el video se uso y no se devuelve. Devuelve true si
-- devolvio algo.
create or replace function public.refund_render(p_project_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_charged boolean;
begin
  select user_id, render_charged into v_owner, v_charged
  from public.video_projects
  where id = p_project_id
  for update;
  if not found or not v_charged then
    return false;
  end if;

  if exists (
    select 1 from public.assets
    where video_project_id = p_project_id
      and type = 'VIDEO'
      and metadata->>'kind' = 'final_render'
  ) then
    return false;
  end if;

  update public.video_credits
  set balance = balance + 1, used = greatest(used - 1, 0), updated_at = now()
  where user_id = v_owner;
  update public.video_projects set render_charged = false where id = p_project_id;
  insert into public.video_credit_movements (user_id, amount, reason, project_id)
  values (v_owner, 1, 'render_refund', p_project_id);
  return true;
end;
$$;

revoke all on function public.ensure_user_account(uuid, text) from public, anon, authenticated;
revoke all on function public.approve_user_account(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.adjust_video_credits(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.charge_render(uuid) from public, anon, authenticated;
revoke all on function public.refund_render(uuid) from public, anon, authenticated;

grant execute on function public.ensure_user_account(uuid, text) to service_role;
grant execute on function public.approve_user_account(uuid, uuid, integer) to service_role;
grant execute on function public.adjust_video_credits(uuid, integer, text, uuid) to service_role;
grant execute on function public.charge_render(uuid) to service_role;
grant execute on function public.refund_render(uuid) to service_role;
