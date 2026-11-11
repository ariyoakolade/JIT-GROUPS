create sequence if not exists public.visa_reference_number;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role text not null check (role in ('admin', 'staff')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  email text not null check (email = lower(email) and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null check (length(phone) <= 40),
  portal_enabled boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_email_idx on public.clients(email);
create unique index clients_one_record_per_email on public.clients(email);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete restrict,
  reference text not null unique,
  destination text not null check (length(trim(destination)) between 1 and 80),
  visa_category text not null check (length(trim(visa_category)) between 1 and 100),
  registered_at date not null default current_date,
  current_stage text not null default 'Document collection'
    check (current_stage in ('Document collection', 'Documents complete', 'Application in progress', 'Awaiting appointment', 'Awaiting visa decision')),
  application_started boolean not null default false,
  ukvi_status text not null default 'Not Started'
    check (ukvi_status in ('Not Started', 'In Progress', 'Completed')),
  payment_status text not null default 'Awaiting Payment'
    check (payment_status in ('Awaiting Payment', 'Payment Made', 'Payment Confirmation Received')),
  payment_date date,
  appointment_status text not null default 'Not Started'
    check (appointment_status in ('Not Started', 'In Progress', 'Appointment Booked')),
  appointment_date date,
  appointment_time text not null default '',
  vfs_centre text not null default '',
  upload_status text not null default 'Not Started'
    check (upload_status in ('Not Started', 'In Progress', 'Completed')),
  final_status text not null default ''
    check (final_status in ('', 'Awaiting Biometrics', 'Biometrics Completed', 'Awaiting Visa Decision', 'Visa Approved', 'Visa Refused')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment_status <> 'Payment Confirmation Received' or payment_date is not null),
  check (appointment_status <> 'Appointment Booked' or
    (appointment_date is not null and length(trim(appointment_time)) > 0 and length(trim(vfs_centre)) > 0))
);
create index applications_updated_idx on public.applications(updated_at desc);

create table public.staff_application_details (
  application_id uuid primary key references public.applications(id) on delete cascade,
  payment_amount numeric(12,2) check (payment_amount is null or payment_amount >= 0),
  updated_at timestamptz not null default now()
);

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 180),
  required boolean not null default true,
  applicable boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'received', 'verified', 'needs_correction')),
  sort_order smallint not null default 0,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index application_documents_client_idx on public.application_documents(client_id, sort_order);

create table public.application_timeline (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 800),
  client_visible boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create index application_timeline_client_idx on public.application_timeline(client_id, occurred_at desc);

create table public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid references public.application_documents(id) on delete set null,
  author_id uuid not null references public.profiles(id),
  note text not null check (length(trim(note)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index internal_notes_application_idx on public.internal_notes(application_id, created_at desc);

create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  record_id uuid,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs(created_at desc);

create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete set null,
  recipient text not null,
  kind text not null check (kind in ('client_access', 'milestone')),
  status text not null check (status in ('sent', 'failed')),
  provider_id text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.staff_application_details enable row level security;

create or replace function public.is_active_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.role in ('admin', 'staff')
  );
$$;

create or replace function public.is_active_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active' and p.role = 'admin'
  );
$$;

