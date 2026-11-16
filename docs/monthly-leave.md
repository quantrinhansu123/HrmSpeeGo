# Phép theo tháng

Nhánh triển khai: `feat/monthly-leave-accrual`. Nguồn nghiệp vụ: Điều 5–6 nội quy v0.4 và xác nhận của người dùng về mốc sáu tháng tròn, dừng/tiếp tục hợp đồng tại mốc này.

## Quy tắc đã triển khai

- Mốc xét: ngày chính thức + **6 tháng lịch tròn**, kẹp ngày cuối tháng giống PostgreSQL. Ví dụ 16/05 → 16/11; 31/08/2026 → 28/02/2027. Không lấy ngày vào làm thay cho ngày chính thức.
- Trước khi xác nhận tiếp tục sau mốc sáu tháng, các tháng đủ điều kiện chỉ tạo **phép dự tính**, chưa cấp, chưa được xin nghỉ hoặc thanh toán.
- Dừng hợp đồng tại mốc sáu tháng: **không cấp ngày phép nào**, bỏ quyền lợi dự tính. Khi tiếp tục làm: chuyển các tháng đủ điều kiện trước đó, gồm thử việc, thành phép đã cấp một lần; không cấp thêm lần hai khi xác nhận lại.
- Hệ thống tự xác nhận tiếp tục nếu bảng công có ngày **làm việc thực tế** từ mốc sáu tháng, không dùng riêng ngày phép hưởng lương làm bằng chứng. HR/admin có thể xác nhận theo hợp đồng, bắt buộc ghi căn cứ. Chỉ hồ sơ đang chính thức mới xác nhận tiếp tục được.
- Nếu nhân viên đã tiếp tục và được cấp phép, nghỉ việc về sau không xóa số phép đã cấp. Số chưa nghỉ được giữ để đối soát/thanh toán; điều này khác với dừng ở mốc sáu tháng khi quyền lợi còn có điều kiện.
- Mỗi tháng kết thúc được tính khi ngày công thường và nghỉ hưởng lương đạt ít nhất 50% ngày làm việc bình thường trong tháng. Ngày lễ hưởng lương được tính vào ngưỡng, nhưng không bị trừ phép khi xin nghỉ.
- Định mức cơ bản 12 ngày/năm; đủ mỗi 5 năm tại công ty thêm 1 ngày. Phần tự tính lưu theo đơn vị 1/12 ngày, làm tròn lên tổng lũy kế một lần. Khoản HR nhập không bị làm tròn; hỗ trợ 0,5 và 1,5.
- Bảng công thiếu nhân viên/ngày vào làm, hoặc được tạo trước khi hết tháng: chờ đối soát, không kết luận quyền lợi bằng 0. Bảng công cập nhật muộn được tác vụ lần sau tính lại; giữ nguyên số HR đã nhập thay thế.
- Lịch mặc định thứ Hai–thứ Bảy; loại ngày lễ đã cấu hình. Ca đăng ký đã duyệt vào Chủ nhật được tính là ngày làm việc. Có hỗ trợ `weeklyOffDays` trong cấu hình chấm công (0 = Chủ nhật); không suy diễn mọi lịch trực đều nghỉ Chủ nhật.

## Cài đặt và bảng phép

Tại **Cài đặt chấm công → Cài đặt phép**, chọn năm và nhân viên. Với dữ liệu cũ, nhập số đầu kỳ trước khi chỉnh tháng:

1. Xác nhận tổng số đã cấp **chưa trừ** đơn đã nghỉ/đang chờ, cùng tháng cuối đã nằm trong số này.
2. Nhập 0 và chọn đầu năm nếu cần tính từ tháng 1. Không tự chia tổng năm cũ thành 12 tháng, không tự coi tổng cũ là số dư.
3. Từ tháng sau kỳ đối soát, tác vụ tự tính các tháng đã kết thúc. Dữ liệu chưa đủ thì HR kiểm tra lại bảng công hoặc nhập số cấp tháng có căn cứ.
4. Nhập giá trị tháng để **thay thế** số tự tính; bỏ trống để quay về tự tính. Giá trị 0 là xác nhận không cấp, khác ô trống.
5. Khi đến mốc sáu tháng, xác nhận tiếp tục/dừng nếu chưa có bằng chứng chấm công để tự xác nhận.

