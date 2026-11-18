# Chuyên cần theo điểm — nội quy SpeeGo v0.4

Ngày phân tích: 18/11/2026. Người dùng chốt áp dụng từ **tháng 11/2026**, bao gồm các ngày đầu tháng; tháng 10/2026 trở về trước giữ cơ chế cũ.

Nguồn đã đọc: `D:\Users\admin\Downloads\[SPG] NỘI QUY CÔNG TY_v0.4.pdf`, đủ 11 trang. SHA-256: `DA58B9D26B0768A6C1ED0ED12FADD419E1B94CF81CEF258373BC03215BD4D9BF`. PDF ghi bản draft v0.4, ngày ban hành/hiệu lực chưa điền; tháng áp dụng trong phần mềm là quyết định của người dùng trong phiên này.

## Quy tắc rút từ tài liệu

Điều 9, trang PDF 4: mỗi người có 100 điểm chuyên cần mỗi tháng. Xét từng lần vi phạm, không cộng tổng phút tháng để chọn một mức như phần mềm cũ.

| Hành vi | Điểm trừ | Đơn vị |
| --- | ---: | --- |
| Quên chấm công không giải trình được | 10 | lần |
| Đi muộn, về sớm, ra ngoài không phép dưới 30 phút | 10 | lần |
| Như trên, từ 30 đến hết 60 phút | 20 | lần |
| Như trên, trên 60 phút | 30 | lần |
| Nghỉ không phép | 40 | ngày |
| Vi phạm trang phục, trật tự, vệ sinh tại Điều 10 | 10 | lần |

Điều 10.5 ở trang PDF 5 là căn cứ cho nhóm vi phạm trật tự; không giữ mức phạt tiền riêng cho say xỉn/không trực nhật như danh mục cũ. Nghỉ đột xuất không có một mức điểm riêng trong bảng Điều 9: chỉ ghi nhận tần suất nếu không có lý do chính đáng; nếu thực chất là nghỉ không phép, HCNS phân loại thành nghỉ không phép, không tính trùng hai lần.

```text
tổng điểm trừ = tổng điểm các sự kiện áp dụng trong tháng (không tính sự kiện được miễn), gồm mức admin đã chỉnh
điểm còn lại = max(0, 100 - tổng điểm trừ)
tỷ lệ hưởng = điểm còn lại / 100
phúc lợi chuyên cần dự kiến = mức tối đa × tỷ lệ hưởng
```

Phụ lục 02, mục 16, trang PDF 11: mức tối đa nhân viên 1.000.000đ/tháng, quản lý 2.000.000đ/tháng; đối tượng của phụ lục là nhân viên chính thức. Không suy vai trò đăng nhập `admin`/`hr` thành nhóm quản lý được hưởng 2 triệu. HCNS xác định nhóm hưởng cho từng người trong kỳ; chưa xác định thì chưa tính số tiền.

Điểm không âm, không chuyển số điểm trừ dư sang tháng tiếp theo. Giữ tổng điểm vi phạm thực tế, ví dụ trừ 120 thì còn 0, không sửa lịch sử thành chỉ vi phạm 100 điểm. Đây là phúc lợi ngoài lương; không ghi số tiền giảm phúc lợi vào các cột tiền phạt hay tự trừ lương.

## Áp dụng điểm, điều chỉnh và giải trình

- Điều 7.2, trang PDF 3: giải trình quên chấm trong ngày, HCNS xử lý trong 2 ngày làm việc; tối đa 2 lần giải trình/tháng, có bằng chứng và xác nhận quản lý. Đây không phải tự động miễn 2 lỗi quên chấm đầu tháng.
- Điều 8, trang PDF 3–4: xin trước tối thiểu 30 phút; quá hạn phản hồi tối đa 2 ngày làm việc mà người lao động đã báo đúng hạn thì không coi là không phép. Bất khả kháng có nhánh báo sau và chứng cứ.
- Phần mềm hiện chỉ nhận đơn muộn/sớm `approved` đúng người/ngày. Không đủ dữ liệu để tự kết luận mọi đơn `pending` là không phép, hoặc xác định một đơn xin muộn có miễn luôn lượt về sớm cùng ngày hay không.
- Theo yêu cầu cập nhật ngày 18/11/2026, dữ liệu từ bảng công **áp dụng trừ điểm ngay, không qua duyệt**. Sự kiện cũ đang chờ cũng chuyển sang áp dụng. Admin sửa điểm trừ từng sự kiện từ 0 đến 100 hoặc đưa về mức theo nội quy; HCNS vẫn có thể ghi nhận và miễn điểm có lý do. Sự kiện miễn vẫn được lưu để đối soát.
- Điều 9.4 yêu cầu biên bản hoặc ghi nhận HCNS và thông báo tới người lao động cho mỗi lần trừ điểm. Lưu người thao tác, thời điểm, ghi nhận và nhật ký thay đổi; hiển thị điểm trừ ngay ở bảng công cá nhân. Không bắt buộc ghi chú hay người duyệt để áp dụng mức trừ theo nội quy. Việc hiển thị trong ứng dụng không đồng nghĩa đã gửi email/SMS.
- Khi thời lượng thay đổi, hệ thống tự cập nhật điểm theo nội quy, giữ mức admin đã chỉnh cho cùng sự kiện. Miễn điểm được giữ nếu dữ liệu không đổi. Chỉnh ghi chú không được đổi sự kiện tự động thành nhập tay.
- Ngày chưa có dữ liệu không tự coi là nghỉ không phép. Các lượt chấm thiếu trong ngày chưa kết thúc chỉ là chờ kiểm tra.

