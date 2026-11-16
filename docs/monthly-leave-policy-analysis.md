# Phân tích phép theo tháng theo nội quy SpeeGo v0.4

Ngày phân tích: 16/11/2026.
Nhánh: `analysis/monthly-leave-policy`, tạo từ `origin/main` tại commit `22bf304b086889fa40e06a7eceae98aa84866d0f`.
Nguồn: `C:\Users\admin\Downloads\[SPG] NỘI QUY CÔNG TY_v0.4.pdf`, 11 trang; trọng tâm Điều 5–6, trang PDF 2–3.
Trạng thái nguồn: trang 1 ghi “Bản draft v0.4 – chờ Ban Giám đốc duyệt”. Tài liệu này phân tích theo bản được cung cấp, không xác nhận văn bản đã có hiệu lực.
Phạm vi hiện tại: phân tích và thiết kế thay đổi; chưa sửa chức năng, chạy migration hoặc cập nhật dữ liệu hệ thống.

## 1. Kết luận nghiệp vụ

Cần tách **phép tích lũy**, **phép được sử dụng**, **phép đã nghỉ** và **phép đang giữ cho đơn chờ duyệt**. Việc chưa được dùng phép trong giai đoạn đầu không đồng nghĩa với không được tích lũy phép.

| Nội dung | Nội quy được cung cấp | Hệ quả đối với chức năng |
| --- | --- | --- |
| Định mức cơ bản | Điều 6.1: đủ 12 tháng được 12 ngày làm việc | Cơ bản 1 ngày/tháng đủ điều kiện; không cấp trước toàn bộ năm theo mặc định |
| Tháng được tính | Ngày làm việc + ngày nghỉ hưởng lương đạt ít nhất 50% ngày làm việc bình thường của tháng | Không tự cộng chỉ dựa vào trạng thái chính thức và thời gian làm việc |
| Chưa đủ năm | Tính theo số tháng làm việc, làm tròn lên số nguyên gần nhất | Làm tròn ở kết quả phép theo kỳ đối soát, không làm tròn từng khoản tháng một cách làm tăng sai quyền lợi |
| Thử việc | Điều 6.2: thời gian thử việc được tính nếu tiếp tục làm việc sau thử việc | Ghi nhận thời gian thử việc có điều kiện; khi chuyển chính thức phải đối soát lại quyền lợi, không bỏ các tháng này |
| Khi bắt đầu dùng phép | “từ tháng thứ 06 sau khi ký hợp đồng lao động chính thức” | Mốc tính gắn với ngày hợp đồng chính thức; không dùng ngày vào làm thay thế |
| Bảo đảm quyền lợi | Điều 6.2 còn ghi bảo đảm số ngày phép theo số tháng từ ngày ký hợp đồng chính thức | Cần thống nhất cách kết hợp câu này với quyền tính thời gian thử việc, không tự suy ra thử việc bằng 0 |
| Thâm niên | Điều 6.1: cứ đủ 5 năm tại công ty thêm 1 ngày | Cần tính phần tăng theo thâm niên, không hard-code mọi nhân viên luôn chỉ được 12 ngày |
| Đăng ký nghỉ | Điều 6.3: nghỉ 1–2 ngày báo trước 3 ngày làm việc; từ 3 ngày báo trước 7 ngày làm việc; có nhánh khẩn cấp | Cập nhật kiểm tra ngày làm việc, lý do khẩn cấp và quy trình bổ sung |
| Phản hồi | Quản lý trả lời trong 2 ngày làm việc; từ chối/dời lịch phải có lý do và đề xuất thời điểm khác | Ghi hạn phản hồi, nhắc xử lý và yêu cầu thông tin khi từ chối/dời lịch |
| Chia đợt | Điều 6.5 cho nghỉ thành nhiều lần; thỏa thuận gộp tối đa 3 năm | Không có căn cứ trong PDF để tiếp tục mặc định chặn 2 lần/tháng; không tự xóa phép cuối năm |
| Thanh toán | Điều 6.6 quy định thanh toán phép chưa dùng khi thôi/mất việc hoặc công ty không bố trí được | Giữ số dư, nguồn năm phép và lịch sử để đối soát, hỗ trợ thanh toán |

Yêu cầu “chính thức trên 6 tháng được +1 cuối tháng” phù hợp với định mức cơ bản, nhưng chưa đủ để mô tả toàn bộ chính sách. Không được bắt đầu tích lũy từ tháng 7 rồi làm mất quyền lợi các tháng trước đó.

