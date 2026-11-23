-- New role «إدارة»: reads everything except the HR notes, changes nothing.
-- (Its own file: a new enum value can't be used in the transaction that adds it.)
alter type public.app_role add value if not exists 'management';
