// Chỉ chạy trên PostgreSQL thử nghiệm cục bộ, không nhận URL môi trường thật.
// node scripts/test-attendance-points-db.mjs [port=55441]
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const port = process.argv[2] || '55441'
const binary = 'C:/Program Files/PostgreSQL/17/bin/psql.exe'
const database = `attendance_points_test_${Date.now()}`
const args = ['-X','-qAt','-h','127.0.0.1','-p',port,'-U','postgres','-v','ON_ERROR_STOP=1']
const command = (db, sql) => new Promise((resolve,reject) => {
  const child = execFile(binary,[...args,'-d',db,'-f','-'],{maxBuffer:1024*1024,env:{...process.env,PGCLIENTENCODING:'UTF8'}},(error,stdout,stderr) => {
    if (error) { error.stderr=stderr; reject(error) } else resolve({stdout,stderr})
  })
  child.stdin.end(sql,'utf8')
})
const ids = Object.fromEntries(['hr','employee','other','manager','admin'].map((role,i)=>[role,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]))
const quote = value => `'${String(value).replaceAll("'","''")}'`
const json = value => `${quote(JSON.stringify(value))}::jsonb`
const run = (sql, actor='hr') => command(database,`set test.employee=${quote(ids[actor])}; set role authenticated; ${sql}`)
const save = (rows, version, actor='hr', benefits={}) => run(`select public.save_attendance_points('2026-11',${json(rows)},${json(benefits)},${version});`,actor)
const read = async (actor='hr') => JSON.parse((await run("select public.load_attendance_point_month('2026-11');",actor)).stdout.trim())
const make = (id, employeeId=ids.employee, patch={}) => ({ id,date:'2026-11-02',employeeId,employeeName:'Test',employeeCode:'T',
  eventType:'late',categoryKey:'time_under_30',minutes:20,points:10,source:'manual',reviewStatus:'confirmed',note:'HCNS verified evidence',content:'Test',...patch })

await command('postgres',`create database ${database};`)
await command(database,`
  do $$ begin
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  end $$;
  create table public.users(id uuid primary key,role text not null);
  insert into public.users values ${Object.entries(ids).map(([role,id])=>`(${quote(id)},${quote(role==='employee'||role==='other'?'user':role)})`).join(',')};
  create function public.current_hr_profile_id() returns uuid language sql stable security definer set search_path=public
    as $$ select nullif(current_setting('test.employee',true),'')::uuid $$;
  create function public.current_hr_role() returns text language sql stable security definer set search_path=public
    as $$ select role from public.users where id=public.current_hr_profile_id() $$;
  grant usage on schema public to authenticated,anon;
  create table public.attendance_penalties(id text primary key,month text,amount numeric);
  insert into public.attendance_penalties values('legacy','2026-10',100000),('old-november','2026-11',200000);
`)
await command(database,await readFile(new URL('../supabase/migrations/20261118100000_attendance_points.sql',import.meta.url),'utf8'))
const oldAbsence={date:'2026-12-02',eventType:'absence',categoryKey:'unapproved_absence',points:40,minutes:0}
await run(`select public.save_attendance_points('2026-12',${json([
  make('old-pending',ids.employee,{date:'2026-12-02',reviewStatus:'pending',note:''}),
  make('old-absence-confirmed',ids.employee,oldAbsence),
  make('old-absence-pending-1',ids.employee,{...oldAbsence,reviewStatus:'pending',note:''}),
  make('old-absence-pending-2',ids.employee,{...oldAbsence,reviewStatus:'pending',note:''})
])},'{}',0);`)
await command(database,await readFile(new URL('../supabase/migrations/20261118110000_attendance_points_direct_deduction.sql',import.meta.url),'utf8'))
const migrated = JSON.parse((await run("select public.load_attendance_point_month('2026-12');")).stdout.trim())
assert.equal(migrated.rows.find(row=>row.id==='old-pending').review_status,'confirmed')
assert.equal(migrated.rows.find(row=>row.id==='old-pending').note,'')
assert.equal(migrated.rows.filter(row=>row.event_type==='absence'&&row.review_status==='confirmed').length,1)
assert.equal(migrated.rows.filter(row=>row.event_type==='absence'&&row.review_status==='exempt').length,2)
assert.equal(migrated.version,2)
console.log('PASS: existing pending deductions apply immediately; migration bumps month version')
const rows=[make('a'),make('b',ids.other),make('c',ids.employee,{reviewStatus:'pending',note:''})]
const saved=JSON.parse((await save(rows,0,'hr',{[ids.employee]:'employee'})).stdout.trim())
assert.equal(saved.version,1)
assert.equal(saved.rows.length,3)
assert.equal(saved.rows.find(row=>row.id==='a').reviewed_by,ids.hr)
assert.ok(saved.rows.find(row=>row.id==='a').reviewed_at)
assert.equal(saved.rows.find(row=>row.id==='c').review_status,'confirmed')
assert.equal(saved.rows.find(row=>row.id==='c').note,'')
console.log('PASS: atomic save deducts immediately without note or approval, including legacy pending input')

