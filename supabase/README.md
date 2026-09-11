# SQL Supabase — copy sang DB mới (FULL)

## File cần copy

| File | Mô tả |
|------|--------|
| [`full_setup.sql`](./full_setup.sql) | **Copy file này** — đầy đủ users + toàn bộ module HR |
| [`schema.sql`](./schema.sql) | Bản sao giống `full_setup.sql` |

## Cách chạy

1. Supabase → **SQL Editor** → New query  
2. Mở `full_setup.sql` → Ctrl+A → Ctrl+C → dán → **Run**  
3. Điền `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

## Có những gì?

### Bảng cấu trúc
| Bảng | Mục đích |
|------|----------|
| `users` | Nhân sự, login, password, role |
| `employee_status_history` | Lịch sử đổi trạng thái |
| `performance_reviews` | Đánh giá / grading |
| **`hr_records`** | **Toàn bộ module còn lại** (thay Firebase) |

### Trong `hr_records` (cột `collection`)
- **Lương / phúc lợi:** `salaryGrades`, `employeeSalaries`, `promotionHistory`, `payrolls`
- **Bảo hiểm / thuế:** `insuranceInfo`, `taxInfo`, `dependents`
- **Chấm công:** `attendanceLogs`, `attendanceAdjustments`, `manualWorkdays`, `attendanceMonthSummaries` (snapshot bảng công theo tháng)
- **Bảng phạt:** bảng Postgres riêng `attendance_penalties` (nhập tay theo ngày/nhân sự) — migration `20260911180000_attendance_penalties_table.sql`
- **KPI:** `kpiTemplates`, `employeeKPIs`, `kpiConversions`, `kpiResults`
- **Giao việc:** `tasks`, `taskLogs`
- **Tuyển dụng:** `recruitmentPlans`, `candidates`, `candidateStatusLogs`
- **Năng lực / đào tạo:** `competencyFramework`, `employee_competency_assessment`, `trainings`, `trainingParticipants`, `trainingResults`
- **Phê duyệt:** `approvalRequests`

App vẫn gọi `fbGet` / `fbPush`… nhưng **đã trỏ sang Supabase** (`src/services/firebase.js`).

## Tài khoản mặc định
- Email: `admin@company.local`
- Password: `123456`
- Role: `admin`

## Kiểm tra

```sql
select id, email, name, role from public.users;
select public.check_credentials('admin@company.local', '123456');
select collection, count(*) from public.hr_records group by 1 order by 1;
```

## Lưu ý
- **Không cần Firebase** cho HR nữa (sau khi chạy SQL + cấu hình `.env` Supabase).
- Có thể chạy lại file SQL nhiều lần (idempotent).
- Dữ liệu cũ trên Firebase **không tự chuyển** — chỉ DB mới trống; nhập lại hoặc import sau.
