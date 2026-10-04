-- Migration 13: Allow schedulers to update subjects (facilities and hours)
do $$
begin
  if not exists (
    select 1 from pg_policies 
    where tablename = 'subjects' and policyname = 'subjects_scheduler_update'
  ) then
    create policy "subjects_scheduler_update"
      on public.subjects for update
      using (public.is_active() and public.current_role() = 'scheduler')
      with check (public.is_active() and public.current_role() = 'scheduler');
  end if;
end
$$;