## 2. Những điểm cần chốt trước khi viết logic chính sách

1. **Mốc được sử dụng:** “từ tháng thứ 06” là vào tháng thứ sáu hay sau khi đủ sáu tháng tròn? Cần một ví dụ ngày ký cụ thể và ngày bắt đầu dùng. Hai cách tính `official_date + 5 months` và `official_date + 6 months` khác nhau; đây là các phương án cần xác nhận, chưa phải quy tắc đã chốt. Ngày hợp đồng chính thức có trùng `official_date` đang lưu trong hồ sơ không?
2. **Phần thử việc:** thống nhất cách ghi nhận và mở quyền sử dụng phép của các tháng thử việc khi tiếp tục làm việc. Điều 6.2 có cả câu tính thời gian thử việc và câu bảo đảm quyền lợi từ ngày ký chính thức; không đủ rõ để tự chọn cách cộng số dư.
3. **Thời điểm tiêu phép:** kiểm tra quyền dùng theo ngày gửi đơn hay theo ngày nghỉ? Phương án đề xuất: xét ngày nghỉ, đồng thời chỉ giữ chỗ bằng số phép đã phát sinh tại lúc gửi; ứng phép tương lai phải là chính sách riêng nếu có.
4. **Ngày bắt đầu áp dụng và số liệu cũ:** tổng phép năm hiện tại là định mức, số đã cấp hay số dư? Cần đối soát từng nhân viên, xác định đã tính các tháng nào để không cộng trùng.
5. **Năm phép, phần tăng thâm niên và bảo lưu:** chốt năm dương lịch hay năm công tác, thời điểm hưởng thêm khi tròn 5 năm giữa năm, cách làm tròn và xử lý phép gộp theo thỏa thuận.

Có thể tiếp tục thiết kế giao diện và cơ sở dữ liệu trong khi chờ chốt các điểm này. Chưa nên áp số dư tự động vào dữ liệu thật khi thiếu mốc hiệu lực và số đầu kỳ.

## 3. Hiện trạng trên main

| Thành phần | Hiện trạng đã kiểm tra |
| --- | --- |
| `src/components/LeaveSettingsPanel.jsx` | Chỉ nhập `total_leave` theo năm; chưa có ô nhập tháng |
| `src/pages/LeaveBoard.jsx` | Chỉ hiển thị thâm niên tính từ ngày vào làm và tổng phép năm; nút “Cập nhật tự động” chỉ tải lại dữ liệu |
| `src/utils/employeeLeave.js` | Đã chuẩn hóa `months` từ 1–12, nhưng giữ `total_leave` độc lập với dữ liệu tháng |
| `src/utils/employeeLeave.test.mjs` | Có test khẳng định tổng năm độc lập với phân bổ tháng; khi đổi nguồn tính tổng phải cập nhật hợp đồng dữ liệu và test này |
| `src/services/employeeLeave.js` | Ghi đè JSON toàn bộ nhân viên bằng upsert; tải `join_date`, `employment_status`, chưa tải `official_date` và `status` |
| `public.employee_leave_settings` | Một dòng mỗi công ty/nhân viên, lưu JSON năm; chưa có sổ giao dịch hoặc khóa chống cấp phép tháng trùng |
| `public.users` | Đã có ngày vào làm, ngày chính thức, trạng thái hiệu lực và trường tình trạng; không cần tạo lại các trường đã có |
| `public.employee_status_history` | Đã có lịch sử trạng thái với `effective_date`; cần kiểm tra độ đầy đủ trước khi dùng để tính lại các tháng cũ |
| `public.my_approval_leave_balance` | Đọc `total_leave`, trừ các đơn năm đang chờ/đã duyệt; chưa xét tháng cấp, thời điểm được dùng và các năm bảo lưu |
| `public.submit_employee_approval` | Nhân viên gửi qua RPC; kiểm tra tổng phép theo năm |
| `src/pages/Approvals.jsx` | HR/quản lý gửi bằng `fbPush` khác đường RPC của nhân viên; cần áp cùng kiểm tra ở DB cho mọi đường ghi |
| Giới hạn tháng | `my_approval_leave_month_usage` và trigger `enforce_approval_monthly_paid_leave_limit` chặn 2 đơn/tháng; đây là số lần, không phải số ngày được cấp |
| Ngày bị trừ phép | `listRequestLeaveDates`, `approval_leave_used` và SQL nộp đơn hiện đếm các ngày lịch liên tiếp; chưa loại ngày nghỉ/lễ theo lịch làm việc |
| Chấm công | Có đồng bộ đơn đã duyệt sang `employee_leave_days` và các điều chỉnh công; phải tránh trừ phép thêm lần nữa từ bản ghi ngày nghỉ |
| Tự động cấp | Chưa thấy tác vụ cấp phép tháng hoặc lịch cron trong mã nguồn đã kiểm tra; chưa kiểm tra cấu hình job ngoài repo trên môi trường đang chạy |

