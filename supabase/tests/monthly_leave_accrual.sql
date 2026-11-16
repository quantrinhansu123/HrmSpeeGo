-- Disposable local DB ONLY. Uses a fixed business date without touching production.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end; $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.users(id uuid primary key,name text,company_id text,role text,auth_user_id uuid,
  employee_id text,username text,avatar_url text,department text,branch text,position text,is_team_leader boolean,
  join_date date,official_date date,employment_status text,status text);
create table public.hr_records(id text primary key,collection text not null,data jsonb not null,updated_at timestamptz default now());
create table public.employee_status_history(employee_id uuid,effective_date date,new_status text);
create table public.employee_shift_registrations(employee_id uuid,company_id text,work_date date,status text);
create table public.employee_leave_settings(company_id text,employee_id uuid,leave_data jsonb,unique(company_id,employee_id));
create function public.current_hr_profile_id() returns uuid language sql stable as $$ select nullif(current_setting('test.employee',true),'')::uuid $$;
create function public.current_hr_role() returns text language sql stable as $$ select role from public.users where id=public.current_hr_profile_id() $$;
create function public.current_leave_company_id() returns text language sql stable as $$ select company_id from public.users where id=public.current_hr_profile_id() $$;
create function public.online_attendance_profile(p_employee_id uuid default null) returns public.users language sql stable as $$ select u from public.users u where id=public.current_hr_profile_id() $$;
create function public.my_team_leader() returns jsonb language sql stable as $$ select '{"id":"00000000-0000-4000-8000-000000000002","name":"HR"}'::jsonb $$;
\ir ../migrations/20260924143000_employee_leave_days.sql
\ir ../migrations/20260924160000_employee_leave_day_reason.sql
\ir ../migrations/20261003120000_employee_leave_day_approval.sql
\ir ../migrations/20261004050000_employee_leave_days_grants.sql
\ir ../migrations/20261004100000_sync_leave_days_on_approval.sql
\ir ../migrations/20261004140000_leave_reason_options.sql
\ir ../migrations/20261116100000_leave_day_links_and_adjustments.sql
\ir ../migrations/20261117100000_monthly_leave_accrual.sql
create or replace function public.leave_today() returns date language sql stable as $$ select '2026-11-16'::date $$;
insert into public.users(id,name,company_id,role,join_date,official_date,employment_status,status) values
 ('00000000-0000-4000-8000-000000000001','Employee','speego-original','user','2026-01-01','2026-05-16','Chính thức','Chính thức'),
 ('00000000-0000-4000-8000-000000000002','HR','speego-original','hr','2020-01-01','2020-02-01','Chính thức','Chính thức'),
 ('00000000-0000-4000-8000-000000000003','Probation','speego-original','user','2026-10-01',null,'Thử việc','Thử việc'),
 ('00000000-0000-4000-8000-000000000004','Other HR','other-company','hr','2020-01-01','2020-02-01','Chính thức','Chính thức'),
 ('00000000-0000-4000-8000-000000000005','Under six','speego-original','user','2026-02-01','2026-05-17','Chính thức','Chính thức'),
 ('00000000-0000-4000-8000-000000000006','Stop at six','speego-original','user','2026-01-01','2026-05-16','Nghỉ việc','Chính thức'),
 ('00000000-0000-4000-8000-000000000007','Continues working','speego-original','user','2026-01-01','2026-05-16','Chính thức','Chính thức');
set test.employee='00000000-0000-4000-8000-000000000002';
select public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000001',2026,5,9,'Confirmed opening through September');
select public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000003',2026,0,9,'Start probation accrual in October');
select public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000005',2026,5,9,'Confirmed opening through September');
select public.confirm_leave_continuation('00000000-0000-4000-8000-000000000001','continued','Continued contract after six complete months');
select public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000006',2026,5,9,'Conditional leave before decision');
select public.confirm_leave_continuation('00000000-0000-4000-8000-000000000006','stopped','Contract stops at six-month expiry');

-- 27 normal days in October; 13.5 is exactly 50%, despite a mix of paid/actual work.
insert into public.hr_records values('attendanceMonthSummaries::2026-10','attendanceMonthSummaries',
  jsonb_build_object('companyId','speego-original','generatedAt','2026-11-01T00:00:00Z','rows',jsonb_build_array(
    jsonb_build_object('employeeId','00000000-0000-4000-8000-000000000001','days',
      (select jsonb_object_agg(d::date::text,jsonb_build_object('regularWorkdaysExact',0.5)) from generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d where extract(dow from d)<>0)),
    jsonb_build_object('employeeId','00000000-0000-4000-8000-000000000003','days',
      (select jsonb_object_agg(d::date::text,jsonb_build_object('regularWorkdaysExact',1)) from generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d where extract(dow from d)<>0))
  )),now());