await assert.rejects(save(rows,0),error=>/40001|phiên khác/.test(error.stderr))
await assert.rejects(save([make('invalid',ids.employee,{points:50000})],1))
assert.equal((await read()).version,1)
assert.equal((await read()).rows.length,3)
console.log('PASS: stale versions and wrong points reject; failed replacement rolls back deletes and version')

await assert.rejects(save([make('wrong-date',ids.employee,{date:'2026-12-02'})],1))
await assert.rejects(save([make('empty-note',ids.employee,{note:'',reviewStatus:'exempt'})],1))
await assert.rejects(save([make('abs1',ids.employee,{eventType:'absence',categoryKey:'unapproved_absence',minutes:0,points:40}),
  make('abs2',ids.employee,{eventType:'absence',categoryKey:'unapproved_absence',minutes:0,points:40})],1))
await assert.rejects(save([1,2,3].map(i=>make(`miss${i}`,ids.employee,{date:`2026-11-0${i}`,eventType:'missing_punch',categoryKey:'missing_punch',minutes:0,points:10,reviewStatus:'exempt'})),1))
assert.equal((await read()).version,1)
console.log('PASS: month, reason for exemption, duplicate absence and max-two explanations enforced in DB')

const member=await read('employee')
assert.deepEqual(member.rows.map(row=>row.id),['a','c'])
assert.equal(member.version,0)
await assert.rejects(save(rows,1,'employee'))
await assert.rejects(save(rows,1,'manager'))
await assert.rejects(run('update public.attendance_point_events set points=0;'))
assert.equal((await command(database,'set role anon; select count(*) from public.attendance_point_events;')).stdout.trim(),'0')
await assert.rejects(command(database,"set role anon; select public.save_attendance_points('2026-11','[]','{}',1);"))
const legacyAccount = JSON.parse((await command(database,`set test.employee=${quote(ids.employee)}; set role anon; select public.load_attendance_point_month('2026-11');`)).stdout.trim())
assert.deepEqual(legacyAccount.rows.map(row=>row.id),['a','c'])
assert.equal((await read('manager')).rows.length,3)
console.log('PASS: both login modes see own immediate deductions; manager read-only; no direct writes or reads without profile')

const concurrent=await Promise.allSettled([save(rows,1),save(rows,1)])
assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1)
assert.equal(concurrent.filter(result=>result.status==='rejected').length,1)
assert.equal((await read()).version,2)
assert.equal((await read()).rows.length,3)
const legacy=(await command(database,"select string_agg(month||':'||amount,',' order by month) from public.attendance_penalties;")).stdout.trim()
assert.equal(legacy,'2026-10:100000,2026-11:200000')
assert.ok(Number((await command(database,'select count(*) from public.attendance_point_journal;')).stdout.trim())>=4)
console.log('PASS: simultaneous saves cannot overwrite; legacy money unchanged; audit journal populated')
const adjusted=rows.map(row=>row.id==='a'?{...row,points:5,pointsOverridden:true,note:''}:row)
await assert.rejects(save(adjusted,2,'hr'),error=>/Chỉ admin/.test(error.stderr))
await save(adjusted,2,'admin')
assert.equal((await read('employee')).rows.find(row=>row.id==='a').points,5)
assert.equal((await read()).rows.find(row=>row.id==='a').points_overridden,true)
await save(adjusted,3,'hr')
assert.equal((await read()).rows.find(row=>row.id==='a').points,5)
await assert.rejects(save(adjusted.map(row=>row.id==='a'?{...row,points:0}:row),4,'hr'),error=>/Chỉ admin/.test(error.stderr))
await assert.rejects(save(rows,4,'hr'),error=>/Chỉ admin/.test(error.stderr))
await assert.rejects(save([make('forged',ids.employee,{points:5,pointsOverridden:true})],4,'hr'),error=>/Chỉ admin/.test(error.stderr))
for (const points of [-1,101,1.5]) await assert.rejects(save([make('bad',ids.employee,{points,pointsOverridden:true})],4,'admin'))
assert.equal((await read()).version,4)
const zero=adjusted.map(row=>row.id==='a'?{...row,points:0}:row)
await save(zero,4,'admin')
assert.equal((await read('employee')).rows.find(row=>row.id==='a').points,0)
await save(rows,5,'admin')
assert.equal((await read()).rows.find(row=>row.id==='a').points_overridden,false)
assert.equal((await read()).rows.find(row=>row.id==='a').points,10)
assert.ok(Number((await command(database,`select count(*) from public.attendance_point_journal where actor_id=${quote(ids.admin)} and after_data->>'points_overridden'='true';`)).stdout.trim())>=1)
console.log('PASS: only admin can override/reset points; HR can retain adjustments; employee sees changes; audit records admin')
console.log(`All 8 database scenarios passed in disposable ${database} on 127.0.0.1:${port}.`)
