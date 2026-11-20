import json
import re
from loguru import logger
import pandas as pd
from jsonpath import jsonpath
from playwright.sync_api import sync_playwright
from price_spider import get_price
from config import city_name

"""
获取所有搜索结果房源信息（基于 Playwright + airbnb.com）
"""

EXPECTED_COLUMNS = [
    "房源名称",
    "房源链接",
    "标题",
    "房客",
    "卧室",
    "床",
    "卫生间",
    "房东描述",
    "房间价格",
    "总价",
    "图片数量",
    "房东链接",
    "房东姓名",
]


def _clean_text(text):
    if not text:
        return ''
    text = text.replace('<br />', ' ').replace('<br/>', ' ').replace('<b>', '').replace('</b>', '').replace('</b', '')
    return re.sub(r'[\x00-\x1F\x7F-\x9F]', '', text).strip()


def _parse_overview_items(items):
    guests, bedrooms, beds, baths = '', '', '', ''
    for item in items:
        low = item.lower()
        if 'guest' in low and not guests:
            guests = item.strip()
        elif ('bedroom' in low or 'studio' in low) and not bedrooms:
            bedrooms = item.strip()
        elif 'bed' in low and 'bedroom' not in low and not beds:
            beds = item.strip()
        elif 'bath' in low and not baths:
            baths = item.strip()
    return guests, bedrooms, beds, baths


def _extract_from_page(page, url, book_it_data):
    # 1. 解析 <script id="data-deferred-state-0">
    json_data = {}
    deferred_loc = page.locator('script#data-deferred-state-0')
    if deferred_loc.count() > 0:
        raw_json = deferred_loc.first.inner_text()
        if raw_json:
            json_data = json.loads(raw_json)

    # 2. 房源名称：优先 DOM h1，兜底 ogDescription / listingTitle
    name = ''
    if page.locator('h1').count() > 0:
        name = _clean_text(page.locator('h1').first.inner_text())
    if not name and json_data:
        titles = jsonpath(json_data, '$..ogDescription') or jsonpath(json_data, '$..listingTitle')
        if titles:
            name = _clean_text(str(titles[0]))

    # 3. 标题（房源类型与位置）：优先 DOM h2，兜底 sharingConfig.propertyType
    title = ''
    if page.locator('h2').count() > 0:
        title = _clean_text(page.locator('h2').first.inner_text())
    if not title and json_data:
        prop_types = jsonpath(json_data, '$..sharingConfig.propertyType') or jsonpath(json_data, '$..sectionData.title')
        if prop_types:
            title = _clean_text(str(prop_types[0]))

    # 4. 房客 / 卧室 / 床 / 卫生间：优先 DOM ol，兜底 sharingConfig
    overview_items = []
    if page.locator('ol').count() > 0:
        ol_text = page.locator('ol').first.inner_text()
        overview_items = [part.strip() for part in re.split(r'[·\n]+', ol_text) if part.strip()]
    guests, bedrooms, beds, baths = _parse_overview_items(overview_items)

    if not guests and json_data:
        cap = jsonpath(json_data, '$..sharingConfig.personCapacity')
        if cap:
            guests = f"{cap[0]} guests"
    if (not bedrooms or not beds or not baths) and json_data:
        sc_title = jsonpath(json_data, '$..sharingConfig.title')
        if sc_title and isinstance(sc_title[0], str):
            parts = [p.strip() for p in sc_title[0].split('·')]
            g2, br2, b2, ba2 = _parse_overview_items(parts)
            guests = guests or g2
            bedrooms = bedrooms or br2
            beds = beds or b2
            baths = baths or ba2

    # 5. 房东描述：从 DESCRIPTION_MODAL 的 htmlDescription 提取
    host_description = ''
    if json_data:
        html_texts = jsonpath(json_data, '$..htmlDescription..htmlText') or jsonpath(json_data, '$..items[*].html.htmlText')
        if html_texts:
            host_description = _clean_text(','.join(str(t) for t in html_texts if t))

    # 6. 图片数量：从 PHOTO_TOUR_SCROLLABLE_MODAL.mediaItems 或 previewImages 提取
    images = 0
    if json_data:
        media_items = jsonpath(json_data, '$..mediaItems')
        if media_items:
            for m in media_items:
                if isinstance(m, list) and len(m) > images:
                    images = len(m)
        if images == 0:
            preview = jsonpath(json_data, '$..previewImages')
            if preview and isinstance(preview[0], list):
                images = len(preview[0])

    # 7. 房东链接
    host_url = ''
    if json_data:
        host_ids = jsonpath(json_data, '$..pdpContext.hostId')
        if host_ids and host_ids[0]:
            host_url = f'https://www.airbnb.com/users/show/{host_ids[0]}'
    if not host_url:
        host_link = page.locator('a[href*="/users/show/"]').first
        if host_link.count() > 0:
            href = host_link.get_attribute('href') or ''
            m = re.search(r'/users/show/(\d+)', href)
            if m:
                host_url = f'https://www.airbnb.com/users/show/{m.group(1)}'

    # 8. 房东姓名
    host_name = ''
    hosted_by = page.locator('text=/^Hosted by /i').first
    if hosted_by.count() > 0:
        host_name = _clean_text(re.sub(r'^Hosted by\s+', '', hosted_by.inner_text(), flags=re.IGNORECASE))
    if not host_name and json_data:
        card_names = jsonpath(json_data, '$..cardData.name')
        if card_names:
            host_name = _clean_text(str(card_names[0]))

    # 9. 价格与总价
    price, total_price = get_price(book_it_data)

    if not name and not host_url:
        return None

    return {
        "房源名称": name,
        "房源链接": url,
        "标题": title,
        "房客": guests,
        "卧室": bedrooms,
        "床": beds,
        "卫生间": baths,
        "房东描述": host_description,
        "房间价格": price,
        "总价": total_price,
        "图片数量": images,
        "房东链接": host_url,
        "房东姓名": host_name,
    }