select public.recalculate_company_leave();
do $$ declare v_count integer; v_balance jsonb; begin
  assert public.leave_eligible_from('00000000-0000-4000-8000-000000000001')='2026-11-16', 'six complete official months';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'total')::numeric=6, 'exactly 50% accrues one day';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000003','speego-original',2026)->>'provisional')::numeric=1, 'probation is provisional until continuation';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000003','speego-original',2026)->>'total')::numeric=0, 'no grant before continuation';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000006','speego-original',2026)->>'total')::numeric=0, 'stopping at six months grants no days';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000006','speego-original',2026)->>'provisional')::numeric=0, 'stopped contract does not retain a conditional entitlement';
  begin
    perform public.adjust_monthly_leave_balance('00000000-0000-4000-8000-000000000006',2026,1,'settlement',null,'Cannot pay out conditional days');
    raise exception 'stopped contract unexpectedly paid out';
  exception when others then assert sqlerrm like '%tiếp tục làm%', 'stopped conditional leave cannot be paid out'; end;
  assert not (public.leave_year_balance('00000000-0000-4000-8000-000000000005','speego-original',2026)->>'eligible')::boolean, 'one day short of six months is locked';
  select count(*) into v_count from public.employee_leave_journal;
  perform public.recalculate_company_leave();
  assert (select count(*)=v_count from public.employee_leave_journal), 'rerunning makes no duplicate grants or history';
  v_balance:=public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026);
  perform public.save_monthly_leave('00000000-0000-4000-8000-000000000001',2026,'{"10":1.5}',(v_balance->>'version')::bigint,'HR confirms one and a half days');
  perform public.recalculate_company_leave();
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'total')::numeric=6.5, 'manual replaces automatic, survives rerun';
  begin
    perform public.save_monthly_leave('00000000-0000-4000-8000-000000000001',2026,'{"10":2}',(v_balance->>'version')::bigint,'Stale update');
    raise exception 'stale save unexpectedly accepted';
  exception when others then assert sqlerrm like '%vừa được cập nhật%', 'reject stale save'; end;
end; $$;

set test.employee='00000000-0000-4000-8000-000000000001';
-- Nov 21 Saturday and Nov 23 Monday: Sunday must not reserve or sync a paid day.
select public.submit_employee_approval('{"templateId":"leave","subject":"Leave","content":"Family leave","leaveStartDate":"2026-11-21","leaveEndDate":"2026-11-23","leaveDuration":"half","leaveType":"paid","leaveEmergency":true,"leaveEmergencyReason":"Emergency family situation"}');
do $$ declare v_preview jsonb; begin
  assert (select count(*)=2 and sum(amount)=1 from public.employee_leave_reservations where employee_id=public.current_hr_profile_id() and status='pending'), 'reserve working days only with halves';
  assert (public.my_approval_leave_balance(2026)->>'reserved')::numeric=1, 'pending is separate from used';
  begin
    perform public.submit_employee_approval('{"templateId":"leave","subject":"Overlap","content":"Duplicate day","leaveStartDate":"2026-11-21","leaveEndDate":"2026-11-21","leaveDuration":"full","leaveType":"paid","leaveEmergency":true,"leaveEmergencyReason":"Emergency"}');
    raise exception 'overlap unexpectedly accepted';
  exception when others then assert sqlerrm like '%Đã có đơn phép%', 'reject overlapping days'; end;
  begin
    perform public.configure_monthly_leave_year(public.current_hr_profile_id(),2025,100,0,'Unauthorized opening');
    raise exception 'employee unexpectedly credited leave';
  exception when insufficient_privilege then null; end;
end; $$;

set test.employee='00000000-0000-4000-8000-000000000002';
do $$ declare v_id text; begin
  select replace(id,'approvalRequests::','') into v_id from public.hr_records where collection='approvalRequests' and data->>'subject'='Leave';
  perform public.decide_employee_approval(v_id,'approved','');
  assert (select count(*)=2 from public.employee_leave_days where employee_id='00000000-0000-4000-8000-000000000001'), 'approved days exclude Sunday';
  assert not exists(select 1 from public.employee_leave_days where leave_date='2026-11-22'), 'no Sunday leave day';
  assert (select data->>'21'='0.5' and data->>'23'='0.5' and not data ? '22' from public.hr_records where id='manualWorkdays::2026-11__00000000-0000-4000-8000-000000000001'), 'payroll uses approved fractions only';
  delete from public.hr_records where id='approvalRequests::'||v_id;
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'used')::numeric=1, 'deleting finished request does not refund used leave';
end; $$;

