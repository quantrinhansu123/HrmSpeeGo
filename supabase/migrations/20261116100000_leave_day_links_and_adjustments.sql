-- Link approved proposals to leave days and keep every HR adjustment with evidence.
begin;

alter table public.employee_leave_days
  add column if not exists approval_request_id text,
  add column if not exists approval_snapshot jsonb,
  add column if not exists original_leave_date date,
  add column if not exists adjustment_history jsonb not null default '[]'::jsonb,
  add column if not exists adjustment_count integer generated always as (jsonb_array_length(adjustment_history)) stored,
  add column if not exists updated_at timestamptz not null default clock_timestamp();

create index if not exists employee_leave_days_approval_idx
  on public.employee_leave_days (approval_request_id, original_leave_date);

create or replace function public.protect_employee_leave_day_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.leave_day_approval_sync', true), '') <> '1' then
    new.approval_request_id := null;
    new.approval_snapshot := null;
    new.original_leave_date := null;
    new.adjustment_history := '[]'::jsonb;
    new.status := 'pending';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.protect_employee_leave_day_insert() from public;
drop trigger if exists employee_leave_days_protect_insert on public.employee_leave_days;
create trigger employee_leave_days_protect_insert before insert on public.employee_leave_days
  for each row execute function public.protect_employee_leave_day_insert();

create or replace function public.protect_employee_leave_day_update()
returns trigger language plpgsql set search_path = public as $$
declare v_reason text := new.reason;
begin
  if coalesce(current_setting('app.leave_day_adjustment', true), '') = '1' then
    new.id := old.id;
    new.company_id := old.company_id;
    new.employee_id := old.employee_id;
    new.employee_name := old.employee_name;
    new.created_at := old.created_at;
    new.approval_request_id := old.approval_request_id;
    new.approval_snapshot := old.approval_snapshot;
    new.original_leave_date := old.original_leave_date;
    new.status := old.status;
  elsif coalesce(current_setting('app.leave_day_approval_sync', true), '') = '1' then
    new.id := old.id;
    new.company_id := old.company_id;
    new.employee_id := old.employee_id;
    new.employee_name := old.employee_name;
    new.leave_date := old.leave_date;
    new.created_at := old.created_at;
    new.adjustment_history := old.adjustment_history;
  else
    if old.status is distinct from 'pending' or new.status is distinct from 'approved' then
      raise exception 'Chỉ được duyệt ngày nghỉ đang chờ' using errcode = '42501';
    end if;
    new := old;
    new.status := 'approved';
    if v_reason = 'Nghỉ có phép' then new.reason := v_reason; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- Private helper shared by the trigger and the historical backfill.