Bảng phép có T1–T12, số đầu kỳ, phép đã cấp, dự tính chưa cấp, đã dùng, đang giữ cho đơn chờ và còn khả dụng. Dòng dự tính được ghi rõ, không coi là số dư được dùng. Lịch sử lưu người sửa, thời điểm, số trước, lý do và căn cứ tính tự động; giao diện hiển thị 100 sự kiện gần nhất, database giữ toàn bộ.

Nhân viên mới chưa có cấu hình tổng năm cũ được scheduler mở năm hiện tại với đầu kỳ 0. Trường hợp có tổng năm cũ chờ HR đối soát, scheduler không tự nhập lại toàn bộ lịch sử.

## Gửi, duyệt, xóa đơn

- Frontend lấy ngày cần nghỉ và số dư từ cùng RPC kiểm tra lịch với database, tránh tính Chủ nhật/ngày lễ ở trình duyệt khác với máy chủ.
- Đơn phép năm giữ chỗ số ngày ngay khi gửi. Duyệt cuối chuyển sang đã dùng; từ chối/xóa đơn chờ giải phóng số giữ chỗ. Xóa đề xuất đã duyệt vẫn giữ lịch sử số phép đã sử dụng.
- Tất cả đường ghi, gồm RPC nhân viên và HR/quản lý gửi trực tiếp, đều qua trigger kiểm tra. Khóa hồ sơ nhân viên khi gửi/cấp/sửa giúp hai đơn đồng thời không dùng quá số dư.
- Nhân viên không được tự đổi người duyệt hoặc tự duyệt đơn. Người duyệt được chỉ định, trưởng nhóm cùng bộ phận/chi nhánh, HR/admin giữ quyền quyết định theo luồng hiện có.
- Bỏ giới hạn mặc định 2 lần/tháng, cả UI, policy mẫu và trigger DB. `my_approval_leave_month_usage` vẫn có để tương thích, trả hạn mức `null`.
- Nghỉ 1–2 ngày đăng ký trước 3 ngày làm việc; từ 3 ngày cần 7 ngày làm việc. Khẩn cấp cần lý do ít nhất 5 ký tự; bổ sung chứng cứ/biểu mẫu khi quay lại. Đây không phải cách tự duyệt đơn.
- Có nghỉ việc riêng hưởng lương riêng: bản thân kết hôn 3 ngày, con kết hôn 1 ngày, tang theo Điều 5 là 3 ngày. Loại này cộng công hưởng lương khi duyệt nhưng không trừ phép năm; nghỉ không lương không được cộng công hưởng lương.
- Đơn ghi hạn phản hồi 2 ngày làm việc và hiển thị quá hạn; không tự duyệt khi quá hạn. Từ chối nghỉ cần lý do và đề xuất thời điểm khác trong ghi chú.
- Đồng bộ ngày nghỉ/chấm công chỉ dùng các ngày làm việc và số 0,5/1 đã kiểm tra; giữ nguồn đề xuất và lịch sử điều chỉnh hiện có.

Thao tác **Điều chỉnh ngày nghỉ** của chức năng cũ tiếp tục là điều chỉnh danh sách ngày nghỉ và bằng chứng. Nó không tự thay đổi số ngày đã trừ ở đơn gốc hoặc dữ liệu công đã chốt. Nếu dời sang kỳ khác, HR cần đối soát công và quỹ phép của các kỳ liên quan; không tự động suy ra hoàn phép từ đổi lý do nghỉ hoặc xóa dòng ngày nghỉ.

## Bảo lưu và thanh toán