set test.employee='00000000-0000-4000-8000-000000000005';
do $$ begin
  begin
    perform public.submit_employee_approval('{"templateId":"leave","subject":"Too early","content":"Before six complete months","leaveStartDate":"2026-11-20","leaveEndDate":"2026-11-20","leaveDuration":"full","leaveType":"paid","leaveEmergency":true,"leaveEmergencyReason":"Emergency"}');
    raise exception 'early use unexpectedly accepted';
  exception when others then assert sqlerrm like '%Chưa đủ điều kiện%', 'six months required even when future leave date qualifies'; end;
end; $$;

set test.employee='00000000-0000-4000-8000-000000000004';
do $$ begin
  begin
    perform public.adjust_monthly_leave_balance('00000000-0000-4000-8000-000000000001',2026,100,'adjustment',null,'Wrong company attempt');
    raise exception 'other company unexpectedly credited leave';
  exception when insufficient_privilege then null; end;
end; $$;

-- Check grants, not only RPC runtime branches.
set test.employee='00000000-0000-4000-8000-000000000002';
do $$ declare v_id text; v_balance jsonb; v_preview jsonb; v_before numeric; begin
  -- Late or corrected attendance can change the automatic calculation, never the override.
  update public.hr_records set data=jsonb_set(data,'{rows,0,days,2026-10-01,regularWorkdaysExact}','0') where id='attendanceMonthSummaries::2026-10';
  perform public.recalculate_company_leave();
  assert (select status='ineligible' and auto_units=0 and override_amount=1.5 from public.employee_leave_months where employee_id='00000000-0000-4000-8000-000000000001' and month=10), 'below fifty percent is ineligible; HR override is retained';
  v_balance:=public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026);
  perform public.save_monthly_leave('00000000-0000-4000-8000-000000000001',2026,'{"10":null}',(v_balance->>'version')::bigint,'Return to automatic after correction');
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'total')::numeric=5, 'clearing override restores recalculated amount';
  -- Restore the grant for subsequent concurrent-submission tests.
  v_balance:=public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026);
  perform public.save_monthly_leave('00000000-0000-4000-8000-000000000001',2026,'{"10":1.5}',(v_balance->>'version')::bigint,'Restore confirmed manual grant');
  insert into public.hr_records values('attendanceSettings::default','attendanceSettings','{"holidays":[{"date":"2026-11-24","name":"Configured holiday"}]}',now());
  assert not public.leave_is_workday('00000000-0000-4000-8000-000000000001','speego-original','2026-11-24'), 'holidays are excluded';
  insert into public.employee_shift_registrations values('00000000-0000-4000-8000-000000000001','speego-original','2026-11-29','approved');
  assert public.leave_is_workday('00000000-0000-4000-8000-000000000001','speego-original','2026-11-29'), 'approved Sunday shift counts as working day';
  delete from public.employee_shift_registrations; delete from public.hr_records where id='attendanceSettings::default';
  -- No early snapshot silently converts into a finalized zero.
  update public.hr_records set data=jsonb_set(data,'{generatedAt}','"2026-10-31T15:00:00Z"') where id='attendanceMonthSummaries::2026-10';
  perform public.recalculate_company_leave();
  assert (select status='pending' from public.employee_leave_months where employee_id='00000000-0000-4000-8000-000000000003' and month=10), 'snapshot generated before local month end stays pending';
  update public.hr_records set data=jsonb_set(data,'{generatedAt}','"2026-10-31T18:00:00Z"') where id='attendanceMonthSummaries::2026-10';
  perform public.recalculate_company_leave();
  assert (select status='qualified' from public.employee_leave_months where employee_id='00000000-0000-4000-8000-000000000003' and month=10), 'snapshot after local midnight counts even with prior UTC date';
  -- Five-year entitlement is accumulated in twelfths and rounded only once.
  perform public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000002',2026,0,0,'Tenure rounding fixture');
  perform public.confirm_leave_continuation('00000000-0000-4000-8000-000000000002','continued','Long-term employee continuing contract');
  insert into public.employee_leave_months(company_id,employee_id,year,month,auto_units,status)
    select 'speego-original','00000000-0000-4000-8000-000000000002',2026,m,13,'qualified' from generate_series(1,10) m;
  assert (public.my_approval_leave_balance(2026)->>'total')::numeric=11, 'ceil(130/12), not sum of rounded monthly grants';
  perform public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000001',2025,3,12,'Confirmed prior year');
  perform public.adjust_monthly_leave_balance('00000000-0000-4000-8000-000000000001',2026,2,'carryover',2025,'Carry two days per agreement');
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2025)->>'total')::numeric=1, 'carryover debits source';
  perform public.adjust_monthly_leave_balance('00000000-0000-4000-8000-000000000001',2026,2,'settlement',null,'Settlement of two unused days');
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'total')::numeric=6.5, 'settlement removes paid-out days';
  begin
    perform public.adjust_monthly_leave_balance('00000000-0000-4000-8000-000000000001',2026,1,'carryover',2023,'Outside three-year window');
    raise exception 'old carryover unexpectedly accepted';
  exception when others then assert sqlerrm like '%2 năm liền trước%', 'three-year grouping maximum'; end;
  -- Personal paid leave is independent of annual leave and works during probation.
  perform set_config('test.employee','00000000-0000-4000-8000-000000000003',true);
  v_id:=public.submit_employee_approval('{"templateId":"leave","subject":"Marriage","content":"Personal leave","leaveStartDate":"2026-11-24","leaveEndDate":"2026-11-26","leaveDuration":"full","leaveType":"personal_paid","leavePersonalReason":"marriage","leaveEmergency":true,"leaveEmergencyReason":"Emergency wedding"}');
  assert not exists(select 1 from public.employee_leave_reservations where request_id='approvalRequests::'||v_id), 'personal paid does not consume annual leave';
  perform set_config('test.employee','00000000-0000-4000-8000-000000000002',true);
  perform public.decide_employee_approval(v_id,'approved','');
  assert (select data->>'24'='1' from public.hr_records where id='manualWorkdays::2026-11__00000000-0000-4000-8000-000000000003'), 'personal paid counts for payroll';
  -- Pending requests release exactly once on rejection/deletion; there is no two-request cap.
  perform set_config('test.employee','00000000-0000-4000-8000-000000000001',true);
  for v_before in 17..19 loop
    v_id:=public.submit_employee_approval(jsonb_build_object('templateId','leave','subject','Release test','content','Pending reservation','leaveStartDate','2026-11-'||v_before::integer,
      'leaveEndDate','2026-11-'||v_before::integer,'leaveDuration','half','leaveType','paid','leaveEmergency',true,'leaveEmergencyReason','Emergency test'));
    if v_before=17 then
      perform set_config('test.employee','00000000-0000-4000-8000-000000000002',true);
      perform public.decide_employee_approval(v_id,'rejected','Operational coverage; suggest next week');
      perform set_config('test.employee','00000000-0000-4000-8000-000000000001',true);
    else delete from public.hr_records where id='approvalRequests::'||v_id; end if;
  end loop;
  assert (public.my_approval_leave_balance(2026)->>'reserved')::numeric=0, 'release on rejection and deletion';
  assert (public.my_approval_leave_month_usage(2026,11)->>'limit') is null, 'old monthly cap removed';
  begin
    perform public.submit_employee_approval('{"templateId":"leave","subject":"Too late","content":"No emergency","leaveStartDate":"2026-11-17","leaveEndDate":"2026-11-17","leaveDuration":"full","leaveType":"paid"}');
    raise exception 'insufficient notice unexpectedly accepted';
  exception when others then assert sqlerrm like '%báo trước%', 'enforce notice in database'; end;
