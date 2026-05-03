CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  requested_role text;
  assigned_role public.app_role;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  requested_role := new.raw_user_meta_data->>'account_type';
  if requested_role = 'admin' then
    assigned_role := 'admin'::public.app_role;
  else
    assigned_role := 'student'::public.app_role;
  end if;

  insert into public.user_roles (user_id, role)
  values (new.id, assigned_role)
  on conflict do nothing;

  return new;
end;
$function$;

-- Make sure the trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();