def get_room_detail(url, page=None):
    own_playwright = None
    own_browser = None
    book_it_holder = {}

    def _on_response(resp):
        if "StaysPdpBookItQuery" in resp.url and resp.status == 200:
            try:
                book_it_holder["data"] = resp.json()
            except Exception:
                pass

    try:
        if page is None:
            own_playwright = sync_playwright().start()
            own_browser = own_playwright.chromium.launch(headless=True)
            context = own_browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
            page = context.new_page()

        page.on("response", _on_response)
        page.goto(url, timeout=60000, wait_until="domcontentloaded")
        try:
            page.wait_for_selector("h1", timeout=15000)
        except Exception:
            pass

        # 等待 StaysPdpBookItQuery 异步价格接口返回（最多 ~4 秒）
        for _ in range(8):
            if "data" in book_it_holder:
                break
            page.wait_for_timeout(500)

        data = _extract_from_page(page, url, book_it_holder.get("data"))
        if data:
            logger.info(data)
        else:
            logger.warning(f"未能提取到有效房源数据: {url}")
        return data
    except Exception as e:
        logger.error(f"抓取异常 {e}  异常链接-{url}")
        return None
    finally:
        if page is not None:
            try:
                page.remove_listener("response", _on_response)
            except Exception:
                pass
        if own_browser is not None:
            own_browser.close()
        if own_playwright is not None:
            own_playwright.stop()


def get_search_rooms():
    try:
        df = pd.read_csv('search_urls.csv')
    except FileNotFoundError:
        raise FileNotFoundError("未找到 search_urls.csv，请先运行第一步 get_search_urls()。")

    if df.empty or 'url' not in df.columns:
        raise ValueError("search_urls.csv 为空或缺少 'url' 列，无法继续抓取房源详情。")

    logger.info(f'开始抓取搜索房源信息（共 {len(df)} 条链接）...')
    homes = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
        page = context.new_page()

        for _, item in df.iterrows():
            url = item['url']
            try:
                data = get_room_detail(url, page=page)
                if data:
                    homes.append(data)
            except Exception as e:
                logger.error(f"处理链接失败 {url}: {e}")

        browser.close()

    if not homes:
        raise RuntimeError(
            f"未能成功抓取到任何房源数据（共尝试 {len(df)} 条链接），已中止导出 {city_name}_homes.xlsx，请检查网络或页面结构。"
        )

    out_file = f'{city_name}_homes.xlsx'
    pd.DataFrame(homes, columns=EXPECTED_COLUMNS).to_excel(out_file, index=False)
    logger.success(f'全部搜索房源信息抓取完成（共 {len(homes)}/{len(df)} 条），结果已保存为 {out_file}')