end; $$;

set test.employee='00000000-0000-4000-8000-000000000002';
do $$ begin
  perform public.configure_monthly_leave_year('00000000-0000-4000-8000-000000000007',2026,6,9,'Provisional first six months');
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'total')::numeric=0, 'six months alone does not grant leave';
  insert into public.hr_records values('attendanceMonthSummaries::2026-11','attendanceMonthSummaries',
    '{"companyId":"speego-original","generatedAt":"2026-11-16T10:00:00Z","rows":[{"employeeId":"00000000-0000-4000-8000-000000000007","days":{"2026-11-16":{"regularWorkdaysExact":1,"paidLeaveWorkdays":0,"isHoliday":true,"hoursExact":0,"hasPunch":false}}}]}',now());
  perform public.recalculate_company_leave();
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'total')::numeric=0, 'paid holiday alone does not prove continuation';
  update public.hr_records set data=jsonb_set(data,'{rows,0,days,2026-11-16}',
    '{"regularWorkdaysExact":1,"paidLeaveWorkdays":0,"isHoliday":false,"hoursExact":8,"hasPunch":true}') where id='attendanceMonthSummaries::2026-11';
  perform public.recalculate_company_leave();
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'total')::numeric=6, 'actual work after six months releases first six months together';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'provisional')::numeric=0, 'provisional becomes granted, not double credited';
  update public.users set employment_status='Nghỉ việc' where id='00000000-0000-4000-8000-000000000007';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'total')::numeric=6, 'later resignation does not erase already earned grants';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'remaining')::numeric=0, 'resigned staff cannot make new leave requests';
  perform public.adjust_monthly_leave_balance('00000000-0000-4000-8000-000000000007',2026,6,'settlement',null,'Final settlement after continued employment');
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000007','speego-original',2026)->>'total')::numeric=0, 'earned unused grants can be settled on later resignation';
end; $$;

