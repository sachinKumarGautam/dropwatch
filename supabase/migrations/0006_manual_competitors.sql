-- Allow manually-attached "other links" for a product, and let the owner
-- add/remove them from the UI (competitor_matches was read-only before).

alter table competitor_matches drop constraint if exists competitor_matches_matched_by_check;
alter table competitor_matches
  add constraint competitor_matches_matched_by_check
  check (matched_by in ('ean', 'model', 'llm', 'manual'));

drop policy if exists cm_owner on competitor_matches;
create policy cm_owner on competitor_matches for all to authenticated using (is_owner()) with check (is_owner());
