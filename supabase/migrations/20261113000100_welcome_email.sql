begin;

-- Keep existing access flags so access can be restored deliberately later.
alter table public.clients alter column portal_enabled set default false;
create or replace function public.is_client_for(p_client_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select false $$;

alter table public.email_notifications drop constraint email_notifications_kind_check;
alter table public.email_notifications add constraint email_notifications_kind_check
  check (kind in ('client_access', 'milestone', 'welcome'));
alter table public.email_notifications drop constraint email_notifications_status_check;
alter table public.email_notifications add constraint email_notifications_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));
alter table public.email_notifications add column welcome_details jsonb;
alter table public.email_notifications add column claimed_at timestamptz;
alter table public.email_notifications add column request_started_at timestamptz;
alter table public.email_notifications add column error_message text;
create unique index email_notifications_one_welcome_per_application
  on public.email_notifications(application_id) where kind = 'welcome';

create or replace function public.queue_welcome_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  client public.clients%rowtype;
begin
  select * into strict client from public.clients where id = new.client_id;
  insert into public.email_notifications(application_id, recipient, kind, status, created_by, welcome_details)
  values (new.id, client.email, 'welcome', 'pending', new.created_by,
    jsonb_build_object('name', client.full_name, 'reference', new.reference, 'registered_at', new.registered_at));
  return new;
end;
$$;
create trigger applications_queue_welcome after insert on public.applications
  for each row execute function public.queue_welcome_email();

create or replace function public.claim_welcome_email(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  item public.email_notifications%rowtype;
begin
  select * into item from public.email_notifications
    where application_id = p_application_id and kind = 'welcome' for update;
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if item.status = 'sent' then return jsonb_build_object('state', 'sent'); end if;
  if item.status = 'processing' and item.claimed_at > now() - interval '10 minutes' then
    return jsonb_build_object('state', 'processing');
  end if;
  if item.request_started_at is not null and item.request_started_at < now() - interval '23 hours' then
    return jsonb_build_object('state', 'expired');
  end if;
  update public.email_notifications set status = 'processing', claimed_at = now(), error_message = null
    where id = item.id;
  return jsonb_build_object('state', 'claimed', 'id', item.id, 'recipient', item.recipient,
    'details', item.welcome_details);
end;
$$;

create or replace function public.start_welcome_request(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.email_notifications set request_started_at = coalesce(request_started_at, now())
    where id = p_id and kind = 'welcome' and status = 'processing';
  if not found then raise exception 'Welcome email is not being processed.'; end if;
end;
$$;

create or replace function public.finish_welcome_email(p_id uuid, p_provider_id text, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.email_notifications set
    status = case when p_error is null then 'sent' else 'failed' end,
    provider_id = p_provider_id, error_message = left(p_error, 500), claimed_at = null
  where id = p_id and kind = 'welcome' and status = 'processing';
  if not found then raise exception 'Welcome email attempt is no longer active.'; end if;
end;
$$;

revoke all on function public.claim_welcome_email(uuid) from public, anon, authenticated;
revoke all on function public.start_welcome_request(uuid) from public, anon, authenticated;
revoke all on function public.finish_welcome_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_welcome_email(uuid) to service_role;
grant execute on function public.start_welcome_request(uuid) to service_role;
grant execute on function public.finish_welcome_email(uuid, text, text) to service_role;

commit;
