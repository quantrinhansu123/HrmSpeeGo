-- Monthly grants are independent of availability (six complete official months).
-- Legacy annual totals stay untouched until HR reconciles an opening amount.
begin;

create table if not exists public.employee_leave_years (
  company_id text not null, employee_id uuid not null references public.users(id),
  year integer not null check (year between 2000 and 2100),
  opening numeric not null default 0 check (opening >= 0),
  through_month integer not null default 0 check (through_month between 0 and 12),
  version bigint not null default 1,
  primary key(company_id, employee_id, year)
);
create table if not exists public.employee_leave_months (
  company_id text not null, employee_id uuid not null, year integer not null,
  month integer not null check (month between 1 and 12),
  auto_units integer not null default 0 check (auto_units >= 0), -- units / 12; no cumulative float rounding
  override_amount numeric check (override_amount >= 0 and override_amount <= 366),
  status text not null default 'pending' check (status in ('pending','qualified','ineligible')),
  evidence jsonb not null default '{}'::jsonb,
  primary key(company_id, employee_id, year, month),
  foreign key(company_id, employee_id, year) references public.employee_leave_years
);
create table if not exists public.employee_leave_journal (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  employee_id uuid not null, year integer not null, month integer,
  kind text not null, amount numeric, note text not null,
  actor_id uuid, actor_name text, details jsonb not null default '{}'::jsonb,
  source_year integer, created_at timestamptz not null default clock_timestamp(),
  foreign key(company_id, employee_id, year) references public.employee_leave_years
);
create index if not exists leave_journal_employee_idx on public.employee_leave_journal(company_id,employee_id,year,created_at desc);
create table if not exists public.employee_leave_reservations (
  request_id text not null, company_id text not null, employee_id uuid not null references public.users(id),
  leave_date date not null, amount numeric not null check (amount in (0.5,1)),
  status text not null check (status in ('pending','approved','released')),
  primary key(request_id,leave_date)
);
create index if not exists leave_reservations_balance_idx on public.employee_leave_reservations(company_id,employee_id,leave_date,status);
create table if not exists public.employee_leave_continuation (
  company_id text not null,employee_id uuid not null references public.users(id),official_date date not null,
  decision text not null check(decision in ('continued','stopped')),note text not null,
  actor_id uuid,confirmed_at timestamptz not null default clock_timestamp(),
  primary key(company_id,employee_id)
);

create or replace function public.leave_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

create or replace function public.leave_is_scheduled_day(p_employee uuid,p_company text,p_date date)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_settings jsonb;
begin
  select data into v_settings from public.hr_records where id = 'attendanceSettings::default'
    and coalesce(nullif(data->>'companyId',''),'speego-original') = p_company;
  if exists(select 1 from public.employee_shift_registrations where employee_id = p_employee
    and company_id = p_company and work_date = p_date and status = 'approved') then return true; end if;
  return not (coalesce(v_settings->'weeklyOffDays','[0]'::jsonb) @> to_jsonb(extract(dow from p_date)::integer));
end;
$$;

create or replace function public.leave_is_workday(p_employee uuid,p_company text,p_date date)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_settings jsonb;
begin
  select data into v_settings from public.hr_records where id='attendanceSettings::default'
    and coalesce(nullif(data->>'companyId',''),'speego-original')=p_company;
  if exists(select 1 from jsonb_array_elements(coalesce(v_settings->'holidays','[]')) h
    where coalesce(h->>'date',h->>'day',trim(both '"' from h::text))=p_date::text) then return false; end if;
  return public.leave_is_scheduled_day(p_employee,p_company,p_date);
end;
$$;

