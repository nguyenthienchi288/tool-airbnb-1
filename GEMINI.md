# GEMINI.md — PROJECT RULES & ARCHITECTURE GUIDELINES (CLEAN CORE v3.0.0)

## 1. TỔNG QUAN KIẾN TRÚC DỰ ÁN (MONOREPO)
Dự án là hệ thống thu thập dữ liệu phòng và danh mục chủ nhà trên Airbnb, được tinh gọn về đúng nguyên bản thuật toán cốt lõi của **`爱彼迎2/`** (`v3.0.0 - Clean Core (爱彼迎2 Original Algorithm)`):
- **`backend/` (NestJS + TypeScript, cổng `3000`):**
  - `modules/scraper/` (`browser.service.ts`, `scraper.service.ts`): Thực thi luồng 3 bước chuẩn của `爱彼迎2`:
    1. Quét trang tìm kiếm `/s/{cityName}/homes?checkin=...&checkout=...` theo phân trang `Next`.
    2. Cào chi tiết từng phòng `/rooms/{id}?check_in=...&check_out=...&locale=en` (bắt giá từ `StaysPdpBookItQuery`, bóc tách thông tin từ `#data-deferred-state-0` và DOM fallback).
    3. Quét toàn bộ phòng của từng Host qua `/users/show/{hostId}` (mở `View all` & `Show more`).
  - `modules/parser/` (`pdp-parser.service.ts`, `host-parser.service.ts`): Ánh xạ 1-1 từ `search_detail_spider.py`, `price_spider.py`, `host_room_spider.py`.
  - `modules/database/` (`database.service.ts`): Lưu trực tiếp vào SQLite (`data/airbnb_market.db`, WAL mode) với 2 bảng chính `listings` và `host_listings`.
  - `modules/exporter/` (`exporter.service.ts`): Xuất `{city}_homes.xlsx` và `{city}_host_rooms.xlsx` vào thư mục `output/`.
- **`frontend/` (React + Vite + TypeScript + Tailwind CSS, cổng `5173`):**
  - Giao diện tối giản gồm: Form cấu hình gọn nhẹ (`Thành phố`, `Check-in/Check-out`, `Số trang`, `Số luồng`, `Proxy URL`, `Quét phòng của Host`), Khung Log & Tiến độ SSE thời gian thực, Bảng xem trước dữ liệu và Danh sách file Excel trong `output/`.
- **`爱彼迎2/` (Chỉ đọc - Reference):** Mã nguồn Python gốc tham chiếu; **tuyệt đối không xóa hoặc sửa đổi**.

---

## 2. QUY TẮC CỐT LÕI
1. **Không thêm ma trận từ khóa đa ngôn ngữ / chia lưới 3x3 / ping mạng nền liên tục:** Giữ nguyên luồng tìm kiếm trực tiếp theo thành phố và phân trang chuẩn để tránh bị Airbnb chặn IP.
2. **Chuẩn hóa Tên Host:** Không bao giờ lấy ký tự đơn lẻ (`length <= 1`) từ vòng tròn avatar làm tên Host; không ghi đè tên Host đầy đủ đã có trong SQLite bằng chuỗi rỗng hoặc 1 ký tự.
3. **Proxy & Luồng chạy:** Hỗ trợ đọc `PROXY_SERVER`, `PROXY_USERNAME`, `PROXY_PASSWORD` từ `.env` hoặc `proxyUrl` từ UI. Nếu để trống, chạy Direct Wi-Fi với `3–5` luồng song song.
4. **Version & Build Check:** Luôn giữ `APP_VERSION = 'v3.0.0 - Clean Core (爱彼迎2 Original Algorithm)'` trong `backend/src/config/constants.ts` và chạy `npm run build` để kiểm tra 0 lỗi TypeScript ở cả `backend/` và `frontend/` sau mỗi thay đổi.