Trong cài đặt nhân viên có giao dịch tăng/giảm số dư, gộp phép từ tối đa hai năm liền trước theo thỏa thuận, hoặc thanh toán số ngày chưa nghỉ. Gộp phép trừ ở năm nguồn và cộng ở năm nhận trong một giao dịch; phần đã gộp không được chuyển tiếp để kéo dài vô hạn. Không tự hết phép vào 31/12.

Thanh toán chỉ ghi giảm **số ngày phép** đã được cấp và chưa dùng/giữ chỗ, cùng căn cứ. Số tiền và lệnh trả lương vẫn thuộc quy trình kế toán; chức năng này không tự chuyển tiền hoặc tính đơn giá tiền phép.

## Triển khai

1. Chạy `supabase/migrations/20261117100000_monthly_leave_accrual.sql` sau `20261116100000_leave_day_links_and_adjustments.sql` và các migration hiện có. Migration tạo bảng mới, không ghi đè JSON phép năm cũ; nhập lịch sử giữ chỗ/sử dụng từ các đơn cũ. Dòng lịch sử lỗi ngày/UUID được báo warning để HR đối soát.
2. Triển khai frontend và endpoint `api/leave-accrual.js` cùng phiên bản migration. Tài khoản cũ cần đối soát đầu kỳ và xác nhận tiếp tục trước khi xin phép năm bằng số dư mới.
3. Cấu hình server `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (hoặc URL hiện có `VITE_SUPABASE_URL`). Service role key chỉ ở server, không dùng biến `VITE_*` cho khóa này.
4. `vercel.json` chạy cron mỗi ngày lúc **17:05 UTC = 00:05 giờ Việt Nam**. Tác vụ chỉ tính tháng đã kết thúc, chạy bù/đối soát các năm đang theo dõi trong khoảng năm hiện tại và hai năm liền trước. Có thể dùng scheduler khác gọi `GET /api/leave-accrual` với `Authorization: Bearer <CRON_SECRET>`.
5. HR/admin dùng nút **Đối soát lại các tháng đã kết thúc** để xử lý số liệu bảng công cập nhật muộn. Nút này chỉ xử lý công ty của người đăng nhập; scheduler toàn hệ thống chỉ cho `service_role` gọi.

Các bảng mới không cấp quyền ghi trực tiếp cho `anon`/`authenticated`; các RPC lấy danh tính theo cơ chế đăng nhập hiện có của ứng dụng, kiểm tra vai trò và công ty. Lưu tháng có phiên bản chống ghi đè khi người khác hoặc job vừa sửa. Scheduler chạy lại không cộng chồng lên khoản cũ hoặc số HR thay thế.

## Kiểm tra

```powershell
node --test src/utils/employeeLeave.test.mjs src/utils/leaveDays.test.mjs src/utils/attachments.test.mjs src/services/leaveDays.test.mjs src/pages/AttendancePreview.test.mjs src/components/PayrollTable.test.mjs api/leave-accrual.test.mjs
npm run build
```

Chỉ dùng PostgreSQL **trống, tách biệt**, không chạy fixture vào DB thật:

```powershell
psql -X -h 127.0.0.1 -p 55439 -U postgres -v ON_ERROR_STOP=1 -d monthly_leave_test -f supabase/tests/monthly_leave_accrual.sql
node scripts/test-monthly-leave-concurrency.mjs monthly_leave_test 55439
```

Fixture thay ngày nghiệp vụ thành 16/11/2026 để kiểm tra đúng mốc; đây chỉ là hàm trong database thử nghiệm. Bộ kiểm tra gồm sáu tháng, dừng/tiếp tục, cấp bù, thử việc, ngưỡng 50%, bảng công muộn, timezone, nhập tháng, phiên bản, ngày lễ/ca Chủ nhật, nửa ngày, giữ chỗ, duyệt/từ chối/xóa, gộp/thanh toán, phân quyền và hai kết nối nộp đơn đồng thời.
