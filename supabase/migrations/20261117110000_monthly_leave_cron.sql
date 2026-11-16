-- Run inside Supabase instead of calling the database through Vercel.
begin;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Fail during setup if the monthly leave migration has not been applied.
select 'public.run_monthly_leave_accrual()'::regprocedure;

-- pg_cron uses GMT by default: 17:05 UTC = 00:05 the next day in Vietnam.
-- Scheduling the same name again updates the existing job.
select cron.schedule(
  'monthly-leave-accrual',
  '5 17 * * *',
  'select public.run_monthly_leave_accrual();'
);

commit;