Phân tích được chốt trên main trong worktree riêng. Thay đổi đang diễn ra tại thư mục làm việc chung thuộc phiên khác không được coi là hiện trạng của main.

## 4. Giao diện sẽ thay đổi

### Cài đặt phép

- Chọn năm và nhập số ngày được cấp cho từng tháng T1–T12, hỗ trợ 0 và số lẻ. Số này là **phép cấp trong tháng**, không phải số đã nghỉ hoặc số dư cuối tháng.
- Phân biệt ô trống/chưa xác định với giá trị 0 đã được xác nhận; không biến dữ liệu thiếu thành 0 một cách im lặng.
- Hiển thị số tự tính, số HR điều chỉnh, lý do, người sửa và thời gian sửa.
- Đề xuất mặc định: nếu HR thay số phép của tháng thì đó là số cấp cuối cùng của tháng, thay thế số tự tính; tác vụ tự động không cộng thêm lên số đã chỉnh. Các khoản cộng/trừ ngoài tháng phải thành giao dịch riêng.
- Cho phép điều chỉnh giảm bằng giao dịch có lý do và đối soát ảnh hưởng tới các đơn đang giữ chỗ; không chỉ mở ô số âm tùy ý.
- Tổng năm được tổng hợp từ nguồn phát sinh đã đối soát; tách rõ định mức năm dự kiến và số thực tế đã tích lũy.

### Bảng phép

- Bổ sung T1–T12, tích lũy năm, bảo lưu, đang giữ chỗ, đã dùng, còn khả dụng và phần đang khóa.
- Hiển thị ngày vào làm, ngày chính thức, ngày bắt đầu dùng và lý do chưa đủ điều kiện.
- Nhân viên thử việc/chưa đến mốc sử dụng vẫn xem được quyền lợi đã ghi nhận có điều kiện.
- Nút tải lại ghi đúng tác dụng; bổ sung thông tin tháng đã chốt và lần cấp phép gần nhất.

### Đề xuất nghỉ

- Hiển thị số dư thực dùng được tại thời điểm kiểm tra, thay vì xem toàn bộ định mức năm như đã có sẵn.
- Phân biệt phép năm, nghỉ không lương và nghỉ việc riêng hưởng lương. Nghỉ hiếu/hỷ đúng Điều 5 không trừ vào phép năm.
- Dùng lịch làm việc thực tế để đếm ngày cần phép; Chủ nhật có lịch trực thì áp lịch nhân viên, không loại cứng mọi Chủ nhật.
- Kiểm tra báo trước 3/7 ngày làm việc và hỗ trợ trường hợp khẩn cấp; thời hạn phản hồi là 2 ngày làm việc, không phải tự động duyệt khi hết hạn.
- Gỡ giới hạn mặc định 2 lần/tháng ở cả giao diện và DB nếu dùng chính PDF này làm chính sách; chỉ giữ nếu có quy định bổ sung được xác định rõ.

## 5. Cơ chế cộng phép tháng đề xuất