-- Assigned approver may have user role; do not require HR role to decide.
set test.employee='00000000-0000-4000-8000-000000000001';
do $$ declare v_id text; begin
  v_id:=public.submit_employee_approval('{"templateId":"leave","subject":"Leader test","content":"Unpaid request","leaveStartDate":"2026-11-20","leaveEndDate":"2026-11-20","leaveDuration":"full","leaveType":"unpaid","leaveEmergency":true,"leaveEmergencyReason":"Emergency fixture"}');
  begin
    update public.hr_records set data=jsonb_set(data,'{status}','"approved"') where id='approvalRequests::'||v_id;
    raise exception 'self approval unexpectedly accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('test.employee','00000000-0000-4000-8000-000000000002',true);
  update public.users set employment_status='Chính thức' where id='00000000-0000-4000-8000-000000000007';
  update public.hr_records set data=jsonb_set(data,'{approvalSteps,0,approverId}','"00000000-0000-4000-8000-000000000007"') where id='approvalRequests::'||v_id;
  perform set_config('test.employee','00000000-0000-4000-8000-000000000007',true);
  perform public.decide_employee_approval(v_id,'approved','');
  assert (select data->>'status'='approved' from public.hr_records where id='approvalRequests::'||v_id), 'assigned user-role approver can decide';
end; $$;

set role anon;
set test.employee='00000000-0000-4000-8000-000000000002';
do $$ begin
  assert (public.company_monthly_leave_board(2026) ? '00000000-0000-4000-8000-000000000001'), 'account-login HR can read checked RPC';
  begin perform public.run_monthly_leave_accrual(); raise exception 'anon scheduler unexpectedly accepted';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;

-- Global scheduler: no implicit conversion of an existing annual budget, and no duplicate grant on retry.
insert into public.employee_leave_settings values('other-company','00000000-0000-4000-8000-000000000004','{"2026":{"total_leave":12}}');
select public.run_monthly_leave_accrual();
do $$ declare v_count integer; begin
  assert not exists(select 1 from public.employee_leave_years where employee_id='00000000-0000-4000-8000-000000000004'), 'legacy annual total needs reconciliation';
  select count(*) into v_count from public.employee_leave_journal;
  perform public.run_monthly_leave_accrual();
  assert (select count(*)=v_count from public.employee_leave_journal), 'global scheduler is idempotent';
end; $$;

-- Re-applying the migration preserves grants, reservations and source links.
\ir ../migrations/20261117100000_monthly_leave_accrual.sql
create or replace function public.leave_today() returns date language sql stable as $$ select '2026-11-16'::date $$;
do $$ begin
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'total')::numeric=6.5, 'rerunning migration keeps opening, overrides, transfers and settlement';
  assert (public.leave_year_balance('00000000-0000-4000-8000-000000000001','speego-original',2026)->>'used')::numeric=1, 'rerunning migration does not refund a deleted approved request';
end; $$;

do $$ begin
  assert not has_function_privilege('anon','public.run_monthly_leave_accrual()','EXECUTE'), 'scheduler private';
  assert has_function_privilege('service_role','public.run_monthly_leave_accrual()','EXECUTE'), 'service can run scheduler';
  assert not has_table_privilege('anon','public.employee_leave_months','UPDATE'), 'cannot bypass monthly save';
end; $$;
select 'Monthly leave integration checks passed' result;
