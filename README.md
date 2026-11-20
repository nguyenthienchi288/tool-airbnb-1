# Airbnb Market CLI (`airbnb.com.vn` OTA Arbitrage Tool)

Công cụ dòng lệnh Node.js chuyên sâu dành riêng cho `https://www.airbnb.com.vn/`, tự động thu thập dữ liệu qua kiến trúc **Hyperloop + Niobe GraphQL**, mở rộng danh sách theo Host, khử trùng lặp, phân loại chung cư cao tầng qua `AMENITIES_DEFAULT`, chuẩn hóa địa chỉ tòa nhà và xuất báo cáo Excel `.xlsx` 4 sheet phục vụ đối sánh thị trường OTA Arbitrage.

---

## 1. Cài đặt môi trường & Playwright

Yêu cầu **Node.js >= 18**.

```bash
# 1. Cài đặt các thư viện Node.js
npm install

# 2. Cài đặt trình duyệt Chromium cho Playwright (bắt buộc)
npx playwright install chromium

# (Nếu chạy trên Linux/Ubuntu Server, cài thêm dependencies hệ thống)
npx playwright install-deps chromium

# 3. Tạo file cấu hình .env từ mẫu
cp .env.example .env
```

---

## 2. Cách sử dụng CLI

### Chạy quét một thành phố mục tiêu
```bash
node src/index.js --city "Bangkok" --country "Thailand"
```

### Tùy chọn nâng cao
```bash
node src/index.js \
  --city "Tokyo" \
  --country "Japan" \
  --iterations 10 \
  --target 100 \
  --headed
```

Các tham số:
- `-c, --city <city>`: Tên thành phố mục tiêu (bắt buộc).
- `-C, --country <country>`: Tên quốc gia mục tiêu (bắt buộc). **Chặn cứng** nếu là `Vietnam` / `Việt Nam`, `Indonesia`, hoặc `Malaysia`.
- `-i, --iterations <number>`: Số khung ngày tìm kiếm (mặc định: `10`).
- `-t, --target <number>`: Số căn thô mục tiêu (mặc định: `100`).
- `--headed`: Mở trình duyệt Chromium hiển thị trực tiếp (mặc định chạy ẩn `headless`).
- `--skip-host-expansion`: Bỏ qua bước mở rộng danh sách từ trang cá nhân Host.
- `--export-only`: Chỉ tổng hợp lại từ SQLite cache (`data/airbnb_market.db`) và xuất Excel mà không mở trình duyệt.

---

## 3. Cấu trúc file Excel đầu ra (`output/`)

Mỗi lần chạy sẽ tạo/cập nhật 2 file:
1. `output/Airbnb_Market_Report_<City>_<Date>.xlsx` (4 Sheet):
   - **`Tong_Quan_Doi_Sanh`**: Dashboard đối sánh thị trường, công thức tỷ lệ chung cư cao tầng và cột Verdict (`ĐẠT CHUẨN - ƯU TIÊN CHỌN` / `CHƯA ĐẠT CHUẨN`).
   - **`Top_10_Toa_Nha_Tiem_Nang`**: Xếp hạng các tòa nhà cao tầng (`YES`), tô xanh các tòa đạt $\ge 5$ Host độc lập, kèm giá Min/Max/Avg, biên độ giá và link căn bán chạy nhất.
   - **`Du_Lieu_Chi_Tiet_Can_Ho`**: Master Data toàn bộ căn hộ sạch (`YES`/`NO`), tiện nghi nhận diện từ `AMENITIES_DEFAULT`, Hyperlink tới phòng & Profile Host.
   - **`Ma_Tran_Gia_Theo_Ngay`**: Bảng theo dõi biến động giá qua 10 khung ngày kèm công thức Excel `MIN`, `MAX`, `AVERAGE`, `% Spread`.
2. `output/Master_City_Comparison.xlsx`: Tự động nối/cập nhật dữ liệu khi bạn quét thêm thành phố mới để so sánh song song nhiều thị trường quốc tế.
