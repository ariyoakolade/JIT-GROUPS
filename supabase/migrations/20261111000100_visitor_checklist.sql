begin;

-- A verified document is also submitted; choosing Verified directly is valid.
drop trigger if exists application_documents_guard on public.application_documents;

create or replace function public.guard_application_progress()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not new.application_started and (
    new.ukvi_status is distinct from old.ukvi_status
    or new.payment_status is distinct from old.payment_status
    or new.payment_date is distinct from old.payment_date
    or new.appointment_status is distinct from old.appointment_status
    or new.appointment_date is distinct from old.appointment_date
    or new.appointment_time is distinct from old.appointment_time
    or new.vfs_centre is distinct from old.vfs_centre
    or new.upload_status is distinct from old.upload_status
    or new.final_status is distinct from old.final_status
  ) then
    raise exception 'Complete the required document checklist and proceed before updating application progress.';
  end if;
  if new.payment_status = 'Payment Confirmation Received'
    and not exists (
      select 1 from public.staff_application_details d
      where d.application_id = new.id and d.payment_amount > 0
    ) then
    raise exception 'Record a positive payment amount before confirming payment.';
  end if;
  if new.application_started and not old.application_started then
    if not exists (
      select 1 from public.application_documents d where d.application_id = new.id
    ) or exists (
      select 1 from public.application_documents d
      where d.application_id = new.id and d.required and d.applicable and d.status <> 'verified'
    ) then
      raise exception 'Every required applicable document must be verified before proceeding.';
    end if;
  end if;
  if new.final_status <> '' and (
    not new.application_started or new.ukvi_status <> 'Completed'
    or new.payment_status <> 'Payment Confirmation Received'
    or new.appointment_status <> 'Appointment Booked' or new.upload_status <> 'Completed'
  ) then
    raise exception 'Complete the application stages before setting a final status.';
  end if;
  if new.current_stage = 'Awaiting visa decision' and (
    not new.application_started or new.ukvi_status <> 'Completed'
    or new.payment_status <> 'Payment Confirmation Received'
    or new.appointment_status <> 'Appointment Booked' or new.upload_status <> 'Completed'
  ) then
    raise exception 'Complete all application stages before awaiting a visa decision.';
  end if;
  return new;
end;
$$;

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
    trim(client_info ->> 'fullName'), lower(trim(client_info ->> 'email')),
    trim(client_info ->> 'phone'), (select auth.uid())
  ) returning id into new_client_id;

  new_reference := 'JIT-VISA-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.visa_reference_number')::text, 4, '0');
  insert into public.applications(client_id, reference, destination, visa_category, registered_at, created_by)
  values (
    new_client_id, new_reference, trim(application_info ->> 'destination'),
    trim(application_info ->> 'visaCategory'),
    coalesce(nullif(application_info ->> 'registeredAt', '')::date, current_date),
    (select auth.uid())
  ) returning id into new_application_id;

  if lower(trim(application_info ->> 'destination')) in ('uk', 'united kingdom')
    and lower(trim(application_info ->> 'visaCategory')) = 'uk standard visitor visa' then
    for item in
      select * from (values
        ('Valid passport or accepted travel document for the whole UK stay', true, 1),
        ('Completed JIT client information form and application details', true, 2),
        ('Financial evidence and source of funds', false, 3),
        ('Employment, education or business evidence', false, 4),
        ('Evidence of income or earnings', false, 5),
        ('Evidence of purpose and planned activities', false, 6),
        ('Previous passports or travel history', false, 7),
        ('Legal residence in country of application, if applicable', false, 8),
        ('Sponsor support, finances, relationship and UK status, if applicable', false, 9),
        ('Child relationship and parental consent evidence, if applicable', false, 10),
        ('Business event or invitation evidence, if applicable', false, 11),
        ('Certified translation for non-English or Welsh documents, if applicable', false, 12),
        ('TB test certificate if required for a visit over six months', false, 13),
        ('Study, academic, paid engagement or medical visit evidence, if applicable', false, 14),
        ('Other case-specific supporting evidence', false, 15)
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

-- Preserve every existing checklist item, status, and requirement setting.
insert into public.application_documents(client_id, application_id, label, required, sort_order)
select a.client_id, a.id, items.label, false, items.sort_order
from public.applications a
cross join (values
  ('Legal residence in country of application, if applicable', 101),
  ('Sponsor support, finances, relationship and UK status, if applicable', 102),
  ('Child relationship and parental consent evidence, if applicable', 103),
  ('Business event or invitation evidence, if applicable', 104),
  ('Certified translation for non-English or Welsh documents, if applicable', 105),
  ('TB test certificate if required for a visit over six months', 106),
  ('Study, academic, paid engagement or medical visit evidence, if applicable', 107)
) as items(label, sort_order)
where lower(trim(a.destination)) in ('uk', 'united kingdom')
  and lower(trim(a.visa_category)) = 'uk standard visitor visa'
  and not exists (
    select 1 from public.application_documents d
    where d.application_id = a.id and d.label = items.label
  );

commit;