create or replace function public.leave_eligible_from(p_employee uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select (official_date + interval '6 months')::date from public.users where id = p_employee
$$;

create or replace function public.leave_check_hr(p_employee uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company text := public.current_leave_company_id();
begin
  if coalesce(public.current_hr_role(),'') not in ('hr','admin') or not exists
    (select 1 from public.users where id = p_employee and coalesce(nullif(to_jsonb(users)->>'company_id',''),'speego-original') = v_company) then
    raise exception 'Chỉ HR/admin được điều chỉnh phép trong công ty của mình.' using errcode='42501';
  end if;
  return v_company;
end;
$$;

create or replace function public.leave_year_balance(p_employee uuid, p_company text, p_year integer)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_account public.employee_leave_years%rowtype; v_total numeric := 0; v_reserved numeric; v_used numeric;
  v_eligible date := public.leave_eligible_from(p_employee); v_active boolean; v_months jsonb; v_history jsonb;
  v_continuation text; v_provisional numeric:=0;
begin
  select * into v_account from public.employee_leave_years where company_id=p_company and employee_id=p_employee and year=p_year;
  select coalesce(sum(amount) filter(where status='pending'),0), coalesce(sum(amount) filter(where status='approved'),0)
    into v_reserved,v_used from public.employee_leave_reservations where company_id=p_company and employee_id=p_employee
    and extract(year from leave_date)=p_year;
  select v_eligible <= public.leave_today() and official_date <= public.leave_today()
    and coalesce(employment_status,'') not in ('Thử việc','Nghỉ việc','Tạm nghỉ')
    and (employment_status='Chính thức' or status='Chính thức') into v_active from public.users where id=p_employee;
  if v_account.employee_id is not null then
    select v_account.opening + ceil(coalesce(sum(auto_units) filter(where override_amount is null),0)::numeric / 12)
      + coalesce(sum(override_amount),0) into v_total from public.employee_leave_months
      where company_id=p_company and employee_id=p_employee and year=p_year
      and make_date(year,month,1) < date_trunc('month',public.leave_today());
    select v_total + coalesce(sum(amount),0) into v_total from public.employee_leave_journal
      where company_id=p_company and employee_id=p_employee and year=p_year
      and kind in ('adjustment','carryover','transfer_out','settlement');
  end if;
  select c.decision into v_continuation from public.employee_leave_continuation c join public.users u on u.id=c.employee_id
    where c.employee_id=p_employee and c.company_id=p_company and c.official_date=u.official_date;
  if v_continuation is distinct from 'continued' then
    v_provisional:=case when v_continuation='stopped' or exists(select 1 from public.users where id=p_employee and employment_status='Nghỉ việc') then 0 else greatest(0,v_total) end;
    v_total:=0; v_active:=false;
  end if;
  select coalesce(jsonb_object_agg(month::text,jsonb_build_object('automatic',auto_units::numeric/12,
    'override',override_amount,'amount',coalesce(override_amount,auto_units::numeric/12),'status',status,'evidence',evidence)),'{}')
    into v_months from public.employee_leave_months where company_id=p_company and employee_id=p_employee and year=p_year;
  select coalesce(jsonb_agg(to_jsonb(j) order by created_at desc),'[]') into v_history from
    (select id,kind,amount,note,month,actor_name,created_at,details from public.employee_leave_journal
      where company_id=p_company and employee_id=p_employee and year=p_year order by created_at desc limit 100) j;
  return jsonb_build_object('year',p_year,'configured',v_account.employee_id is not null,
    'version',v_account.version,'opening',v_account.opening,'through_month',v_account.through_month,
    'eligible_from',v_eligible,'eligible',coalesce(v_active,false),'total',v_total,'used',v_used,'reserved',v_reserved,
    'continuation',v_continuation,'continued',coalesce(v_continuation='continued',false),'provisional',v_provisional,
    'locked',case when coalesce(v_active,false) then 0 else greatest(0,v_total-v_used-v_reserved) end,
    'remaining',case when coalesce(v_active,false) then v_total-v_used-v_reserved else 0 end,
    'months',v_months,'history',v_history,'legacy_total',(select leave_data->p_year::text->'total_leave'
      from public.employee_leave_settings where company_id=p_company and employee_id=p_employee));
end;
$$;

create or replace function public.confirm_leave_continuation(p_employee_id uuid,p_decision text,p_note text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company text:=public.leave_check_hr(p_employee_id); v_user public.users%rowtype;
begin
  select * into v_user from public.users where id=p_employee_id for update;
  if v_user.official_date is null or public.leave_eligible_from(p_employee_id)>public.leave_today() then
    raise exception 'Chỉ xác nhận tiếp tục/dừng khi đã đủ 6 tháng tròn từ ngày chính thức.';
  end if;
  if p_decision is null or p_decision not in ('continued','stopped') or length(btrim(coalesce(p_note,''))) not between 5 and 2000 then
    raise exception 'Chọn tiếp tục/dừng và ghi lý do từ 5 đến 2.000 ký tự.';
  end if;
  if p_decision='continued' and (coalesce(v_user.employment_status,'') in ('Thử việc','Nghỉ việc','Tạm nghỉ')
    or not (coalesce(v_user.employment_status,'')='Chính thức' or coalesce(v_user.status,'')='Chính thức')) then
    raise exception 'Nhân viên cần ở trạng thái chính thức đang làm để xác nhận tiếp tục.';
  end if;
  if p_decision='stopped' and exists(select 1 from public.employee_leave_continuation where employee_id=p_employee_id
    and company_id=v_company and official_date=v_user.official_date and decision='continued') then
    raise exception 'Đã xác nhận tiếp tục sau 6 tháng: phép đã được cấp không tự mất khi nghỉ việc. Hãy đối soát số dư.';
  end if;
  insert into public.employee_leave_continuation(company_id,employee_id,official_date,decision,note,actor_id)
    values(v_company,p_employee_id,v_user.official_date,p_decision,btrim(p_note),public.current_hr_profile_id())
    on conflict(company_id,employee_id) do update set official_date=excluded.official_date,decision=excluded.decision,
      note=excluded.note,actor_id=excluded.actor_id,confirmed_at=clock_timestamp();
  insert into public.employee_leave_journal(company_id,employee_id,year,kind,note,actor_id,actor_name)
    select company_id,employee_id,year,'continuation_'||p_decision,btrim(p_note),public.current_hr_profile_id(),
      (select name from public.users where id=public.current_hr_profile_id()) from public.employee_leave_years where company_id=v_company and employee_id=p_employee_id;
  update public.employee_leave_years set version=version+1 where company_id=v_company and employee_id=p_employee_id;
end;
$$;

-- Actual work after the anniversary confirms continuation automatically. An active
-- profile alone is insufficient when HR has not yet recorded a contract ending.
create or replace function public.maybe_confirm_leave_continuation(p_employee uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user public.users%rowtype; v_company text; v_eligible date; v_decision text;
begin
  select * into v_user from public.users where id=p_employee for update;
  v_eligible:=public.leave_eligible_from(p_employee);
  if v_eligible is null or v_eligible>public.leave_today() then return; end if;
  v_company:=coalesce(nullif(to_jsonb(v_user)->>'company_id',''),'speego-original');
  select decision into v_decision from public.employee_leave_continuation where company_id=v_company and employee_id=p_employee and official_date=v_user.official_date;
  if v_decision is not null or coalesce(v_user.employment_status,'') in ('Thử việc','Nghỉ việc','Tạm nghỉ') then return; end if;
  if exists(select 1 from public.hr_records r cross join lateral jsonb_array_elements(coalesce(r.data->'rows','[]')) employee
    cross join lateral jsonb_each(coalesce(employee->'days','{}')) d
    where r.collection='attendanceMonthSummaries' and coalesce(nullif(r.data->>'companyId',''),'speego-original')=v_company
    and employee->>'employeeId'=p_employee::text and d.key>=v_eligible::text and d.key<=public.leave_today()::text
    and (coalesce((d.value->>'hasPunch')::boolean,false)
      or coalesce((d.value->>'hoursExact')::numeric,(d.value->>'hours')::numeric,0)>0
      or (coalesce((d.value->>'manualOverride')::boolean,false) and not coalesce((d.value->>'isHoliday')::boolean,false)))
    and coalesce((d.value->>'regularWorkdaysExact')::numeric,(d.value->>'regularWorkdays')::numeric,(d.value->>'workdays')::numeric,0)
      -coalesce((d.value->>'paidLeaveWorkdays')::numeric,0)>0) then
    insert into public.employee_leave_continuation(company_id,employee_id,official_date,decision,note)
      values(v_company,p_employee,v_user.official_date,'continued','Có ngày làm việc thực tế sau mốc đủ 6 tháng')
      on conflict(company_id,employee_id) do update set official_date=excluded.official_date,decision=excluded.decision,note=excluded.note,actor_id=null,confirmed_at=clock_timestamp();
    insert into public.employee_leave_journal(company_id,employee_id,year,kind,note)
      select company_id,employee_id,year,'continuation_continued','Tự xác nhận tiếp tục từ ngày làm việc thực tế sau 6 tháng'
      from public.employee_leave_years where company_id=v_company and employee_id=p_employee;
    update public.employee_leave_years set version=version+1 where company_id=v_company and employee_id=p_employee;
  end if;
end;
$$;

create or replace function public.company_monthly_leave_board(p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_year not between 2000 and 2100 then raise exception 'Năm phép không hợp lệ.'; end if;
  if coalesce(public.current_hr_role(),'') not in ('hr','admin','manager') then raise exception 'Không có quyền xem bảng phép.' using errcode='42501'; end if;
  return (select coalesce(jsonb_object_agg(id::text,public.leave_year_balance(id,public.current_leave_company_id(),p_year)),'{}')
    from public.users where coalesce(nullif(to_jsonb(users)->>'company_id',''),'speego-original')=public.current_leave_company_id());
end;
$$;

create or replace function public.my_approval_leave_balance(p_year integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.current_hr_profile_id() is null then raise exception 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  if p_year not between 2000 and 2100 then raise exception 'Năm phép không hợp lệ.'; end if;
  return public.leave_year_balance(public.current_hr_profile_id(),public.current_leave_company_id(),p_year);
end;
$$;

create or replace function public.configure_monthly_leave_year(p_employee_id uuid,p_year integer,p_opening numeric,p_through_month integer,p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company text := public.leave_check_hr(p_employee_id); v_actor public.users%rowtype;
begin
  if p_year is null or p_year not between 2000 and 2100 or p_opening is null or p_opening < 0 or p_opening > 1098
    or p_through_month is null or p_through_month not between 0 and 12 then raise exception 'Số đầu kỳ không hợp lệ.'; end if;
  if length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Ghi chú cần từ 5 đến 2.000 ký tự.'; end if;
  if p_through_month > 0 and make_date(p_year,p_through_month,1) >= date_trunc('month',public.leave_today()) then
    raise exception 'Chỉ đối soát số đầu kỳ đến hết tháng đã kết thúc.';
  end if;
  perform 1 from public.users where id=p_employee_id for update;
  select * into v_actor from public.users where id=public.current_hr_profile_id();
  insert into public.employee_leave_years(company_id,employee_id,year,opening,through_month)
    values(v_company,p_employee_id,p_year,p_opening,p_through_month);
  insert into public.employee_leave_journal(company_id,employee_id,year,kind,amount,note,actor_id,actor_name,details)
    values(v_company,p_employee_id,p_year,'opening',p_opening,btrim(p_note),v_actor.id,v_actor.name,jsonb_build_object('through_month',p_through_month));
  return public.leave_year_balance(p_employee_id,v_company,p_year);
end;
$$;

create or replace function public.save_monthly_leave(p_employee_id uuid,p_year integer,p_months jsonb,p_expected_version bigint,p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company text := public.leave_check_hr(p_employee_id); v_account public.employee_leave_years%rowtype;
  v_month record; v_amount numeric; v_old numeric; v_actor public.users%rowtype;
begin
  if length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Lý do cần từ 5 đến 2.000 ký tự.'; end if;
  if p_months is null or jsonb_typeof(p_months)<>'object' then raise exception 'Dữ liệu tháng không hợp lệ.'; end if;
  perform 1 from public.users where id=p_employee_id for update;
  select * into v_account from public.employee_leave_years where company_id=v_company and employee_id=p_employee_id and year=p_year for update;
  if v_account.employee_id is null then raise exception 'Cần đối soát số đầu kỳ trước.'; end if;
  if p_expected_version is distinct from v_account.version then raise exception 'Phép vừa được cập nhật. Hãy tải lại trước khi lưu.'; end if;
  select * into v_actor from public.users where id=public.current_hr_profile_id();
  for v_month in select key,value from jsonb_each(p_months) loop
    if v_month.key !~ '^([1-9]|1[0-2])$' or (v_month.value<>'null' and jsonb_typeof(v_month.value)<>'number') then raise exception 'Số phép tháng không hợp lệ.'; end if;
    v_amount := case when v_month.value='null' then null else v_month.value::text::numeric end;
    if v_amount < 0 or v_amount > 366 then raise exception 'Số phép tháng phải từ 0 đến 366.'; end if;
    select override_amount into v_old from public.employee_leave_months where company_id=v_company and employee_id=p_employee_id and year=p_year and month=v_month.key::integer;
    if v_amount is not distinct from v_old then continue; end if;
    if v_month.key::integer <= v_account.through_month then raise exception 'Tháng này đã nằm trong số đầu kỳ.'; end if;
    if make_date(p_year,v_month.key::integer,1)>=date_trunc('month',public.leave_today()) then raise exception 'Chỉ cấp phép cho tháng đã kết thúc.'; end if;
    insert into public.employee_leave_months(company_id,employee_id,year,month,override_amount)
      values(v_company,p_employee_id,p_year,v_month.key::integer,v_amount)
      on conflict(company_id,employee_id,year,month) do update set override_amount=excluded.override_amount;
    insert into public.employee_leave_journal(company_id,employee_id,year,month,kind,amount,note,actor_id,actor_name,details)
      values(v_company,p_employee_id,p_year,v_month.key::integer,'monthly_override',v_amount,btrim(p_note),v_actor.id,v_actor.name,jsonb_build_object('previous',v_old));
  end loop;
  update public.employee_leave_years set version=version+1 where company_id=v_company and employee_id=p_employee_id and year=p_year;
  return public.leave_year_balance(p_employee_id,v_company,p_year);
end;
$$;

create or replace function public.adjust_monthly_leave_balance(p_employee_id uuid,p_year integer,p_amount numeric,p_kind text,p_source_year integer,p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company text := public.leave_check_hr(p_employee_id); v_actor public.users%rowtype; v_balance jsonb;
begin
  if p_amount is null or p_amount=0 or abs(p_amount)>1098 or p_kind is null or p_kind not in ('adjustment','carryover','settlement') then raise exception 'Giao dịch không hợp lệ.'; end if;
  if length(btrim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Lý do cần từ 5 đến 2.000 ký tự.'; end if;
  perform 1 from public.users where id=p_employee_id for update;
  if not exists(select 1 from public.employee_leave_years where company_id=v_company and employee_id=p_employee_id and year=p_year) then raise exception 'Chưa đối soát năm nhận phép.'; end if;
  select * into v_actor from public.users where id=public.current_hr_profile_id();
  if p_kind='carryover' then
    if p_amount<=0 or p_source_year is null or p_source_year not between p_year-2 and p_year-1 then raise exception 'Chỉ gộp phép từ 2 năm liền trước theo thỏa thuận.'; end if;
    -- Do not renew carried-over days indefinitely: only native, unspent grants can be transferred.
    v_balance := public.leave_year_balance(p_employee_id,v_company,p_source_year);
    if (v_balance->>'total')::numeric - (v_balance->>'used')::numeric - (v_balance->>'reserved')::numeric
      - coalesce((select sum(amount) from public.employee_leave_journal where company_id=v_company and employee_id=p_employee_id and year=p_source_year and kind='carryover'),0) < p_amount then
      raise exception 'Năm nguồn không đủ phép gốc còn lại để gộp.';
    end if;
    insert into public.employee_leave_journal(company_id,employee_id,year,kind,amount,note,actor_id,actor_name,source_year)
      values(v_company,p_employee_id,p_source_year,'transfer_out',-p_amount,btrim(p_note),v_actor.id,v_actor.name,p_year);
    update public.employee_leave_years set version=version+1 where company_id=v_company and employee_id=p_employee_id and year=p_source_year;
  elsif p_kind='settlement' then
    if not exists(select 1 from public.employee_leave_continuation c join public.users u on u.id=c.employee_id
      where c.employee_id=p_employee_id and c.company_id=v_company and c.official_date=u.official_date and c.decision='continued') then
      raise exception 'Chỉ thanh toán phần phép đã xác nhận tiếp tục làm sau đủ 6 tháng.';
    end if;
    v_balance:=public.leave_year_balance(p_employee_id,v_company,p_year);
    if p_amount<=0 or (v_balance->>'total')::numeric-(v_balance->>'used')::numeric-(v_balance->>'reserved')::numeric<p_amount then raise exception 'Không đủ phép chưa nghỉ để thanh toán.'; end if;
  end if;
  insert into public.employee_leave_journal(company_id,employee_id,year,kind,amount,note,actor_id,actor_name,source_year)
    values(v_company,p_employee_id,p_year,p_kind,case when p_kind='settlement' then -p_amount else p_amount end,btrim(p_note),v_actor.id,v_actor.name,case when p_kind='carryover' then p_source_year end);
  update public.employee_leave_years set version=version+1 where company_id=v_company and employee_id=p_employee_id and year=p_year;
  return public.leave_year_balance(p_employee_id,v_company,p_year);
end;
$$;

-- Private, rerunnable recalculation. Missing/early snapshots remain pending, not zero entitlement.
create or replace function public.accrue_employee_leave(p_employee uuid,p_year integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user public.users%rowtype; v_company text; v_account public.employee_leave_years%rowtype;
  v_month integer; v_date date; v_end date; v_day date; v_summary jsonb; v_row jsonb;
  v_normal numeric; v_worked numeric; v_units integer; v_status text; v_old public.employee_leave_months%rowtype;
  v_evidence jsonb; v_count integer:=0; v_state text;
begin
  select * into v_user from public.users where id=p_employee for update;
  v_company:=coalesce(nullif(to_jsonb(v_user)->>'company_id',''),'speego-original');
  select * into v_account from public.employee_leave_years where company_id=v_company and employee_id=p_employee and year=p_year for update;
  if v_account.employee_id is null then return 0; end if;
  perform public.maybe_confirm_leave_continuation(p_employee);
  for v_month in select generate_series(v_account.through_month+1,12) loop
    v_date:=make_date(p_year,v_month,1); v_end:=(v_date+interval '1 month')::date;
    if v_end>public.leave_today() then exit; end if;
    v_units:=0; v_status:='pending'; v_normal:=0; v_worked:=0;
    select data into v_summary from public.hr_records where id='attendanceMonthSummaries::'||to_char(v_date,'YYYY-MM')
      and coalesce(nullif(data->>'companyId',''),'speego-original')=v_company;
    select value into v_row from jsonb_array_elements(coalesce(v_summary->'rows','[]')) where value->>'employeeId'=p_employee::text limit 1;
    if v_user.join_date is not null and v_row is not null
      and (nullif(v_summary->>'generatedAt','')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date>=v_end then
      for v_day in select generate_series(v_date,v_end-1,interval '1 day')::date loop
        if public.leave_is_scheduled_day(p_employee,v_company,v_day) then
          v_normal:=v_normal+1;
          select new_status into v_state from public.employee_status_history where employee_id=p_employee and effective_date<=v_day order by effective_date desc limit 1;
          if v_day>=v_user.join_date and coalesce(v_state,'') not in ('Nghỉ việc','Tạm nghỉ') then
            -- Paid public holidays count towards the 50% threshold, but are never charged as annual leave.
            v_worked:=v_worked+case when not public.leave_is_workday(p_employee,v_company,v_day) then 1
              else least(1,greatest(0,coalesce((v_row->'days'->v_day::text->>'regularWorkdaysExact')::numeric,
              (v_row->'days'->v_day::text->>'regularWorkdays')::numeric,(v_row->'days'->v_day::text->>'workdays')::numeric,0))) end;
          end if;
        end if;
      end loop;
      v_status:=case when v_normal>0 and v_worked>=v_normal*0.5 then 'qualified' else 'ineligible' end;
      if v_status='qualified' then v_units:=12+floor(extract(year from age(v_end-1,v_user.join_date))/5)::integer; end if;
    end if;
    v_evidence:=jsonb_build_object('normal_days',v_normal,'paid_workdays',v_worked,'snapshot_at',v_summary->>'generatedAt');
    select * into v_old from public.employee_leave_months where company_id=v_company and employee_id=p_employee and year=p_year and month=v_month;
    if v_old.month is null or (v_old.auto_units,v_old.status,v_old.evidence) is distinct from (v_units,v_status,v_evidence) then
      insert into public.employee_leave_months(company_id,employee_id,year,month,auto_units,status,evidence)
        values(v_company,p_employee,p_year,v_month,v_units,v_status,v_evidence)
        on conflict(company_id,employee_id,year,month) do update set auto_units=excluded.auto_units,status=excluded.status,evidence=excluded.evidence;
      insert into public.employee_leave_journal(company_id,employee_id,year,month,kind,amount,note,details)
        values(v_company,p_employee,p_year,v_month,'automatic',v_units::numeric/12,'Đối soát phép cuối tháng',v_evidence||jsonb_build_object('previous_units',v_old.auto_units));
      update public.employee_leave_years set version=version+1 where company_id=v_company and employee_id=p_employee and year=p_year;
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.run_monthly_leave_accrual() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user record; v_year record; v_current integer:=extract(year from public.leave_today()); v_count integer:=0;
begin
  for v_user in select id,coalesce(nullif(to_jsonb(users)->>'company_id',''),'speego-original') company from public.users
    where join_date<=public.leave_today() and employment_status in ('Thử việc','Chính thức') order by id loop
    perform 1 from public.users where id=v_user.id for update;
    if not exists(select 1 from public.employee_leave_settings where company_id=v_user.company and employee_id=v_user.id and leave_data ? v_current::text) then
      insert into public.employee_leave_years(company_id,employee_id,year) values(v_user.company,v_user.id,v_current) on conflict do nothing;
    end if;
  end loop;
  for v_year in select employee_id,year from public.employee_leave_years where year between v_current-2 and v_current order by employee_id,year loop
    v_count:=v_count+public.accrue_employee_leave(v_year.employee_id,v_year.year);
  end loop;
  return v_count;
end;
$$;

create or replace function public.recalculate_company_leave() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_year record; v_count integer:=0;
begin
  if coalesce(public.current_hr_role(),'') not in ('hr','admin') then raise exception 'Chỉ HR/admin được đối soát phép.' using errcode='42501'; end if;
  for v_year in select employee_id,year from public.employee_leave_years where company_id=public.current_leave_company_id()
    and year<=extract(year from public.leave_today()) order by employee_id,year loop
    v_count:=v_count+public.accrue_employee_leave(v_year.employee_id,v_year.year);
  end loop;
  return v_count;
end;
$$;

create or replace function public.my_approval_leave_month_usage(p_year integer,p_month integer) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_used integer;
begin
  if public.current_hr_profile_id() is null then raise exception 'Tài khoản chưa liên kết nhân sự.'; end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then raise exception 'Tháng phép không hợp lệ.'; end if;
  select count(distinct request_id) into v_used from public.employee_leave_reservations
    where company_id=public.current_leave_company_id() and employee_id=public.current_hr_profile_id()
    and extract(year from leave_date)=p_year and extract(month from leave_date)=p_month and status in ('pending','approved');
  return jsonb_build_object('year',p_year,'month',p_month,'used',v_used,'limit',null,'remaining',null);
end;
$$;

-- Eliminate the unrelated two-requests-per-month restriction at the database too.
drop trigger if exists approval_monthly_paid_leave_limit on public.hr_records;

create or replace function public.monthly_leave_request_days(p_data jsonb,p_request_id text default null)
returns table(day date,amount numeric) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_start date; v_end date; v_employee uuid; v_company text; v_date date; v_effective date;
begin
  if coalesce(p_data->>'leaveStartDate',p_data->>'leaveDate','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_data->>'leaveEndDate',p_data->>'leaveStartDate',p_data->>'leaveDate','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Ngày nghỉ không hợp lệ.' using errcode='22023'; end if;
  v_start:=coalesce(p_data->>'leaveStartDate',p_data->>'leaveDate')::date;
  v_end:=coalesce(p_data->>'leaveEndDate',p_data->>'leaveStartDate',p_data->>'leaveDate')::date;
  if v_end<v_start or v_end-v_start>=366 then raise exception 'Khoảng ngày nghỉ không hợp lệ (tối đa 366 ngày).' using errcode='22023'; end if;
  v_employee:=(p_data->>'requesterId')::uuid;
  v_company:=coalesce(nullif(p_data->>'companyId',''),'speego-original');
  if not exists(select 1 from public.users where id=v_employee and coalesce(nullif(to_jsonb(users)->>'company_id',''),'speego-original')=v_company) then
    raise exception 'Nhân sự và công ty trên đơn không khớp.' using errcode='22023';
  end if;
  for v_date in select generate_series(v_start,v_end,interval '1 day')::date loop
    select leave_date into v_effective from public.employee_leave_days
      where approval_request_id=p_request_id and original_leave_date=v_date limit 1;
    v_effective:=coalesce(v_effective,v_date);
    if public.leave_is_workday(v_employee,v_company,v_effective) then
      day:=v_effective; amount:=case when p_data->>'leaveDuration'='half' then 0.5 else 1 end; return next;
    end if;
  end loop;
end;
$$;

create or replace function public.monthly_leave_preview(p_data jsonb,p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_data jsonb; v_company text; v_days jsonb; v_by_year jsonb; v_balances jsonb;
  v_notice integer; v_count integer; v_start date; v_required integer; v_due date:=public.leave_today();
begin
  select coalesce(nullif(to_jsonb(users)->>'company_id',''),'speego-original') into v_company from public.users where id=p_employee;
  if v_company is null then raise exception 'Không tìm thấy hồ sơ nhân sự.'; end if;
  v_data:=p_data||jsonb_build_object('requesterId',p_employee,'companyId',v_company);
  if coalesce(v_data->>'leaveDuration','') not in ('full','half') or coalesce(v_data->>'leaveType','') not in ('paid','unpaid','personal_paid') then raise exception 'Loại nghỉ hoặc thời lượng không hợp lệ.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('date',day,'amount',amount) order by day),'[]'),count(*)
    into v_days,v_count from public.monthly_leave_request_days(v_data);
  if v_count=0 then raise exception 'Khoảng ngày đã chọn không có ngày làm việc cần xin nghỉ.'; end if;
  select jsonb_object_agg(leave_year::text,amount),jsonb_object_agg(leave_year::text,public.leave_year_balance(p_employee,v_company,leave_year))
    into v_by_year,v_balances from (select extract(year from day)::integer as leave_year,sum(amount) amount from public.monthly_leave_request_days(v_data) group by 1) s;
  v_start:=(v_days->0->>'date')::date;
  select count(*) into v_notice from generate_series(public.leave_today(),v_start-1,interval '1 day') d
    where public.leave_is_workday(p_employee,v_company,d::date);
  v_required:=case when v_count>=3 then 7 else 3 end;
  v_count:=0;
  while v_count<2 loop v_due:=v_due+1; if public.leave_is_workday(p_employee,v_company,v_due) then v_count:=v_count+1; end if; end loop;
  return jsonb_build_object('days',v_days,'by_year',v_by_year,'balances',v_balances,'notice_workdays',v_notice,
    'required_notice',v_required,'response_due',v_due,'eligible_from',public.leave_eligible_from(p_employee));
end;
$$;

create or replace function public.preview_monthly_leave_request(p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if public.current_hr_profile_id() is null then raise exception 'Tài khoản chưa liên kết nhân sự.'; end if;
  return public.monthly_leave_preview(p_data,public.current_hr_profile_id());
end;
$$;

-- One validator covers employee RPCs, HR direct writes, edits and approvals.
create or replace function public.enforce_monthly_leave_request() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_employee uuid; v_company text; v_preview jsonb; v_item record; v_balance jsonb;
  v_previous numeric; v_type text; v_limit integer; v_same boolean:=false; v_is_leave boolean; v_decision boolean:=false;
begin
  if new.collection<>'approvalRequests' then return new; end if;
  v_is_leave:=coalesce(new.data->>'templateId','')='leave' or coalesce(new.data->>'templateBaseId','')='leave' or coalesce(new.data->>'attendanceSync','')='paid-leave';
  if tg_op='UPDATE' then
    if (new.data->>'requesterId',coalesce(new.data->>'companyId','speego-original'))
      is distinct from (old.data->>'requesterId',coalesce(old.data->>'companyId','speego-original')) then
      raise exception 'Không được đổi nhân viên hoặc công ty của đơn phép đã gửi.';
    end if;
    if exists(select 1 from public.employee_leave_reservations where request_id=old.id and status='approved')
      and (not v_is_leave or new.data->>'status' is distinct from 'approved' or new.data->>'requesterId' is distinct from old.data->>'requesterId'
        or new.data->>'leaveType' is distinct from old.data->>'leaveType' or new.data->>'leaveStartDate' is distinct from old.data->>'leaveStartDate'
        or new.data->>'leaveEndDate' is distinct from old.data->>'leaveEndDate' or new.data->>'leaveDuration' is distinct from old.data->>'leaveDuration') then
      raise exception 'Đơn đã duyệt phải điều chỉnh qua Ngày nghỉ phép để giữ lịch sử.';
    end if;
    if not v_is_leave then
      if old.data->>'requesterId' is distinct from public.current_hr_profile_id()::text
        and coalesce(public.current_hr_role(),'') not in ('hr','admin','manager') then
        raise exception 'Không được sửa đơn phép của người khác.' using errcode='42501';
      end if;
      update public.employee_leave_reservations set status='released' where request_id=old.id and status='pending';
      return new;
    end if;
    v_same:=(new.data->>'leaveStartDate',new.data->>'leaveEndDate',new.data->>'leaveDuration',new.data->>'leaveType',new.data->>'requesterId')
      is not distinct from (old.data->>'leaveStartDate',old.data->>'leaveEndDate',old.data->>'leaveDuration',old.data->>'leaveType',old.data->>'requesterId');
  elsif not v_is_leave then return new; end if;
  v_employee:=(new.data->>'requesterId')::uuid;
  select coalesce(nullif(to_jsonb(users)->>'company_id',''),'speego-original') into v_company from public.users where id=v_employee for update;
  if tg_op='UPDATE' and v_same and (new.data-array['status','approvalSteps','currentStepIndex','attendanceSyncStatus','attendanceSyncedAt'])
    is not distinct from (old.data-array['status','approvalSteps','currentStepIndex','attendanceSyncStatus','attendanceSyncedAt']) then
    v_decision:=coalesce(old.data->'approvalSteps'->coalesce((old.data->>'currentStepIndex')::integer,0)->>'approverId'=public.current_hr_profile_id()::text,false)
      or exists(select 1 from public.users leader join public.users employee on employee.id=v_employee
        where leader.id=public.current_hr_profile_id() and (leader.is_team_leader or coalesce(leader.position,'') ~* 'leader|trưởng')
        and nullif(btrim(leader.department),'') is not null and lower(btrim(leader.department))=lower(btrim(employee.department))
        and (nullif(btrim(leader.branch),'') is null or nullif(btrim(employee.branch),'') is null or lower(btrim(leader.branch))=lower(btrim(employee.branch))));
  end if;
  if v_company is null or v_company is distinct from public.current_leave_company_id()
    or (v_employee is distinct from public.current_hr_profile_id() and coalesce(public.current_hr_role(),'') not in ('hr','admin','manager') and not v_decision) then
    raise exception 'Không có quyền gửi/sửa phép cho nhân sự này.' using errcode='42501';
  end if;
  if coalesce(nullif(new.data->>'companyId',''),'speego-original')<>v_company then raise exception 'Đơn không đúng công ty.'; end if;
  if coalesce(public.current_hr_role(),'') not in ('hr','admin','manager') then
    if tg_op='INSERT' then
      if new.data->>'status' is distinct from 'pending' or jsonb_array_length(coalesce(new.data->'approvalSteps','[]'))<>1
        or new.data->'approvalSteps'->0->>'approverId' is distinct from public.my_team_leader()->>'id' then
        raise exception 'Nhân viên phải gửi đơn chờ duyệt đến quản lý trực tiếp.' using errcode='42501';
      end if;
    elsif not v_decision and (new.data->>'status',new.data->'approvalSteps',new.data->>'currentStepIndex')
      is distinct from (old.data->>'status',old.data->'approvalSteps',old.data->>'currentStepIndex') then
      raise exception 'Nhân viên không được tự đổi người duyệt hoặc tự duyệt đơn phép.' using errcode='42501';
    end if;
  end if;
  if new.data->>'status' not in ('pending','approved') then
    update public.employee_leave_reservations set status='released' where request_id=new.id and status='pending';
    return new;
  end if;
  v_preview:=public.monthly_leave_preview(new.data,v_employee);
  v_type:=new.data->>'leaveType';
  if tg_op='INSERT' or not v_same then
    if coalesce(new.data->>'leaveEmergency','false')='true' then
      if length(btrim(coalesce(new.data->>'leaveEmergencyReason','')))<5 then raise exception 'Nghỉ khẩn cấp cần nêu rõ lý do (ít nhất 5 ký tự).'; end if;
    elsif (v_preview->>'notice_workdays')::integer<(v_preview->>'required_notice')::integer then
      raise exception 'Cần báo trước ít nhất % ngày làm việc, hoặc khai báo trường hợp khẩn cấp.',v_preview->>'required_notice';
    end if;
  end if;
  if v_type='personal_paid' then
    v_limit:=case new.data->>'leavePersonalReason' when 'marriage' then 3 when 'child_marriage' then 1 when 'bereavement' then 3 else 0 end;
    if v_limit=0 or (select sum((x->>'amount')::numeric) from jsonb_array_elements(v_preview->'days') x)>v_limit then raise exception 'Nghỉ việc riêng hưởng lương vượt số ngày theo lý do đã chọn.'; end if;
  elsif v_type='paid' then
    if (v_preview->>'eligible_from') is null or (new.data->>'leaveStartDate')::date<(v_preview->>'eligible_from')::date then
      raise exception 'Chỉ được dùng phép sau đủ 6 tháng tròn từ ngày chính thức (%).',coalesce(v_preview->>'eligible_from','thiếu ngày chính thức');
    end if;
    for v_item in select key,value from jsonb_each(v_preview->'by_year') loop
      v_balance:=v_preview->'balances'->v_item.key;
      if not (v_balance->>'configured')::boolean then raise exception 'Cần HR đối soát phép năm % trước khi sử dụng.',v_item.key; end if;
      if not (v_balance->>'eligible')::boolean then raise exception 'Chưa đủ điều kiện sử dụng phép: cần chính thức đủ 6 tháng tròn, tiếp tục hợp đồng và đang làm việc.'; end if;
      select coalesce(sum(amount),0) into v_previous from public.employee_leave_reservations where request_id=new.id
        and status in ('pending','approved') and extract(year from leave_date)=v_item.key::integer;
      if (v_balance->>'remaining')::numeric+v_previous<v_item.value::text::numeric then raise exception 'Năm % không đủ phép khả dụng (còn % ngày).',v_item.key,(v_balance->>'remaining')::numeric+v_previous; end if;
    end loop;
    if exists(select 1 from public.employee_leave_reservations r join jsonb_array_elements(v_preview->'days') x
      on r.leave_date=(x->>'date')::date where r.employee_id=v_employee and r.company_id=v_company and r.status in ('pending','approved') and r.request_id<>new.id) then raise exception 'Đã có đơn phép cho một trong các ngày đã chọn.'; end if;
  end if;
  update public.employee_leave_reservations set status='released' where request_id=new.id and status='pending';
  if v_type='paid' then
    insert into public.employee_leave_reservations(request_id,company_id,employee_id,leave_date,amount,status)
      select new.id,v_company,v_employee,(x->>'date')::date,(x->>'amount')::numeric,new.data->>'status' from jsonb_array_elements(v_preview->'days') x
      on conflict(request_id,leave_date) do update set amount=excluded.amount,status=excluded.status;
  end if;
  new.data:=new.data||jsonb_build_object('leavePolicyVersion','monthly-v1','leaveChargeDays',v_preview->'days',
    'leaveResponseDueDate',case when tg_op='UPDATE' and v_same then coalesce(old.data->>'leaveResponseDueDate',v_preview->>'response_due') else v_preview->>'response_due' end);
  if new.data->>'status'='approved' then
    new.data:=new.data||jsonb_build_object('attendanceSyncStatus','synced','attendanceSyncedAt',now());
  end if;
  return new;
end;
$$;
drop trigger if exists monthly_leave_request_guard on public.hr_records;
create trigger monthly_leave_request_guard before insert or update on public.hr_records for each row execute function public.enforce_monthly_leave_request();

create or replace function public.release_deleted_leave_reservation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.collection='approvalRequests' then
    perform 1 from public.users where id::text=old.data->>'requesterId' for update;
    update public.employee_leave_reservations set status='released' where request_id=old.id and status='pending';
    -- Approved consumption intentionally survives deletion of a finished proposal.
  end if;
  return old;
end;
$$;
drop trigger if exists monthly_leave_request_delete on public.hr_records;
create trigger monthly_leave_request_delete after delete on public.hr_records for each row execute function public.release_deleted_leave_reservation();

-- Preserve the existing source links and adjustment history, but sync working days only.
do $$ begin
  if to_regprocedure('public.sync_leave_request_days_calendar_legacy(text,jsonb)') is null then
    alter function public.sync_leave_request_days(text,jsonb) rename to sync_leave_request_days_calendar_legacy;
  end if;
end; $$;
create or replace function public.sync_leave_request_days(p_id text,p_data jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_day jsonb; v_days jsonb; v_employee text:=p_data->>'requesterId'; v_date date; v_month text; v_num text; v_existing text;
begin
  if p_data->>'status' is distinct from 'approved' then return; end if;
  if p_data->>'leavePolicyVersion' is distinct from 'monthly-v1' then
    perform public.sync_leave_request_days_calendar_legacy(p_id,p_data); return;
  end if;
  v_days:=p_data->'leaveChargeDays';
  for v_day in select value from jsonb_array_elements(v_days) loop
    v_date:=(v_day->>'date')::date; v_month:=to_char(v_date,'YYYY-MM'); v_num:=extract(day from v_date)::integer::text;
    perform public.sync_leave_request_days_calendar_legacy(p_id,p_data||jsonb_build_object('leaveStartDate',v_date,'leaveEndDate',v_date));
    if p_data->>'leaveType' in ('paid','personal_paid') then
      select data->>v_employee into v_existing from public.hr_records where id='attendanceAdjustments::'||v_month;
      if not (v_num=any(string_to_array(coalesce(v_existing,''),','))) then v_existing:=concat_ws(',',nullif(v_existing,''),v_num); end if;
      insert into public.hr_records(id,collection,data,updated_at)
        values('attendanceAdjustments::'||v_month,'attendanceAdjustments',jsonb_build_object(v_employee,v_existing),now())
        on conflict(id) do update set data=coalesce(hr_records.data,'{}')||excluded.data,updated_at=now();
      insert into public.hr_records(id,collection,data,updated_at)
        values('manualWorkdays::'||v_month||'__'||v_employee,'manualWorkdays',jsonb_build_object(v_num,(v_day->>'amount')::numeric),now())
        on conflict(id) do update set data=coalesce(hr_records.data,'{}')||excluded.data,updated_at=now();
    end if;
  end loop;
end;
$$;

-- New submissions use account-session identity too, and all leave checks live in the trigger.
create or replace function public.submit_employee_approval(p_data jsonb) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_me public.users%rowtype; v_leader jsonb; v_data jsonb; v_id text:='-'||replace(gen_random_uuid()::text,'-','');
begin
  select * into v_me from public.users where id=public.current_hr_profile_id() for update;
  if v_me.id is null then raise exception 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or nullif(btrim(p_data->>'subject'),'') is null or nullif(btrim(p_data->>'content'),'') is null then raise exception 'Vui lòng nhập tiêu đề và nội dung đề xuất.'; end if;
  v_leader:=public.my_team_leader();
  v_data:=(p_data-array['requesterId','requesterCode','requesterName','requesterAvatar','createdById','createdByCode','createdByName',
    'companyId','status','approvalSteps','currentStepIndex','createdAt','attendanceSyncStatus','attendanceSyncedAt','code','leaveChargeDays','leavePolicyVersion'])
    ||jsonb_build_object('requesterId',v_me.id,'requesterCode',coalesce(v_me.employee_id,v_me.username,''),'requesterName',v_me.name,'requesterAvatar',v_me.avatar_url,
      'createdById',v_me.id,'createdByCode',coalesce(v_me.employee_id,v_me.username,''),'createdByName',v_me.name,
      'companyId',coalesce(nullif(to_jsonb(v_me)->>'company_id',''),'speego-original'),'status','pending','currentStepIndex',0,'createdAt',now(),
      'code',(extract(epoch from clock_timestamp())*1000)::bigint::text,'approvalSteps',jsonb_build_array(jsonb_build_object('approverId',v_leader->>'id',
      'approverName',v_leader->>'name','approverAvatar',v_leader->>'avatar','decision',null,'comment','')));
  insert into public.hr_records(id,collection,data,updated_at) values('approvalRequests::'||v_id,'approvalRequests',v_data,now());
  return v_id;
end;
$$;

create or replace function public.decide_employee_approval(p_id text,p_decision text,p_comment text default '') returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_me public.users%rowtype; v_requester public.users%rowtype; v_request public.hr_records%rowtype;
  v_steps jsonb; v_step jsonb; v_index integer; v_status text; v_allowed boolean;
begin
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Quyết định không hợp lệ.'; end if;
  select * into v_me from public.users where id=public.current_hr_profile_id();
  if v_me.id is null then raise exception 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  select u.* into v_requester from public.users u join public.hr_records r on u.id::text=r.data->>'requesterId'
    where r.id='approvalRequests::'||p_id for update of u;
  select * into v_request from public.hr_records where id='approvalRequests::'||p_id and collection='approvalRequests' for update;
  if v_request.id is null then raise exception 'Không tìm thấy đơn đề xuất.'; end if;
  if coalesce(nullif(v_request.data->>'companyId',''),'speego-original')<>public.current_leave_company_id() then raise exception 'Đơn không thuộc công ty của bạn.'; end if;
  if v_request.data->>'status'<>'pending' then raise exception 'Đơn đã được xử lý.'; end if;
  v_index:=coalesce((v_request.data->>'currentStepIndex')::integer,0); v_steps:=v_request.data->'approvalSteps'; v_step:=v_steps->v_index;
  if v_step is null then raise exception 'Đơn chưa có người phê duyệt.'; end if;
  v_allowed:=coalesce(v_step->>'approverId'=v_me.id::text,false) or v_me.role in ('admin','hr')
    or ((coalesce(v_me.is_team_leader,false) or coalesce(v_me.position,'') ~* 'leader|trưởng')
      and nullif(btrim(v_me.department),'') is not null and lower(btrim(v_me.department))=lower(btrim(v_requester.department))
      and (nullif(btrim(v_me.branch),'') is null or nullif(btrim(v_requester.branch),'') is null or lower(btrim(v_me.branch))=lower(btrim(v_requester.branch))));
  if not coalesce(v_allowed,false) then raise exception 'Bạn không phải người được chỉ định duyệt đơn này.'; end if;
  if p_decision='rejected' and v_request.data ? 'leaveStartDate' and length(btrim(coalesce(p_comment,'')))<5 then raise exception 'Cần ghi lý do từ chối và thời điểm nghỉ đề xuất khác.'; end if;
  v_step:=v_step||jsonb_build_object('decision',p_decision,'decidedAt',now(),'comment',coalesce(p_comment,''),
    'decidedById',v_me.id,'decidedByName',v_me.name,'decidedByAvatar',v_me.avatar_url);
  v_steps:=jsonb_set(v_steps,array[v_index::text],v_step);
  v_status:=case when p_decision='rejected' then 'rejected' when v_index=jsonb_array_length(v_steps)-1 then 'approved' else 'pending' end;
  update public.hr_records set data=data||jsonb_build_object('approvalSteps',v_steps,'status',v_status,
    'currentStepIndex',case when v_status='pending' then v_index+1 else v_index end),updated_at=now()
    where id=v_request.id returning data into v_request.data;
  return v_request.data;
end;
$$;

-- Backfill usage once, independently of any legacy annual entitlement.
-- Bad historical rows are reported for reconciliation, rather than aborting all setup.
do $$ declare r record; begin
  for r in select id,data from public.hr_records where collection='approvalRequests'
    and data->>'status' in ('pending','approved') and coalesce(data->>'leaveType','paid')='paid'
    and (data->>'templateId'='leave' or data->>'templateBaseId'='leave' or data->>'attendanceSync'='paid-leave') loop
    begin
      insert into public.employee_leave_reservations(request_id,company_id,employee_id,leave_date,amount,status)
        select r.id,coalesce(nullif(r.data->>'companyId',''),'speego-original'),(r.data->>'requesterId')::uuid,
          day,amount,r.data->>'status' from public.monthly_leave_request_days(r.data,r.id) on conflict do nothing;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or foreign_key_violation or invalid_parameter_value then
      raise warning 'Không nhập được lịch sử phép của đơn %; cần đối soát.',r.id;
    end;
  end loop;
end; $$;

-- Public data is read-only; all changes go through checked RPCs or the scheduler.
do $$ declare t text; begin
  foreach t in array array['employee_leave_years','employee_leave_months','employee_leave_journal','employee_leave_reservations','employee_leave_continuation'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
  end loop;
end; $$;

-- Keep helpers private even when the project has permissive default privileges.
revoke all on function public.leave_is_scheduled_day(uuid,text,date),public.leave_is_workday(uuid,text,date), public.leave_eligible_from(uuid),public.leave_check_hr(uuid),
 public.leave_year_balance(uuid,text,integer),public.accrue_employee_leave(uuid,integer),public.run_monthly_leave_accrual() from public,anon,authenticated;
revoke all on function public.company_monthly_leave_board(integer),public.my_approval_leave_balance(integer),
 public.configure_monthly_leave_year(uuid,integer,numeric,integer,text),public.save_monthly_leave(uuid,integer,jsonb,bigint,text),
 public.adjust_monthly_leave_balance(uuid,integer,numeric,text,integer,text),public.recalculate_company_leave() from public;
grant execute on function public.company_monthly_leave_board(integer),public.my_approval_leave_balance(integer),
 public.configure_monthly_leave_year(uuid,integer,numeric,integer,text),public.save_monthly_leave(uuid,integer,jsonb,bigint,text),
 public.adjust_monthly_leave_balance(uuid,integer,numeric,text,integer,text),public.recalculate_company_leave() to anon,authenticated;
grant execute on function public.run_monthly_leave_accrual() to service_role;

revoke all on function public.monthly_leave_request_days(jsonb,text),public.monthly_leave_preview(jsonb,uuid),
 public.enforce_monthly_leave_request(),public.release_deleted_leave_reservation(),public.sync_leave_request_days(text,jsonb),
 public.sync_leave_request_days_calendar_legacy(text,jsonb) from public,anon,authenticated;
revoke all on function public.preview_monthly_leave_request(jsonb),public.submit_employee_approval(jsonb),public.decide_employee_approval(text,text,text) from public;
grant execute on function public.preview_monthly_leave_request(jsonb),public.submit_employee_approval(jsonb),public.decide_employee_approval(text,text,text) to anon,authenticated;
revoke all on function public.my_approval_leave_month_usage(integer,integer) from public;
grant execute on function public.my_approval_leave_month_usage(integer,integer) to anon,authenticated;
revoke all on function public.maybe_confirm_leave_continuation(uuid) from public,anon,authenticated;
revoke all on function public.confirm_leave_continuation(uuid,text,text) from public;
grant execute on function public.confirm_leave_continuation(uuid,text,text) to anon,authenticated;

commit;
