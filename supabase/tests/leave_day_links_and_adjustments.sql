-- Run ONLY in an empty, disposable PostgreSQL database. No production connection.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.users (id uuid primary key, name text, company_id text,
  role text, auth_user_id uuid);
create table public.hr_records (id text primary key, collection text not null,
  data jsonb not null, updated_at timestamptz default now());
create function public.online_attendance_profile(p_employee_id uuid default null)
returns public.users language sql stable security definer as $$
  select u from public.users u where
    (auth.uid() is not null and u.auth_user_id = auth.uid()) or
    (auth.uid() is null and u.id = coalesce(p_employee_id,
      (nullif(current_setting('request.headers', true), '')::jsonb->>'x-employee-id')::uuid)) limit 1;
$$;
create function public.current_hr_profile_id() returns uuid language sql stable as $$
  select (public.online_attendance_profile(null)).id;
$$;
create function public.current_hr_role() returns text language sql stable as $$
  select (public.online_attendance_profile(null)).role;
$$;
create function public.current_leave_company_id() returns text language sql stable as $$
  select (public.online_attendance_profile(null)).company_id;
$$;

\ir ../migrations/20260924143000_employee_leave_days.sql
\ir ../migrations/20260924160000_employee_leave_day_reason.sql
\ir ../migrations/20261003120000_employee_leave_day_approval.sql
\ir ../migrations/20261004050000_employee_leave_days_grants.sql
\ir ../migrations/20261004100000_sync_leave_days_on_approval.sql
\ir ../migrations/20261004140000_leave_reason_options.sql

insert into public.users values
  ('00000000-0000-4000-8000-000000000001', 'Employee', 'speego-original', 'user', '10000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002', 'HR', 'speego-original', 'hr', '10000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003', 'Other HR', 'other-company', 'hr', null);
insert into public.employee_leave_days(company_id, employee_id, leave_date, reason)
values ('speego-original', '00000000-0000-4000-8000-000000000001', '2026-11-10', 'Nghỉ cố định');
insert into public.hr_records(id, collection, data) values
  ('approvalRequests::historical', 'approvalRequests', '{"status":"approved","templateId":"leave","requesterId":"00000000-0000-4000-8000-000000000001","leaveStartDate":"2026-11-10","leaveEndDate":"2026-11-11","code":"OLD","subject":"Historical leave"}'),
  ('approvalRequests::steps', 'approvalRequests', '{"status":"pending","templateId":"leave","requesterId":"00000000-0000-4000-8000-000000000001","leaveStartDate":"2026-11-20"}');

\ir ../migrations/20261116100000_leave_day_links_and_adjustments.sql

do $$
begin
  assert (select count(*) = 2 from public.employee_leave_days), 'historical backfill creates missing days';
  assert (select bool_and(status = 'approved' and reason = 'Nghỉ có phép'
    and approval_request_id = 'approvalRequests::historical' and approval_snapshot->>'code' = 'OLD')
    from public.employee_leave_days), 'backfill links and approves existing rows';
end;
$$;

-- Intermediate decisions must not create or approve a leave day.
update public.hr_records set data = data || '{"currentStepIndex":1}'::jsonb where id = 'approvalRequests::steps';
do $$ begin
  assert not exists(select 1 from public.employee_leave_days where leave_date = '2026-11-20'), 'pending approvals are excluded';
end; $$;
update public.hr_records set data = data || '{"status":"approved"}'::jsonb where id = 'approvalRequests::steps';
insert into public.hr_records(id, collection, data) values
  ('approvalRequests::rejected', 'approvalRequests', '{"status":"rejected","templateId":"leave","requesterId":"00000000-0000-4000-8000-000000000001","leaveStartDate":"2026-11-21"}'),
  ('approvalRequests::inserted', 'approvalRequests', '{"status":"approved","templateBaseId":"leave","requesterId":"00000000-0000-4000-8000-000000000001","leaveStartDate":"2026-11-22"}'),
  ('approvalRequests::wrong-company', 'approvalRequests', '{"status":"approved","templateId":"leave","companyId":"other-company","requesterId":"00000000-0000-4000-8000-000000000001","leaveStartDate":"2026-11-23"}');
do $$ begin
  assert (select count(*) = 4 from public.employee_leave_days), 'final approvals and imported approved requests are synced';
  assert not exists(select 1 from public.employee_leave_days where leave_date in ('2026-11-21', '2026-11-23')), 'rejected and wrong-company requests excluded';
end; $$;