## Ví dụ biên

| Dữ liệu trong tháng | Tổng điểm đã trừ | Còn lại | Nhân viên | Quản lý |
| --- | ---: | ---: | ---: | ---: |
| Không vi phạm | 0 | 100 | 1.000.000đ | 2.000.000đ |
| Muộn 20 phút ở 2 ngày | 20 | 80 | 800.000đ | 1.600.000đ |
| Muộn 20 phút và về sớm 20 phút cùng ngày, đều không phép | 20 | 80 | 800.000đ | 1.600.000đ |
| Muộn đúng 30 phút | 20 | 80 | 800.000đ | 1.600.000đ |
| Muộn đúng 60 phút | 20 | 80 | 800.000đ | 1.600.000đ |
| Muộn 61 phút | 30 | 70 | 700.000đ | 1.400.000đ |
| Nghỉ không phép 3 ngày | 120 | 0 | 0đ | 0đ |
| Quên chấm đã giải trình và được miễn | 0 | 100 | 1.000.000đ | 2.000.000đ |

Số tiền trên giả định đã thuộc đối tượng hưởng và được phân nhóm trong kỳ, chưa xét quy chế bổ sung về làm không đủ tháng. PDF không nêu cách chia tỷ lệ phúc lợi cho tháng lên chính thức/nghỉ việc giữa tháng; không tự đặt một công thức chia theo ngày.

## Tần suất và kỷ luật là hai luồng riêng

Điều 8.4, 14.5, trang PDF 4, 6–7: trong tháng từ 4 lần muộn/về sớm/ra ngoài/nghỉ đột xuất không có lý do chính đáng, hoặc từ 2 ngày nghỉ không phép, là ngưỡng chuyển HCNS xem xét vi phạm chuyên cần. Chỉ cảnh báo từ các sự kiện đang áp dụng (không tính sự kiện được miễn), không tự ban hành kỷ luật hoặc suy mức kỷ luật từ số điểm.

Theo PDF, bậc thang kỷ luật có thời hạn xóa; tự ý bỏ việc còn có cửa sổ 30/365 ngày. Chức năng điểm tháng không thay thế sổ kỷ luật hoặc quy trình Điều 15.

## Đối chiếu mã nguồn và phạm vi cập nhật

| Thành phần | Hiện trạng trước thay đổi | Cập nhật cần thiết |
| --- | --- | --- |
| `src/utils/attendancePenalties.js` | Miễn 2 lượt <15 phút; phạt 50k/100k theo tổng phút tháng | Chọn cơ chế theo tháng; giữ nhánh cũ và chuyển nhánh mới sang sự kiện điểm |
| `src/services/attendancePenaltiesDb.js` | `attendance_penalties.amount`, lưu thay danh sách bằng nhiều request | Bảng điểm riêng; lưu nguyên tử, chống ghi đè phiên cũ; không diễn giải số tiền lịch sử thành điểm |
| `src/services/attendanceMonthSummary.js` | Tổng hợp công tự đồng bộ bảng phạt | Tạo từng sự kiện và trừ ngay; giữ điều chỉnh admin khi nạp lại cùng sự kiện |
| `src/pages/AttendancePenalties.jsx` | Bảng tiền theo tháng, desktop/mobile | Bảng điểm, tổng hợp 100 điểm/người, nhóm phúc lợi, trạng thái kiểm tra; tháng cũ vẫn xem tiền |
| `src/pages/HolidaySettings.jsx` | Danh mục tiền phạt có thể sửa | Tách hướng dẫn điểm cố định theo v0.4 khỏi danh mục tiền của kỳ cũ |
| `src/utils/attendanceExcel.js`, `src/pages/Attendance.jsx` | Có công thức cứng 50k/200k và cột tiền phạt | Tháng mới bỏ công thức tiền phạt; xuất điểm trừ thực tế, gồm điều chỉnh admin; bỏ cột chờ kiểm tra |
| `src/components/PayrollTable.jsx` | Hiện tổng tiền phạt | Tháng mới hiện điểm chuyên cần; không coi điểm là đồng |
| `src/pages/MyAttendance.jsx` | Chưa có thông báo từng lần trừ điểm | Hiện sự kiện áp dụng/được miễn đúng người |

