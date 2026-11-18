-- Trừ điểm ngay, không cần duyệt; chỉ admin được sửa mức điểm theo nội quy.
begin;

alter table public.attendance_point_events
  add column points_overridden boolean not null default false,
  alter column review_status set default 'confirmed';

-- Thay các check cũ về xác nhận và mức điểm, giữ check ngày/tháng, nguồn và phút.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
    where conrelid='public.attendance_point_events'::regclass and contype='c'
      and (pg_get_constraintdef(oid) like '%reviewed_by%'
        or pg_get_constraintdef(oid) like '%category_key%')
  loop
    execute format('alter table public.attendance_point_events drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.attendance_point_events
  add constraint attendance_points_exemption_note check (review_status <> 'exempt' or btrim(note) <> ''),
  add constraint attendance_points_range check (points between 0 and 100),
  add constraint attendance_points_rule check (
    (event_type in ('late','early','outside') and minutes > 0 and (
      (minutes < 30 and category_key='time_under_30' and (points_overridden or points=10)) or
      (minutes between 30 and 60 and category_key='time_30_60' and (points_overridden or points=20)) or
      (minutes > 60 and category_key='time_over_60' and (points_overridden or points=30))
    )) or
    (event_type='missing_punch' and category_key='missing_punch' and (points_overridden or points=10) and minutes=0) or
    (event_type='absence' and category_key='unapproved_absence' and (points_overridden or points=40) and minutes=0) or
    (event_type='conduct' and category_key='conduct' and (points_overridden or points=10) and minutes=0) or
    (event_type='emergency_leave' and category_key='frequency_only' and (points_overridden or points=0) and minutes=0)
  );

-- Chuyển sự kiện đang chờ sang áp dụng ngay, ghi nhật ký và tăng phiên của tháng.
with absences as (
  select id,row_number() over (
    partition by employee_id,penalty_date order by (review_status='confirmed') desc,id
  ) as occurrence
  from public.attendance_point_events where event_type='absence' and review_status<>'exempt'
), changed as (
  -- Dữ liệu cũ có thể có nhiều dòng chờ cho cùng ngày nghỉ; chỉ trừ một lần.
  update public.attendance_point_events set
    review_status=case when id in (select id from absences where occurrence>1) then 'exempt' else 'confirmed' end,
    note=case when id in (select id from absences where occurrence>1)
      then concat_ws(' · ',nullif(note,''),'Trùng ngày nghỉ không phép; đã tính điểm ở sự kiện khác.') else note end,
    updated_at=clock_timestamp()
    where review_status='pending' or id in (select id from absences where occurrence>1)
    returning month
)
update public.attendance_point_months set version=version+1,updated_at=clock_timestamp()
where month in (select month from changed);

create function public.guard_attendance_point_override() returns trigger
language plpgsql set search_path=public as $$
begin
  if coalesce(public.current_hr_role(),'') <> 'admin' then
    if tg_op='INSERT' then
      -- BEFORE INSERT cũng chạy trước ON CONFLICT: cho giữ điều chỉnh admin đã lưu.
      if new.points_overridden and not exists (
        select 1 from public.attendance_point_events e where e.id=new.id
          and e.points_overridden and e.points=new.points and e.employee_id=new.employee_id
          and e.penalty_date=new.penalty_date and e.event_type=new.event_type
      ) then
        raise exception 'Chỉ admin được chỉnh mức điểm trừ.' using errcode='42501';
      end if;
    elsif new.points_overridden is distinct from old.points_overridden
      or (new.points_overridden and (
        new.points is distinct from old.points or new.employee_id is distinct from old.employee_id
        or new.penalty_date is distinct from old.penalty_date or new.event_type is distinct from old.event_type
      )) then
      raise exception 'Chỉ admin được chỉnh mức điểm trừ.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_attendance_point_override before insert or update on public.attendance_point_events
  for each row execute function public.guard_attendance_point_override();
revoke all on function public.guard_attendance_point_override() from public,anon,authenticated;

create or replace function public.save_attendance_points(p_month text,p_rows jsonb,p_benefits jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_version integer;
  v_actor uuid := public.current_hr_profile_id();
begin
  if coalesce(public.current_hr_role(),'') not in ('admin','hr') or v_actor is null then
    raise exception 'Chỉ HCNS/admin được lưu điểm chuyên cần.' using errcode='42501';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_month < '2026-11' then
    raise exception 'Quy chế điểm áp dụng từ tháng 11/2026.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_benefits) is distinct from 'object' then
    raise exception 'Dữ liệu điểm không hợp lệ.';
  end if;
  if jsonb_array_length(p_rows)>10000 then raise exception 'Quá nhiều sự kiện trong một lần lưu.'; end if;
  -- Client cũ gửi pending cũng áp dụng ngay; không cần người xác nhận hay ghi chú.
  select coalesce(jsonb_agg(jsonb_set(r,'{reviewStatus}',to_jsonb(
    case when coalesce(r->>'reviewStatus','pending')='pending' then 'confirmed' else r->>'reviewStatus' end
  ))),'[]'::jsonb) into p_rows from jsonb_array_elements(p_rows) r;
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
    event_type,category_key,minutes,points,content,note,source,review_status,reviewed_by,reviewed_at,points_overridden)
  select r->>'id',p_month,(r->>'date')::date,(r->>'employeeId')::uuid,coalesce(r->>'employeeCode',''),coalesce(r->>'employeeName',''),
    r->>'eventType',r->>'categoryKey',(r->>'minutes')::integer,(r->>'points')::integer,
    coalesce(r->>'content',''),coalesce(r->>'note',''),r->>'source',r->>'reviewStatus',
    case when r->>'reviewStatus'<>'pending' then v_actor end,
    case when r->>'reviewStatus'<>'pending' then clock_timestamp() end,
    coalesce((r->>'pointsOverridden')::boolean,false)
  from jsonb_array_elements(p_rows) r
  on conflict(id) do update set
    penalty_date=excluded.penalty_date,employee_id=excluded.employee_id,employee_code=excluded.employee_code,
    employee_name=excluded.employee_name,event_type=excluded.event_type,category_key=excluded.category_key,
    minutes=excluded.minutes,points=excluded.points,content=excluded.content,note=excluded.note,source=excluded.source,points_overridden=excluded.points_overridden,
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

commit;
