-- Migration 08: Single Current Academic Term Trigger
-- AlterSched Phase 2

create or replace function public.handle_single_current_term()
returns trigger as $$
begin
  if new.is_current = true then
    update public.academic_terms
    set is_current = false
    where id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and is_current = true;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_single_current_term on public.academic_terms;
create trigger trg_single_current_term
  before insert or update of is_current on public.academic_terms
  for each row
  when (new.is_current = true)
  execute function public.handle_single_current_term();