1. Lấy lịch làm việc, ngày công, nghỉ hưởng lương và tình trạng theo hiệu lực trong tháng. Đạt ngưỡng 50% mới được tính tháng; dữ liệu công chưa đủ thì báo chờ đối soát, không suy thành nhân viên không đủ điều kiện.
2. Dùng `join_date` cho thời gian tại công ty và thử việc; dùng mốc hợp đồng chính thức đã chốt cho quyền sử dụng. Không chỉ nhìn trạng thái hiện tại để cấp lại toàn bộ lịch sử.
3. Ghi khoản tích lũy cơ bản +1 cho tháng đủ điều kiện. Với giai đoạn chưa được dùng, giữ phần này ở trạng thái khóa/có điều kiện theo chính sách đã chốt; khi mở quyền sử dụng không tạo thêm khoản cấp lần hai.
4. Cộng phần thâm niên theo quy tắc được chốt. Không làm tròn 13/12 thành 2 ngày ở mỗi tháng; lưu số tính chính xác hoặc đối soát chênh lệch quyền lợi lũy kế để tránh cấp dư.
5. Chạy phía máy chủ sau khi hết tháng theo `Asia/Ho_Chi_Minh`, ví dụ 00:05 ngày đầu tháng sau để chốt tháng trước. Không phụ thuộc có người mở trang. Ngày công chốt muộn được xử lý bằng điều chỉnh chênh lệch sau đối soát.
6. Khóa duy nhất theo công ty + nhân viên + tháng + loại cấp phép; chạy lại hoặc hai job đồng thời chỉ phát sinh một khoản cấp gốc. Hỗ trợ chạy bù kỳ bị bỏ lỡ và báo lỗi.
7. Nhân viên nghỉ việc/ngừng làm xử lý theo thời gian thực tế đủ điều kiện, không tiếp tục cấp các kỳ sau khi nghỉ. Tháng nghỉ việc vẫn phải kiểm tra quyền lợi, không tự bỏ toàn bộ tháng.
8. Đổi ngày chính thức/lịch sử công sau khi đã chốt phải tạo chênh lệch có lý do, không xóa lịch sử giao dịch.

Trong repo chưa có lịch tác vụ cho nghiệp vụ này. Có thể dùng Supabase `pg_cron` nếu môi trường hỗ trợ, hoặc scheduler phía máy chủ; cần kiểm tra môi trường khi triển khai.

## 6. Dữ liệu và tính nhất quán

Đề xuất thêm sổ giao dịch phép, dùng dữ liệu năm hiện tại làm dữ liệu tương thích trong giai đoạn chuyển đổi:

- Mỗi giao dịch có công ty, nhân viên, kỳ tháng, năm nguồn phép, loại giao dịch, số ngày, ngày có hiệu lực, phiên bản chính sách, nguồn đơn/chạy tự động, người thực hiện, lý do và khóa chống trùng.
- Các loại gồm cấp tháng, điều chỉnh, giữ chỗ, giải phóng giữ chỗ, sử dụng, chuyển năm và thanh toán. Chi tiết kiểu giao dịch là thiết kế đề xuất, chưa phải schema đã triển khai.
- Lưu liên kết đơn gốc để tránh tính cả đơn và bản ghi `employee_leave_days` thành hai lần sử dụng.
- Số khả dụng = số đã được mở quyền dùng + bảo lưu hợp lệ + điều chỉnh - đã dùng - đang giữ chỗ - đã thanh toán/hết hiệu lực theo chính sách.
- Gửi đơn thì giữ chỗ; duyệt chuyển giữ chỗ sang đã dùng; từ chối/hủy giải phóng; cập nhật nguyên tử trong DB và chống hai đơn đồng thời chi quá số dư.
- Chỉ nhân viên được xem số của mình; HR/admin điều chỉnh đúng công ty; job cấp phép không thể được người dùng thường gọi với quyền tùy ý.
- Thay upsert toàn bộ JSON bằng thao tác theo kỳ/giao dịch có kiểm soát phiên bản để HR đang lưu không ghi mất khoản job vừa cấp.
- API số dư và các kiểm tra DB dùng cùng nguồn dữ liệu, cả đường RPC và đường ghi đề xuất của HR/quản lý.
- Giữ nguồn năm và thỏa thuận bảo lưu để hỗ trợ gộp tối đa 3 năm và đối soát tiền phép; không mặc định hết phép vào 31/12.

## 7. Chuyển dữ liệu hiện có

1. Xuất bản đối soát theo công ty/nhân viên/năm: tổng đang cài, dữ liệu tháng nếu có, đơn chờ/đã duyệt, số đã dùng và ngày chính thức.
2. Phân loại `total_leave`: định mức dự kiến, số đã cấp hay số dư. Giá trị cũ không cho biết thời điểm cấp; không tự chia đều 12 tháng hoặc đưa toàn bộ vào số khả dụng.
3. HR xác nhận số đầu kỳ và các kỳ đã tính. Ghi giao dịch nhập số đầu kỳ có nguồn, giữ bản chụp dữ liệu cũ để truy vết.
4. Chọn ngày hiệu lực chính sách; chỉ cấp mới các tháng chưa được tính. Nếu tính lại lịch sử, dùng chạy thử và báo chênh lệch trước khi ghi.
5. Các đơn cũ đang chờ/đã duyệt tiếp tục được đối soát; báo trường hợp số đã cam kết vượt số tính mới, không tự xóa đơn hoặc sửa số dư để ép khớp.
6. Mở tác vụ cấp tháng sau khi đối soát xong. Không chạy job cấp bù mọi nhân viên trên dữ liệu chưa được xác nhận.

