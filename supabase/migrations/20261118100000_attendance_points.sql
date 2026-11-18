-- Nội quy v0.4: áp dụng điểm từ 11/2026. Không sửa attendance_penalties cũ.
begin;

create table public.attendance_point_months (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$' and month >= '2026-11'),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);
create table public.attendance_point_events (
  id text primary key,
  month text not null references public.attendance_point_months(month),
  penalty_date date not null,
  employee_id uuid not null references public.users(id),
  employee_code text not null default '',
  employee_name text not null default '',
  event_type text not null,
  category_key text not null,
  minutes integer not null default 0 check (minutes between 0 and 1440),
  points integer not null,
  content text not null default '',
  note text not null default '',
  source text not null check (source in ('auto','manual')),
  review_status text not null default 'pending' check (review_status in ('pending','confirmed','exempt')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (to_char(penalty_date,'YYYY-MM') = month),
  check (review_status = 'pending' or (btrim(note) <> '' and reviewed_by is not null and reviewed_at is not null)),
  check (
    (event_type in ('late','early','outside') and minutes > 0 and (
      (minutes < 30 and category_key='time_under_30' and points=10) or
      (minutes between 30 and 60 and category_key='time_30_60' and points=20) or
      (minutes > 60 and category_key='time_over_60' and points=30)
    )) or
    (event_type='missing_punch' and category_key='missing_punch' and points=10 and minutes=0) or
    (event_type='absence' and category_key='unapproved_absence' and points=40 and minutes=0) or
    (event_type='conduct' and category_key='conduct' and points=10 and minutes=0) or
    (event_type='emergency_leave' and category_key='frequency_only' and points=0 and minutes=0)
  )
);
create index attendance_point_events_month_idx on public.attendance_point_events(month,penalty_date);
create index attendance_point_events_employee_idx on public.attendance_point_events(employee_id,month);
create unique index attendance_point_absence_once on public.attendance_point_events(employee_id,penalty_date)
  where event_type='absence' and review_status='confirmed';

create table public.attendance_point_benefits (
  month text not null references public.attendance_point_months(month),
  employee_id uuid not null references public.users(id),
  benefit_group text not null check (benefit_group in ('unassigned','employee','manager','ineligible')),
  primary key(month,employee_id)
);
create table public.attendance_point_journal (
  id bigint generated always as identity primary key,
  month text not null,
  record_table text not null,
  operation text not null,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create function public.audit_attendance_points() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
  insert into public.attendance_point_journal(month,record_table,operation,before_data,after_data,actor_id)
  values(coalesce(new.month,old.month),tg_table_name,tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,public.current_hr_profile_id());
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger audit_attendance_point_events after insert or update or delete on public.attendance_point_events
  for each row execute function public.audit_attendance_points();
create trigger audit_attendance_point_benefits after insert or update or delete on public.attendance_point_benefits
  for each row execute function public.audit_attendance_points();

alter table public.attendance_point_months enable row level security;
alter table public.attendance_point_events enable row level security;
alter table public.attendance_point_benefits enable row level security;
alter table public.attendance_point_journal enable row level security;
revoke all on public.attendance_point_months,public.attendance_point_events,public.attendance_point_benefits,public.attendance_point_journal from anon,authenticated;
-- App hỗ trợ Supabase Auth và đăng nhập tài khoản qua current_hr_profile_id().
-- Role anon không có hồ sơ hợp lệ vẫn không được thấy dòng nào hoặc gọi ghi.
grant select on public.attendance_point_months,public.attendance_point_events,public.attendance_point_benefits,public.attendance_point_journal to anon,authenticated;
create policy points_months_staff on public.attendance_point_months for select to anon,authenticated
  using (public.current_hr_role() in ('admin','hr','manager'));
create policy points_events_read on public.attendance_point_events for select to anon,authenticated
  using (public.current_hr_role() in ('admin','hr','manager') or
    (employee_id=public.current_hr_profile_id() and review_status in ('confirmed','exempt')));
create policy points_benefits_read on public.attendance_point_benefits for select to anon,authenticated
  using (public.current_hr_role() in ('admin','hr','manager') or employee_id=public.current_hr_profile_id());
create policy points_journal_staff on public.attendance_point_journal for select to anon,authenticated
  using (public.current_hr_role() in ('admin','hr'));

-- Một giao dịch, có khóa theo tháng và kiểm tra phiên để tránh ghi đè dữ liệu người khác.
create function public.save_attendance_points(p_month text,p_rows jsonb,p_benefits jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_version integer;
  v_actor uuid := public.current_hr_profile_id();
begin
  if coalesce(public.current_hr_role(),'') not in ('admin','hr') or v_actor is null then
    raise exception 'Chỉ HCNS/admin được xác nhận điểm chuyên cần.' using errcode='42501';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_month < '2026-11' then
    raise exception 'Quy chế điểm áp dụng từ tháng 11/2026.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_benefits) is distinct from 'object' then
    raise exception 'Dữ liệu điểm không hợp lệ.';
  end if;
  if jsonb_array_length(p_rows)>10000 then raise exception 'Quá nhiều sự kiện trong một lần lưu.'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'id' having count(*)>1) then
    raise exception 'Trùng mã sự kiện.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    where r->>'eventType'='missing_punch' and r->>'reviewStatus'='exempt'
    group by r->>'employeeId' having count(*)>2) then
    raise exception 'Tối đa 2 lần giải trình quên chấm mỗi người/tháng theo Điều 7.2.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where (r->>'date')::date is null
    or to_char((r->>'date')::date,'YYYY-MM')<>p_month) then raise exception 'Ngày sự kiện không thuộc tháng đang xét.'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r join public.attendance_point_events e on e.id=r->>'id'
    where e.month<>p_month) then raise exception 'Mã sự kiện thuộc tháng khác.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-points:'||p_month,0));
  insert into public.attendance_point_months(month) values(p_month) on conflict do nothing;
  select version into v_version from public.attendance_point_months where month=p_month for update;
  if p_expected_version is distinct from v_version then
    raise exception 'Bảng điểm đã được thay đổi ở phiên khác. Hãy tải lại trước khi lưu.' using errcode='40001';
  end if;

  delete from public.attendance_point_events e where e.month=p_month and not exists
    (select 1 from jsonb_array_elements(p_rows) r where r->>'id'=e.id);
  -- Reset các dòng đã thay đổi trước upsert để ràng buộc nghỉ không phép không
  -- phụ thuộc thứ tự xử lý (ví dụ thay một dòng xác nhận bằng dòng khác).
  update public.attendance_point_events e set review_status='pending',reviewed_by=null,reviewed_at=null
    from jsonb_array_elements(p_rows) r where e.month=p_month and e.id=r->>'id' and
      (e.review_status is distinct from r->>'reviewStatus' or e.event_type is distinct from r->>'eventType'
       or e.penalty_date is distinct from (r->>'date')::date or e.employee_id is distinct from (r->>'employeeId')::uuid);
  insert into public.attendance_point_events(id,month,penalty_date,employee_id,employee_code,employee_name,
    event_type,category_key,minutes,points,content,note,source,review_status,reviewed_by,reviewed_at)
  select r->>'id',p_month,(r->>'date')::date,(r->>'employeeId')::uuid,coalesce(r->>'employeeCode',''),coalesce(r->>'employeeName',''),
    r->>'eventType',r->>'categoryKey',(r->>'minutes')::integer,(r->>'points')::integer,
    coalesce(r->>'content',''),coalesce(r->>'note',''),r->>'source',r->>'reviewStatus',
    case when r->>'reviewStatus'<>'pending' then v_actor end,
    case when r->>'reviewStatus'<>'pending' then clock_timestamp() end
  from jsonb_array_elements(p_rows) r
  on conflict(id) do update set
    penalty_date=excluded.penalty_date,employee_id=excluded.employee_id,employee_code=excluded.employee_code,
    employee_name=excluded.employee_name,event_type=excluded.event_type,category_key=excluded.category_key,
    minutes=excluded.minutes,points=excluded.points,content=excluded.content,note=excluded.note,source=excluded.source,
    review_status=excluded.review_status,
    reviewed_by=case when attendance_point_events.review_status=excluded.review_status
      and attendance_point_events.note=excluded.note and attendance_point_events.points=excluded.points
      and attendance_point_events.minutes=excluded.minutes then attendance_point_events.reviewed_by else excluded.reviewed_by end,
    reviewed_at=case when attendance_point_events.review_status=excluded.review_status
      and attendance_point_events.note=excluded.note and attendance_point_events.points=excluded.points
      and attendance_point_events.minutes=excluded.minutes then attendance_point_events.reviewed_at else excluded.reviewed_at end,
    updated_at=clock_timestamp();

  delete from public.attendance_point_benefits b where b.month=p_month and not (p_benefits ? b.employee_id::text);
  insert into public.attendance_point_benefits(month,employee_id,benefit_group)
    select p_month,key::uuid,value from jsonb_each_text(p_benefits)
    on conflict(month,employee_id) do update set benefit_group=excluded.benefit_group;
  update public.attendance_point_months set version=version+1,updated_at=clock_timestamp() where month=p_month;
  return jsonb_build_object('version',v_version+1,'generatedAt',clock_timestamp(),'benefits',p_benefits,
    'rows',coalesce((select jsonb_agg(e order by penalty_date,id) from public.attendance_point_events e where month=p_month),'[]'::jsonb));
end $$;
revoke all on function public.save_attendance_points(text,jsonb,jsonb,integer) from public,anon;
grant execute on function public.save_attendance_points(text,jsonb,jsonb,integer) to anon,authenticated;
revoke all on function public.audit_attendance_points() from public,anon,authenticated;

-- Một snapshot cho cả phiên, sự kiện và nhóm hưởng; tránh ghép dữ liệu của hai phiên.
create function public.load_attendance_point_month(p_month text) returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'version',coalesce((select version from public.attendance_point_months where month=p_month),0),
    'generatedAt',(select updated_at from public.attendance_point_months where month=p_month),
    'rows',coalesce((select jsonb_agg(e order by penalty_date,id) from public.attendance_point_events e where month=p_month),'[]'::jsonb),
    'benefits',coalesce((select jsonb_object_agg(employee_id::text,benefit_group) from public.attendance_point_benefits where month=p_month),'{}'::jsonb)
  );
$$;
revoke all on function public.load_attendance_point_month(text) from public,anon;
grant execute on function public.load_attendance_point_month(text) to anon,authenticated;

commit;