set request.headers = '{"x-employee-id":"00000000-0000-4000-8000-000000000002"}';
do $$
declare v_day public.employee_leave_days%rowtype; v_updated jsonb; v_failed boolean;
begin
  select * into v_day from public.employee_leave_days where leave_date = '2026-11-10';
  v_updated := public.adjust_employee_leave_day(v_day.id, '2026-11-12', 'Nghỉ có phép',
    'Changed with HR confirmation', '[{"name":"confirmation.txt","size":2,"data":"data:text/plain;base64,aGk="}]', v_day.updated_at);
  assert v_updated->>'leave_date' = '2026-11-12' and v_updated->>'original_leave_date' = '2026-11-10', 'date changes retain original date';
  assert v_updated->>'adjustment_count' = '1', 'history count is generated';
  assert v_updated#>>'{adjustment_history,0,actorName}' = 'HR', 'actor comes from current profile';
  assert v_updated#>>'{adjustment_history,0,attachments,0,data}' = 'data:text/plain;base64,aGk=', 'file bytes persist';
  assert v_updated->>'approval_request_id' = 'approvalRequests::historical', 'source link preserved';

  v_failed := false;
  begin
    perform public.adjust_employee_leave_day(v_day.id, '2026-11-13', 'Nghỉ có phép', 'Stale update', '[]', v_day.updated_at);
  exception when others then v_failed := sqlerrm like '%vừa được cập nhật%'; end;
  assert v_failed, 'stale concurrent update rejected';

  select * into v_day from public.employee_leave_days where id = v_day.id;
  v_failed := false;
  begin
    perform public.adjust_employee_leave_day(v_day.id, '2026-11-11', 'Nghỉ có phép', 'Conflicting date', '[]', v_day.updated_at);
  exception when unique_violation then v_failed := true; end;
  assert v_failed, 'duplicate date rejected atomically';
  assert (select adjustment_count = 1 from public.employee_leave_days where id = v_day.id), 'failed save does not append history';

  v_failed := false;
  begin
    perform public.adjust_employee_leave_day(v_day.id, v_day.leave_date, v_day.reason, ' ', '[]', v_day.updated_at);
  exception when others then v_failed := sqlerrm like '%Ghi chú%'; end;
  assert v_failed, 'blank notes rejected server-side';

  v_failed := false;
  begin
    perform public.adjust_employee_leave_day(v_day.id, v_day.leave_date, v_day.reason, 'Unsafe file', '[{"name":"bad.html","data":"javascript:alert(1)"}]', v_day.updated_at);
  exception when others then v_failed := sqlerrm like '%Tệp đính kèm%'; end;
  assert v_failed, 'invalid files rejected server-side';

  perform set_config('request.headers', '{"x-employee-id":"00000000-0000-4000-8000-000000000001"}', true);
  v_failed := false;
  begin
    perform public.adjust_employee_leave_day(v_day.id, v_day.leave_date, v_day.reason, 'Unauthorized user', '[]', v_day.updated_at);
  exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, 'employees cannot adjust days';

  perform set_config('request.headers', '{"x-employee-id":"00000000-0000-4000-8000-000000000003"}', true);
  v_failed := false;
  begin
    perform public.adjust_employee_leave_day(v_day.id, v_day.leave_date, v_day.reason, 'Wrong company', '[]', v_day.updated_at);
  exception when insufficient_privilege then v_failed := true; end;
  assert v_failed, 'cross-company HR cannot adjust days';
end;
$$;

-- Running the migration again must keep the moved day and its evidence intact.
\ir ../migrations/20261116100000_leave_day_links_and_adjustments.sql
do $$ begin
  assert (select count(*) = 4 from public.employee_leave_days), 'rerun never recreates moved day';
  assert not exists(select 1 from public.employee_leave_days where leave_date = '2026-11-10'), 'original day remains moved';
  assert (select adjustment_count = 1 from public.employee_leave_days where leave_date = '2026-11-12'), 'history survives rerun';
end; $$;

-- Signed-in Auth users use the same RPC and their server-resolved identity.
set request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
set role authenticated;
do $$ declare v_day public.employee_leave_days%rowtype; v_result jsonb;
begin
  select * into v_day from public.employee_leave_days where leave_date = '2026-11-12';
  v_result := public.adjust_employee_leave_day(v_day.id, v_day.leave_date, 'Nghỉ cố định', 'Auth HR confirmation', '[]', v_day.updated_at);
  assert v_result->>'adjustment_count' = '2', 'Auth HR adjustment appends history';
end; $$;
reset role;
select 'All leave day SQL regression checks passed.' as result;