## 8. Phạm vi file và kiểm thử khi triển khai

Các file cần sửa: `LeaveSettingsPanel.jsx`, `HolidaySettings.jsx`, `LeaveBoard.jsx`, `EmployeeLeave.css`, `services/employeeLeave.js`, `utils/employeeLeave.js`, `Approvals.jsx`, `utils/approvalPolicy.js`; bổ sung xử lý loại nghỉ và liên kết ở `services/leaveDays.js`, đồng bộ chấm công tương ứng khi cần.

Thêm migration mới cho sổ phép, RPC số dư, cấp tháng, kiểm tra nộp/duyệt/hủy, quyền truy cập và loại bỏ giới hạn 2 lần/tháng nếu áp dụng theo PDF. Không sửa lịch sử migration cũ. Cập nhật các hàm đồng bộ ngày nghỉ dùng cùng lịch làm việc và loại nghỉ.

Các ca kiểm thử bắt buộc khi viết chức năng:

- Nhập tháng trống, 0, 0,5 và 1,5; sửa một tháng không ghi mất tháng khác.
- Thử việc không tiếp tục làm; thử việc chuyển chính thức được tính thời gian đúng chính sách.
- Chính thức chưa tới mốc, đúng mốc, sau mốc; ngày ký cuối tháng và tháng 2/năm nhuận.
- Tháng đạt đúng 50% và thấp hơn 50%; ngày công chưa chốt; thay ca, nghỉ không lương, vào/nghỉ việc giữa tháng.
- Đủ 5/10 năm giữa năm, tổng phép và làm tròn đúng quy tắc, không làm tròn tăng ở từng tháng.
- Job chạy lại, đồng thời, chạy bù, công chốt muộn; HR chỉnh tháng cùng lúc job chạy.
- Đơn qua tháng/qua năm, nửa ngày, ngày lễ/nghỉ hằng tuần và trực Chủ nhật; đơn trùng ngày.
- Hai đơn đồng thời, từ chối/hủy, chuyển giữ chỗ sang đã dùng đúng một lần.
- Nhân viên và HR/quản lý qua các đường gửi khác nhau đều bị kiểm tra ở DB.
- Nghỉ riêng hưởng lương không trừ phép năm; nghỉ không lương không thành công hưởng lương.
- Chuyển năm, gộp phép theo thỏa thuận, số dư thanh toán, không cấp trùng số đầu kỳ.
- Phân quyền theo nhân viên/công ty; người thường không gọi được tác vụ cấp hoặc tự đổi số dư.

## 9. Phạm vi ngoài bảng phép cần lưu ý khi nói “theo nội quy công ty”

Báo cáo này tập trung vào phép. Riêng Điều 9 của PDF quy định không phạt tiền/cắt lương thay kỷ luật và dùng điểm phúc lợi chuyên cần, trong khi `HolidaySettings.jsx` hiện có cài đặt mức phạt tiền. Nếu mục tiêu là toàn bộ phần mềm tuân theo toàn bộ nội quy v0.4 thì cần một đợt phân tích riêng về chấm công, phúc lợi và bảng lương. Không gộp thay đổi cơ chế phạt vào tính năng phép theo tháng khi chưa xác định phạm vi đó.

## 10. Thứ tự triển khai đề xuất

1. Chốt các mốc nghiệp vụ, ngày áp dụng và ý nghĩa số liệu cũ ở mục 2.
2. Thêm nguồn dữ liệu tháng/sổ phép và màn hình nhập, bảng đối soát; kiểm tra tổng và nguồn phát sinh.
3. Chuyển dữ liệu đã xác nhận, nối số dư với đề xuất/duyệt và loại nghỉ/chấm công.
4. Mở job cấp cuối tháng có chống trùng, chạy bù và giám sát.
5. Hoàn thiện các bước nhắc hạn, gộp/bảo lưu và báo cáo phục vụ thanh toán theo phạm vi triển khai đã thống nhất.