create or replace function public.is_client_for(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client_id
      and c.portal_enabled
      and lower(c.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;

revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.is_active_admin() from public, anon;
revoke all on function public.is_client_for(uuid) from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;
grant execute on function public.is_active_admin() to authenticated, service_role;
grant execute on function public.is_client_for(uuid) to authenticated, service_role;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger clients_touch_updated before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger applications_touch_updated before update on public.applications
  for each row execute function public.touch_updated_at();

create or replace function public.guard_application_progress()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.payment_status = 'Payment Confirmation Received'
    and not exists (
      select 1 from public.staff_application_details d
      where d.application_id = new.id and d.payment_amount > 0
    ) then
    raise exception 'Record a positive payment amount before confirming payment.';
  end if;
  if new.application_started and not old.application_started then
    if not exists (
      select 1 from public.application_documents d
      where d.application_id = new.id
    ) or exists (
      select 1 from public.application_documents d
      where d.application_id = new.id and d.required and d.applicable and d.status <> 'verified'
    ) then
      raise exception 'Every required applicable document must be verified before proceeding.';
    end if;
  end if;

  if new.final_status <> '' and (
    not new.application_started
    or new.ukvi_status <> 'Completed'
    or new.payment_status <> 'Payment Confirmation Received'
    or new.appointment_status <> 'Appointment Booked'
    or new.upload_status <> 'Completed'
  ) then
    raise exception 'Complete the application stages before setting a final status.';
  end if;
  if new.current_stage = 'Awaiting visa decision' and (
    not new.application_started
    or new.ukvi_status <> 'Completed'
    or new.payment_status <> 'Payment Confirmation Received'
    or new.appointment_status <> 'Appointment Booked'
    or new.upload_status <> 'Completed'
  ) then
    raise exception 'Complete all application stages before awaiting a visa decision.';
  end if;
  return new;
end;
$$;
create trigger applications_guard_progress before update on public.applications
  for each row execute function public.guard_application_progress();

create or replace function public.guard_document_verification()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'verified' and old.status not in ('received', 'verified') then
    raise exception 'Mark the document received before verifying it.';
  end if;
  return new;
end;
$$;
create trigger application_documents_guard before update on public.application_documents
  for each row execute function public.guard_document_verification();

create or replace function public.log_tracker_change()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if tg_table_name = 'staff_application_details' then
    target_id := new.application_id;
  elsif tg_op = 'DELETE' then
    target_id := old.id;
  else
    target_id := new.id;
  end if;
  insert into public.activity_logs(actor_id, action, entity, record_id)
  values ((select auth.uid()), lower(tg_op), tg_table_name, target_id);
  return null;
end;
$$;
create trigger clients_activity after insert or update on public.clients
  for each row execute function public.log_tracker_change();
create trigger applications_activity after insert or update on public.applications
  for each row execute function public.log_tracker_change();
create trigger documents_activity after insert or update on public.application_documents
  for each row execute function public.log_tracker_change();
create trigger payment_details_activity after insert or update on public.staff_application_details
  for each row execute function public.log_tracker_change();
create trigger notes_activity after insert on public.internal_notes
  for each row execute function public.log_tracker_change();

create or replace function public.record_application_milestone()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if old.current_stage is distinct from new.current_stage then
    insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
    values (new.client_id, new.id, 'Application stage', new.current_stage, true, (select auth.uid()));
  end if;
  if old.ukvi_status is distinct from new.ukvi_status then
    insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
    values (new.client_id, new.id, 'UKVI application form', new.ukvi_status, true, (select auth.uid()));
  end if;
  if old.payment_status is distinct from new.payment_status then
    insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
    values (new.client_id, new.id, 'Visa payment', new.payment_status, true, (select auth.uid()));
  end if;
  if old.appointment_status is distinct from new.appointment_status then
    insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
    values (new.client_id, new.id, 'VFS appointment', new.appointment_status, true, (select auth.uid()));
  end if;
  if old.upload_status is distinct from new.upload_status then
    insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
    values (new.client_id, new.id, 'Document upload', new.upload_status, true, (select auth.uid()));
  end if;
  if old.final_status is distinct from new.final_status then
    insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
    values (new.client_id, new.id, 'Final application status', new.final_status, true, (select auth.uid()));
  end if;
  return new;
end;
$$;
create trigger application_timeline_milestones after update on public.applications
  for each row execute function public.record_application_milestone();

create or replace function public.create_application(client_info jsonb, application_info jsonb)
returns uuid language plpgsql security invoker
set search_path = ''
as $$
declare
  new_client_id uuid;
  new_application_id uuid;
  new_reference text;
  item record;
begin
  if not public.is_active_staff() then raise exception 'An active staff account is required.'; end if;
  insert into public.clients(full_name, email, phone, created_by)
  values (
    trim(client_info ->> 'fullName'),
    lower(trim(client_info ->> 'email')),
    trim(client_info ->> 'phone'),
    (select auth.uid())
  ) returning id into new_client_id;

  new_reference := 'JIT-VISA-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.visa_reference_number')::text, 4, '0');
  insert into public.applications(client_id, reference, destination, visa_category, registered_at, created_by)
  values (
    new_client_id, new_reference,
    trim(application_info ->> 'destination'),
    trim(application_info ->> 'visaCategory'),
    coalesce(nullif(application_info ->> 'registeredAt', '')::date, current_date),
    (select auth.uid())
  ) returning id into new_application_id;

  if lower(trim(application_info ->> 'destination')) in ('uk', 'united kingdom')
    and lower(trim(application_info ->> 'visaCategory')) = 'uk standard visitor visa' then
    for item in
      select * from (values
        ('International passport biodata page', true, 1),
        ('Passport photograph', true, 2),
        ('Completed client information form', true, 3),
        ('Personal bank statement', true, 4),
        ('Employment or business evidence', true, 5),
        ('Introduction or employment letter (where applicable)', false, 6),
        ('Evidence of income', true, 7),
        ('Travel itinerary', true, 8),
        ('Hotel reservation', true, 9),
        ('Invitation letter (where applicable)', false, 10),
        ('Evidence of ties to home country', true, 11),
        ('Previous travel history (where applicable)', false, 12),
        ('Other supporting documents', false, 13)
      ) as checklist(label, required, sort_order)
    loop
      insert into public.application_documents(client_id, application_id, label, required, sort_order)
      values (new_client_id, new_application_id, item.label, item.required, item.sort_order);
    end loop;
  end if;

  insert into public.application_timeline(client_id, application_id, title, description, client_visible, created_by)
  values (new_client_id, new_application_id, 'Application registered', 'Your application has been registered.', true, (select auth.uid()));
  return new_application_id;