create or replace function public.sync_leave_request_days(p_id text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_employee public.users%rowtype;
  v_company text;
  v_date date;
  v_end date;
  v_snapshot jsonb;
  v_previous_setting text := coalesce(current_setting('app.leave_day_approval_sync', true), '');
begin
  if p_data->>'status' is distinct from 'approved' then return; end if;
  if not (coalesce(p_data->>'templateId', '') = 'leave'
    or coalesce(p_data->>'templateBaseId', '') = 'leave'
    or coalesce(p_data->>'attendanceSync', '') = 'paid-leave') then return; end if;
  if coalesce(p_data->>'requesterId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return; end if;
  select * into v_employee from public.users where id = (p_data->>'requesterId')::uuid;
  if v_employee.id is null or nullif(btrim(v_employee.name), '') is null then return; end if;
  v_company := coalesce(nullif(to_jsonb(v_employee)->>'company_id', ''), 'speego-original');
  if coalesce(nullif(p_data->>'companyId', ''), 'speego-original') <> v_company then return; end if;
  begin
    v_date := nullif(coalesce(p_data->>'leaveStartDate', p_data->>'leaveDate'), '')::date;
    v_end := coalesce(nullif(p_data->>'leaveEndDate', '')::date, v_date);
  exception when invalid_datetime_format or datetime_field_overflow then return;
  end;
  if v_date is null or v_end < v_date or v_end - v_date >= 366 then return; end if;
  v_snapshot := jsonb_build_object('id', replace(p_id, 'approvalRequests::', ''),
    'code', p_data->>'code', 'subject', p_data->>'subject');
  perform set_config('app.leave_day_approval_sync', '1', true);
  while v_date <= v_end loop
    -- A moved day still represents its original proposal date. Do not recreate it.
    if not exists (select 1 from public.employee_leave_days
      where approval_request_id = p_id and original_leave_date = v_date) then
      insert into public.employee_leave_days (company_id, employee_id, employee_name,
        leave_date, reason, status, approval_request_id, approval_snapshot, original_leave_date)
      values (v_company, v_employee.id, btrim(v_employee.name), v_date, 'Nghỉ có phép',
        'approved', p_id, v_snapshot, v_date)
      on conflict (company_id, employee_id, leave_date) do update
        set status = 'approved',
          reason = case when employee_leave_days.adjustment_count = 0 then 'Nghỉ có phép' else employee_leave_days.reason end,
          approval_request_id = p_id,
          approval_snapshot = v_snapshot,
          original_leave_date = coalesce(employee_leave_days.original_leave_date, employee_leave_days.leave_date)
        where employee_leave_days.approval_request_id is null;
    end if;
    v_date := v_date + 1;
  end loop;
  perform set_config('app.leave_day_approval_sync', v_previous_setting, true);
end;
$$;
revoke all on function public.sync_leave_request_days(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_approved_leave_request_days()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.collection = 'approvalRequests' and new.data->>'status' = 'approved' then
    if tg_op = 'INSERT' then
      perform public.sync_leave_request_days(new.id, new.data);
    elsif old.data->>'status' is distinct from 'approved' then
      perform public.sync_leave_request_days(new.id, new.data);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists hr_records_sync_leave_days on public.hr_records;
create trigger hr_records_sync_leave_days after insert or update on public.hr_records
  for each row execute function public.sync_approved_leave_request_days();

-- Include proposals approved before this feature was installed; safe to run again.
do $$
declare v_record record;
begin
  for v_record in select id, data from public.hr_records
    where collection = 'approvalRequests' and data->>'status' = 'approved'
    order by data->>'createdAt', id
  loop
    perform public.sync_leave_request_days(v_record.id, v_record.data);
  end loop;
end;
$$;

create or replace function public.adjust_employee_leave_day(
  p_id uuid, p_leave_date date, p_reason text, p_note text, p_attachments jsonb,
  p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor public.users%rowtype;
  v_day public.employee_leave_days%rowtype;
  v_attachment jsonb;
  v_entry jsonb;
  v_total bigint := 0;
  v_previous_setting text := coalesce(current_setting('app.leave_day_adjustment', true), '');
begin
  v_actor := public.online_attendance_profile(null);
  if coalesce(v_actor.role, '') not in ('admin', 'hr') then
    raise exception 'Chỉ HR hoặc quản trị viên được điều chỉnh ngày nghỉ.' using errcode = '42501';
  end if;
  select * into v_day from public.employee_leave_days where id = p_id for update;
  if v_day.id is null or v_day.company_id <> coalesce(nullif(to_jsonb(v_actor)->>'company_id', ''), 'speego-original') then
    raise exception 'Không tìm thấy ngày nghỉ trong công ty của bạn.' using errcode = '42501';
  end if;
  if p_expected_updated_at is distinct from v_day.updated_at then
    raise exception 'Ngày nghỉ vừa được cập nhật. Hãy tải lại trước khi điều chỉnh.';
  end if;
  if p_leave_date is null or p_reason is null or p_reason not in ('Nghỉ cố định', 'Nghỉ có phép') then
    raise exception 'Ngày nghỉ hoặc lý do không hợp lệ.';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 or length(btrim(p_note)) > 2000 then
    raise exception 'Ghi chú điều chỉnh cần từ 5 đến 2.000 ký tự.';
  end if;
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Danh sách tệp không hợp lệ.';
  end if;
  if jsonb_array_length(p_attachments) > 5 then raise exception 'Tối đa 5 tệp đính kèm.'; end if;
  for v_attachment in select value from jsonb_array_elements(p_attachments) loop
    if jsonb_typeof(v_attachment) <> 'object'
      or nullif(btrim(v_attachment->>'name'), '') is null
      or coalesce(v_attachment->>'data', '') !~ '^data:[^,]*;base64,[A-Za-z0-9+/=]*$'
      or length(v_attachment->>'data') > 2796600 then
      raise exception 'Tệp đính kèm không hợp lệ hoặc vượt quá 2 MB.';
    end if;
    v_total := v_total + octet_length(decode(split_part(v_attachment->>'data', ',', 2), 'base64'));
    if octet_length(decode(split_part(v_attachment->>'data', ',', 2), 'base64')) > 2097152 then
      raise exception 'Mỗi tệp đính kèm tối đa 2 MB.';
    end if;
  end loop;
  if v_total > 5242880 then raise exception 'Tổng dung lượng tệp đính kèm tối đa 5 MB.'; end if;
  v_entry := jsonb_build_object('id', gen_random_uuid(), 'actorId', v_actor.id,
    'actorName', v_actor.name, 'createdAt', clock_timestamp(), 'note', btrim(p_note),
    'previousDate', v_day.leave_date, 'leaveDate', p_leave_date,
    'previousReason', v_day.reason, 'reason', p_reason, 'attachments', p_attachments);
  perform set_config('app.leave_day_adjustment', '1', true);
  update public.employee_leave_days set leave_date = p_leave_date, reason = p_reason,
    adjustment_history = adjustment_history || jsonb_build_array(v_entry)
    where id = p_id returning * into v_day;
  perform set_config('app.leave_day_adjustment', v_previous_setting, true);
  return to_jsonb(v_day);
end;
$$;
revoke all on function public.adjust_employee_leave_day(uuid, date, text, text, jsonb, timestamptz) from public;
grant execute on function public.adjust_employee_leave_day(uuid, date, text, text, jsonb, timestamptz) to anon, authenticated;

commit;
