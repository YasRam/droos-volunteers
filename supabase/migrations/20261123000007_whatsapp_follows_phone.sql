-- WhatsApp defaults to the phone number:
--  * empty WhatsApp → the phone (as before),
--  * and when the phone changes and WhatsApp was the old phone, WhatsApp follows it.
create or replace function app.volunteer_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(btrim(new.whatsapp), '') is null then
    new.whatsapp := new.phone;
  elsif tg_op = 'UPDATE' and new.phone is distinct from old.phone
        and old.whatsapp is not distinct from old.phone
        and new.whatsapp is not distinct from old.whatsapp then
    new.whatsapp := new.phone;
  end if;
  return new;
end;
$$;

-- Rows loaded from the sheet skipped the trigger: fill the ones with a valid phone.
select app.begin_internal();
update public.volunteers
   set whatsapp = phone
 where nullif(btrim(whatsapp), '') is null
   and phone ~ '^01[0-9]{9}$';
select app.end_internal();
