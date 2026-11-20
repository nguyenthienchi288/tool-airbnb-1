import time
import urllib.parse
import pandas as pd
from loguru import logger
from playwright.sync_api import sync_playwright
from config import city_name, first_day, last_day

def get_search_urls(num=5):
    logger.info(f'Bắt đầu mở trình duyệt tìm kiếm phòng tại: {city_name} ({first_day} -> {last_day})...')
    encoded_city = urllib.parse.quote(city_name)
    current_url = f"https://www.airbnb.com/s/{encoded_city}/homes?checkin={first_day}&checkout={last_day}"
    
    urls = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        
        for current_page in range(1, num + 1):
            logger.info(f"Đang truy cập và lấy link phòng ở trang {current_page}...")
            page.goto(current_url, timeout=60000)
            
            try:
                page.wait_for_selector('a[href*="/rooms/"]', timeout=15000)
            except Exception:
                logger.warning("Không tìm thấy thêm phòng nào trên trang này.")
                break
            
            # Cuộn xuống để load hết các thẻ phòng trên trang
            for _ in range(4):
                page.mouse.wheel(0, 1500)
                time.sleep(1)
                
            links = page.locator('a[href*="/rooms/"]').all()
            for link in links:
                href = link.get_attribute("href")
                if href and "/rooms/" in href:
                    room_id = href.split("/rooms/")[1].split("?")[0]
                    if room_id.isdigit():
                        clean_url = f"https://www.airbnb.com/rooms/{room_id}?check_in={first_day}&check_out={last_day}&locale=en"
                        urls.append({'url': clean_url})
            
            logger.info(f"Đã gom được {len(urls)} link (chưa lọc trùng) sau trang {current_page}.")

            # Lấy trực tiếp link href của nút Next thay vì bấm chuột vật lý
            next_btn = page.locator('a[aria-label="Next"], a[aria-label="Tiếp theo"]').first
            if next_btn.count() > 0:
                next_href = next_btn.get_attribute("href")
                if next_href:
                    current_url = urllib.parse.urljoin("https://www.airbnb.com", next_href)
                    time.sleep(2)
                else:
                    logger.info("Nút Next không có link. Dừng lấy trang.")
                    break
            else:
                logger.info("Đã đến trang cuối cùng.")
                break
                
        browser.close()

    # Lọc trùng lặp
    urls = list({d['url']: d for d in urls}.values())
    for u in urls:
        print(u['url'])
        
    logger.info(f'Tổng số link phòng lấy được sau khi lọc trùng: {len(urls)}')
    pd.DataFrame(urls).to_csv('search_urls.csv', index=False)
    logger.success('Đã lưu xong danh sách link vào search_urls.csv!')