end;
$$;
revoke all on function public.create_application(jsonb, jsonb) from public, anon;
grant execute on function public.create_application(jsonb, jsonb) to authenticated;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_timeline enable row level security;
alter table public.internal_notes enable row level security;
alter table public.activity_logs enable row level security;
alter table public.email_notifications enable row level security;

create policy "Profiles: self and active staff can read"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_active_staff()));
create policy "Profiles: admins manage"
  on public.profiles for all to authenticated
  using ((select public.is_active_admin())) with check ((select public.is_active_admin()));

create policy "Clients: staff read" on public.clients for select to authenticated
  using ((select public.is_active_staff()));
create policy "Clients: client reads own record" on public.clients for select to authenticated
  using ((select public.is_client_for(id)));
create policy "Clients: staff create" on public.clients for insert to authenticated
  with check ((select public.is_active_staff()));
create policy "Clients: staff update" on public.clients for update to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

create policy "Applications: staff read" on public.applications for select to authenticated
  using ((select public.is_active_staff()));
create policy "Applications: client reads own" on public.applications for select to authenticated
  using ((select public.is_client_for(client_id)));
create policy "Applications: staff create" on public.applications for insert to authenticated
  with check ((select public.is_active_staff()));
create policy "Applications: staff update" on public.applications for update to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

create policy "Documents: staff read" on public.application_documents for select to authenticated
  using ((select public.is_active_staff()));
create policy "Documents: client reads own" on public.application_documents for select to authenticated
  using ((select public.is_client_for(client_id)));
create policy "Documents: staff create" on public.application_documents for insert to authenticated
  with check ((select public.is_active_staff()));
create policy "Documents: staff update" on public.application_documents for update to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

create policy "Timeline: staff read" on public.application_timeline for select to authenticated
  using ((select public.is_active_staff()));
create policy "Timeline: client reads visible entries" on public.application_timeline for select to authenticated
  using (client_visible and (select public.is_client_for(client_id)));
create policy "Timeline: staff add entries" on public.application_timeline for insert to authenticated
  with check ((select public.is_active_staff()));

create policy "Notes: staff read" on public.internal_notes for select to authenticated
  using ((select public.is_active_staff()));
create policy "Notes: staff add" on public.internal_notes for insert to authenticated
  with check ((select public.is_active_staff()) and author_id = (select auth.uid()));

create policy "Activity: staff read" on public.activity_logs for select to authenticated
  using ((select public.is_active_staff()));
create policy "Emails: staff read" on public.email_notifications for select to authenticated
  using ((select public.is_active_staff()));
create policy "Private application details: staff read"
  on public.staff_application_details for select to authenticated
  using ((select public.is_active_staff()));
create policy "Private application details: staff create"
  on public.staff_application_details for insert to authenticated
  with check ((select public.is_active_staff()));
create policy "Private application details: staff update"
  on public.staff_application_details for update to authenticated
  using ((select public.is_active_staff())) with check ((select public.is_active_staff()));

grant usage on schema public to authenticated, service_role;
grant select on public.profiles, public.clients, public.applications,
  public.application_documents, public.application_timeline, public.internal_notes,
  public.activity_logs, public.email_notifications, public.staff_application_details to authenticated;
grant insert, update on public.clients, public.applications,
  public.application_documents, public.application_timeline, public.internal_notes to authenticated;
grant insert, update on public.staff_application_details to authenticated;
grant usage, select on sequence public.visa_reference_number to authenticated;
grant all on public.email_notifications to service_role;
grant select on public.profiles to service_role;
grant select on public.clients, public.applications to service_role;