Phát hiện liên quan nhưng khác phép tính điểm: `attendanceSummary.js` đang giữ công khi muộn+sớm <60 phút/ngày. Điều 9.1 nói trả theo thời gian thực tế. Yêu cầu hiện tại chuyển **quy chế phạt sang điểm**; việc thay ngưỡng giữ công là thay đổi chính sách công/lương riêng, cần được chốt trước khi thay. Không dùng điểm để thay đổi số phút hoặc công thực tế.

## Dữ liệu và chuyển đổi

1. Mốc chọn chính sách cố định `2026-11`; tháng trước đó đi nhánh tiền cũ.
2. Dùng bảng sự kiện điểm, nhóm phúc lợi theo tháng và nhật ký thay đổi riêng. Dữ liệu `attendance_penalties` cũ giữ nguyên, kể cả các khoản đã nhập cho tháng 11; các khoản tiền đó không được cộng vào điểm mới.
3. Khóa ổn định cho sự kiện tự động gồm nhân viên + ngày + mã lượt chấm/loại; snapshot mới giữ từng lượt, snapshot cũ chỉ có tổng ngày cần tổng hợp lại hoặc HCNS đối soát khi cần. Nhập tay cho ra ngoài, trật tự và các trường hợp cần HCNS xác minh.
4. Phân quyền: HCNS/admin lưu; chỉ admin sửa mức điểm; quản lý xem; người lao động chỉ xem sự kiện của chính mình. Nhật ký ghi việc thêm/sửa/xóa để đối soát thay đổi.
5. Dữ liệu phát sinh và nhóm hưởng thuộc tháng; không dùng nhóm hiện tại để tính lại kỳ đã qua. Số tiền là dự kiến phúc lợi, không tự tạo thanh toán hoặc thu hồi khoản đã chi.
6. Migration được kiểm tra trên PostgreSQL cục bộ; việc áp dụng vào môi trường thật phải được nêu rõ trong báo cáo triển khai.

Đăng nhập và phân quyền kế thừa `current_hr_profile_id()` / `current_hr_role()` đang có, hỗ trợ cả Supabase Auth và luồng đăng nhập tài khoản hiện tại. Các policy lọc theo hồ sơ này; không thay cơ chế xác thực của toàn hệ thống trong thay đổi điểm. Hồ sơ không tồn tại hoặc không có vai trò phù hợp thì không được ghi. Bảng điểm không tự bị xóa khi xóa bảng công; khi nhập lại công, tổng hợp lại để đối soát sự kiện và giữ nhật ký thay đổi.

## Các kiểm tra bắt buộc

- Các biên 0, 1, 29, 30, 60, 61 phút; muộn và sớm độc lập; không còn miễn 2 lượt ở tháng mới.
- Điểm được trừ ngay, gồm sự kiện từng chờ duyệt; sự kiện được miễn không trừ điểm; tổng vượt 100 còn 0; người không có lỗi vẫn có 100 điểm.
- Đúng nhóm nhân viên/quản lý; chưa xác định nhóm không tự trả tiền; tách theo tháng.
- Tổng hợp lại giữ miễn khi dữ liệu không đổi; thay đổi thời lượng tự cập nhật mức trừ. Điều chỉnh điểm của admin được giữ theo mã sự kiện dù thay đổi thời lượng. Không trùng sự kiện.
- Không thay số tiền và kết quả tháng 10/2026 trở về trước; không biến dữ liệu tiền tháng 11 thành điểm.
- DB từ chối sai tháng/ngày, loại sự kiện, điểm ngoài phạm vi, thiếu lý do miễn, người không phải admin sửa mức điểm, truy cập sai người và lưu bằng phiên cũ; một lần lưu thành công hoặc rollback toàn bộ.
- Excel tháng mới không còn công thức tiền phạt khi mở lại; điểm trừ và điều chỉnh admin khớp bảng đã lưu; các test Excel/công cũ vẫn đạt.

## Triển khai và kết quả xác minh

Mã nguồn đã cập nhật; **chưa áp dụng migration vào database thật và chưa triển khai ứng dụng lên hosting**.

