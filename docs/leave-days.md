# Ngày nghỉ phép liên kết với đề xuất

Nhánh này bổ sung liên kết từ từng ngày nghỉ đến đề xuất nghỉ phép đã duyệt, chi tiết tệp của đề xuất và lịch sử điều chỉnh của HR/admin.

## Cập nhật database

Chạy `supabase/migrations/20261116100000_leave_day_links_and_adjustments.sql` sau các migration hiện có, trước khi triển khai frontend. Migration bổ sung cột và RPC, tự liên kết/tạo ngày nghỉ cho đề xuất đã duyệt trước đó. Có thể chạy lại; ngày đã điều chỉnh không bị tạo lại ở ngày cũ.

Chỉ quyết định duyệt cuối cùng mới đồng bộ ngày nghỉ. Đề xuất chờ duyệt hoặc bị từ chối không tạo ngày nghỉ. Quy tắc hiện có vẫn tính tất cả ngày trong khoảng bắt đầu/kết thúc, tối đa 366 ngày. Một nhân sự chỉ có một bản ghi ngày nghỉ mỗi ngày; nếu nhiều đề xuất trùng ngày, liên kết đầu tiên được giữ.

## Sử dụng

- Trong **Đề xuất**, chọn **Loại đề xuất → Nghỉ phép** ở Gửi đến, Gửi đi hoặc Quản trị. Bộ lọc giữ trên URL (`type=leave`) khi tải lại, chuyển tab và quay lại từ chi tiết. Số lượng Đang xử lý/Đã xong tính theo loại đang lọc.
- Tạo đơn bằng **Tạo đơn xin nghỉ phép** hoặc mẫu **Đơn xin nghỉ phép** có sẵn. Chỉ sử dụng luồng gửi/duyệt đề xuất; không còn form thêm ngày riêng.
- Mở đơn nghỉ để xem **Ngày nghỉ đã ghi nhận**, lọc trạng thái, xem lịch sử, xóa hoặc điều chỉnh theo quyền hiện có. Danh sách chỉ tải các ngày liên kết đúng đơn; chỉ HR/admin xem toàn bộ, tài khoản khác xem ngày của mình.
- Dưới danh sách khi lọc Nghỉ phép, mở **Ngày nghỉ thêm trực tiếp / đề xuất không còn trong danh sách** để quản lý bản ghi cũ và lịch sử. Ngày đã thuộc đề xuất hiện có không xuất hiện lặp ở đây.
- Menu **Ngày nghỉ phép** riêng được bỏ; `/ngay-nghi-phep` chuyển đến `/approvals?tab=admin&type=leave&filter=done`. Menu kế toán có mục **Đề xuất** để tiếp tục truy cập dữ liệu cũ. **Bảng phép** vẫn ở vị trí hiện tại.
- Chọn **Chi tiết / Điều chỉnh** để xem nội dung đề xuất, tệp và lịch sử.
- HR/admin có thể đổi ngày, đổi lý do hoặc chỉ thêm ghi chú/tệp. Ghi chú bắt buộc 5–2.000 ký tự; tệp tùy chọn, tối đa 5 tệp, 2 MB mỗi tệp và 5 MB tổng dung lượng mỗi lần điều chỉnh.
- Lịch sử lưu người sửa, thời điểm, ngày/lý do trước và sau, ghi chú và nội dung tệp. Nhân viên xem lịch sử ngày nghỉ của mình.
- Hai người cùng sửa một bản ghi: người lưu sau phải tải lại, tránh ghi đè thay đổi của người trước. Ngày trùng được database từ chối; điều chỉnh không được lưu dở dang.

Điều chỉnh áp dụng cho danh sách ngày nghỉ. Đề xuất gốc, số phép và dữ liệu chấm công đã được luồng duyệt cập nhật không tự thay đổi theo thao tác này.

Tệp mới trên trang Đề xuất được lưu đầy đủ dạng data URL, cùng cách lưu tệp ở Hồ sơ công ty. Tệp cũ chỉ có tên được hiển thị là chưa có nội dung; hệ thống không thể khôi phục nội dung chưa từng lưu. Danh sách ngày nghỉ chỉ tải cột tóm tắt; nội dung tệp/lịch sử chỉ tải khi mở chi tiết. Nếu đề xuất bị xóa, bản tóm tắt mã/tiêu đề vẫn còn trên ngày nghỉ; tệp gốc thuộc đề xuất không còn khả dụng.

## Kiểm tra

```powershell
node --test src/utils/leaveDays.test.mjs src/utils/approvalLeave.test.mjs src/utils/attachments.test.mjs src/services/leaveDays.test.mjs src/pages/Approvals.test.mjs src/components/DirectoryNavigation.test.mjs
npm run build
```

Kiểm tra SQL trên **database PostgreSQL trống, tách biệt** (fixture tạo bảng/role giả lập tối thiểu):

```powershell
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/leave_day_links_and_adjustments.sql <connection-to-empty-test-db>
```
