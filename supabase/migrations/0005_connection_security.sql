revoke execute on function public.touch_updated_at() from public, anon;
revoke execute on function public.handle_new_user() from public, anon;
revoke execute on function public.validate_daily_record_flock() from public, anon;
revoke execute on function public.protect_profile_roles() from public, anon;
revoke execute on function public.validate_field_evidence_flock() from public, anon;

revoke execute on function public.is_farm_member(uuid) from public, anon;
revoke execute on function public.has_farm_role(uuid, public.farm_role[]) from public, anon;
revoke execute on function public.is_manager_account() from public, anon;
revoke execute on function public.is_superadmin() from public, anon;
revoke execute on function public.has_farm_module(uuid, text) from public, anon;
revoke execute on function public.storage_object_farm_id(text) from public, anon;
revoke execute on function public.get_my_farm_assignments() from public, anon;

grant execute on function public.is_farm_member(uuid) to authenticated;
grant execute on function public.has_farm_role(uuid, public.farm_role[]) to authenticated;
grant execute on function public.is_manager_account() to authenticated;
grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.has_farm_module(uuid, text) to authenticated;
grant execute on function public.storage_object_farm_id(text) to authenticated;
grant execute on function public.get_my_farm_assignments() to authenticated;