1. Áp dụng lần lượt `supabase/migrations/20261118100000_attendance_points.sql` và `supabase/migrations/20261118110000_attendance_points_direct_deduction.sql` vào database trước khi triển khai giao diện mới. Migration cần các helper đăng nhập và bảng `users` đã tồn tại trên hệ thống hiện tại; không sửa hoặc chuyển đổi dữ liệu tiền cũ.
2. Mở `/bang-phat`, chọn tháng 11/2026, tổng hợp/nạp bảng công, phân nhóm hưởng và lưu để áp dụng trừ điểm ngay; admin có thể sửa điểm trừ, hoặc dùng Theo nội quy để khôi phục mức mặc định. Chỉ dữ liệu đã lưu mới được xuất Excel và hiển thị ở bảng công cá nhân.
3. Chọn tháng 10/2026 hoặc trước đó để xem bảng tiền cũ. Chọn lại tháng 11/2026 trở đi để xem điểm.

Kết quả kiểm tra trước yêu cầu bỏ bước duyệt (lịch sử):

- Toàn bộ `src/**/*.test.mjs`: **260 kiểm thử, 251 đạt, 9 bỏ qua, 0 lỗi**. Các kiểm thử bỏ qua cần workbook ngoài repo; không có test thất bại. Bổ sung export `fbSet` còn thiếu trong mock của `Employees.test.mjs` để chạy lại được bộ kiểm tra nhập nhân viên hiện có.
- `npm run build`: đạt. Có cảnh báo kích thước bundle Excel và các cảnh báo sẵn có; không có lỗi build.
- `node scripts/test-attendance-points-db.mjs`: **6 nhóm kịch bản DB đạt**, trên cụm PostgreSQL tạm tại `127.0.0.1:55441`; kiểm tra migration, transaction rollback, phiên đồng thời, ràng buộc điểm/ngày/giải trình, cả hai chế độ đăng nhập, RLS và nhật ký. Dữ liệu tiền tháng 10 và tháng 11 trong fixture giữ nguyên.
- Chrome headless, API giả: luồng HCNS bắt buộc ghi nhận trước xác nhận; 10 điểm trừ còn 90 và phúc lợi dự kiến 900.000đ; xuất Excel; chuyển kỳ tiền cũ/điểm mới; mobile 390px không tràn trang; bảng công cá nhân hiển thị ghi nhận; quản lý chỉ xem. Không có lỗi JavaScript chưa xử lý. Ảnh và file Excel QA lưu tạm ở `D:\Temp\admin\hrm-points-ui-qa`.

Chưa thay ngưỡng giữ công dưới 60 phút và chưa triển khai toàn bộ quy trình giải trình/duyệt OMS theo hạn 30 phút, 2 ngày làm việc, hoặc sổ kỷ luật. Trong chức năng điểm, điểm được trừ ngay; HCNS có thể đối soát và miễn, admin có thể chỉnh mức trừ sau; có cờ chuyển xem xét tần suất, không tự xử lý kỷ luật. Việc phân nhóm phúc lợi giữa tháng cần quy chế bổ sung như đã nêu ở trên.


## Kết quả sau cập nhật trừ điểm ngay — 18/11/2026

- Toàn bộ `src/**/*.test.mjs`: 262 kiểm thử, 253 đạt, 9 bỏ qua do thiếu workbook ngoài repo, 0 lỗi.
- `npm run build`: đạt; còn cảnh báo bundle Excel lớn và cảnh báo có sẵn.
- `node scripts/test-attendance-points-db.mjs`: 8 nhóm kịch bản đạt trên PostgreSQL cục bộ. Gồm chuyển sự kiện cũ đang chờ sang áp dụng; tránh trừ trùng ngày nghỉ; lưu không cần duyệt/ghi chú; admin sửa điểm từ 0 đến 100 và khôi phục nội quy; HR giữ nhưng không tự sửa mức admin; RLS, nhật ký, rollback, phiên đồng thời và dữ liệu tiền cũ.
- Chrome headless với API giả: HR nạp/lưu không cần duyệt; admin chỉnh 10 thành 5 còn 95 điểm và phúc lợi dự kiến 950.000đ; tải lại/nạp lại giữ điều chỉnh; mobile chỉnh về 0; nút Theo nội quy khôi phục mặc định; Excel xuất đúng mức trừ thực tế và bỏ cột chờ duyệt; nhân viên thấy mức admin đã chỉnh; quản lý chỉ xem. Không có lỗi JavaScript chưa xử lý, mobile 390px không tràn trang.
- Ảnh và Excel QA: `D:\Temp\admin\hrm-points-ui-qa\direct`. Migration mới chưa áp dụng vào database thật; chưa triển khai hosting.
