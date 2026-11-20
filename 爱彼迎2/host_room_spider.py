import os
import re
import time
from loguru import logger
import pandas as pd
from playwright.sync_api import sync_playwright
from config import first_day, last_day, city_name
from search_detail_spider import get_room_detail, EXPECTED_COLUMNS

"""
获取所有房东的所有房源（基于 Playwright + airbnb.com）
"""


def clean_string(s):
    """清理 Excel 不支持的 ASCII 控制字符，保留正常文本与货币符号"""
    return re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]', '', s)


def clean_host_rooms(rooms):
    """清理房间列表中的所有字典数据"""
    for room in rooms:
        for key, value in room.items():
            if isinstance(value, str):
                room[key] = clean_string(value)
            elif value is None:
                room[key] = ''
    return rooms


def _collect_host_room_ids(page, host_url):
    """打开房东主页并提取其名下所有房源 ID"""
    page.goto(host_url, timeout=60000, wait_until='domcontentloaded')
    page.wait_for_timeout(3000)

    # 若存在 "View all X listings" 按钮则点击展开弹窗
    view_all_btn = page.locator("button:has-text('View all'), a:has-text('View all')").first
    if view_all_btn.count() > 0:
        try:
            view_all_btn.click()
            page.wait_for_timeout(2000)
        except Exception:
            pass

    # 若弹窗内有更多房源，尝试点击 Show more 或滚动加载
    dialog = page.locator('[role="dialog"]').first
    prev_count = -1
    for _ in range(15):
        links = (dialog if dialog.count() > 0 else page).locator('a[href*="/rooms/"]').all()
        if len(links) == prev_count:
            show_more = (dialog if dialog.count() > 0 else page).locator("button:has-text('Show more')").first
            if show_more.count() > 0 and show_more.is_visible():
                try:
                    show_more.click()
                    page.wait_for_timeout(1500)
                    continue
                except Exception:
                    break
            break
        prev_count = len(links)
        try:
            if dialog.count() > 0:
                dialog.evaluate("el => el.scrollBy(0, 1500)")
            else:
                page.mouse.wheel(0, 1500)
            page.wait_for_timeout(800)
        except Exception:
            break

    container = dialog if dialog.count() > 0 else page
    rids = []
    seen = set()
    for link in container.locator('a[href*="/rooms/"]').all():
        href = link.get_attribute('href') or ''
        if '/rooms/' in href:
            rid = href.split('/rooms/')[1].split('?')[0]
            if rid.isdigit() and rid not in seen:
                seen.add(rid)
                rids.append(rid)
    return rids


def get_host_rooms():
    homes_file = f'{city_name}_homes.xlsx'
    if not os.path.exists(homes_file):
        raise FileNotFoundError(f"未找到 {homes_file}，请先成功运行第二步 get_search_rooms()。")

    df = pd.read_excel(homes_file)
    if df.empty:
        raise ValueError(f"{homes_file} 为空（0 行数据），无法获取房东链接，已中止。")
    if '房东链接' not in df.columns:
        raise KeyError(f"{homes_file} 缺少 '房东链接' 列（当前列: {list(df.columns)}），已中止。")

    # 去重房东链接，避免重复抓取同一房东
    host_pairs = []
    seen_hosts = set()
    for _, row in df.iterrows():
        h_url = str(row.get('房东链接') or '').strip()
        h_name = str(row.get('房东姓名') or '').strip()
        if '/users/show/' not in h_url:
            continue
        hid = h_url.split('/users/show/')[1].split('?')[0].strip('/')
        if hid and hid not in seen_hosts:
            seen_hosts.add(hid)
            host_pairs.append((hid, h_name))

    if not host_pairs:
        raise ValueError(f"{homes_file} 中未包含任何有效的房东链接，已中止。")

    logger.info(f'共发现 {len(host_pairs)} 位去重后的房东，开始抓取其全部房源...')
    host_rooms = []
    urls_check = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
        page = context.new_page()

        for hid, name in host_pairs:
            host_url = f'https://www.airbnb.com/users/show/{hid}'
            logger.info(f'正在获取房东 {name}（id-{hid}）的所有房源...')
            try:
                rids = _collect_host_room_ids(page, host_url)
                logger.info(f'房东 {name}（id-{hid}）共发现 {len(rids)} 个房源')
                for rid in rids:
                    url = f'https://www.airbnb.com/rooms/{rid}?check_in={first_day}&check_out={last_day}&locale=en'
                    if url in urls_check:
                        continue
                    urls_check.add(url)
                    time.sleep(0.5)
                    data = get_room_detail(url, page=page)
                    if data:
                        host_rooms.append(data)
                logger.success(f'{name}-{hid} 房东的所有房源已全部抓取完毕')
            except Exception as e:
                logger.error(f'抓取房东 {name}（id-{hid}）失败: {e}')

        browser.close()

    host_rooms = [room for room in host_rooms if room is not None]
    if not host_rooms:
        raise RuntimeError(
            f"未能抓取到任何房东房源数据，已中止导出 {city_name}_host_rooms.xlsx。"
        )

    host_rooms = clean_host_rooms(host_rooms)
    out_file = f'{city_name}_host_rooms.xlsx'
    pd.DataFrame(host_rooms, columns=EXPECTED_COLUMNS).to_excel(out_file, index=False)
    logger.success(f'所有房东房源数据已保存到 {out_file}（共 {len(host_rooms)} 条）')
