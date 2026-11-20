import re
from jsonpath import jsonpath

"""
获取房源价格（从 Playwright 拦截到的 StaysPdpBookItQuery JSON 中提取）
"""


def get_price(book_it_data):
    """从 StaysPdpBookItQuery 响应 JSON 中提取每晚价格与总价。

    返回: (price, total_price) 元组，无法获取时返回 ('', '')。
    """
    if not book_it_data or not isinstance(book_it_data, dict):
        return '', ''

    price = ''
    total_price = ''

    # 1. 提取总价：优先从 primaryLine 获取 discountedPrice / price / originalPrice
    primary_lines = jsonpath(book_it_data, '$..structuredDisplayPrice.primaryLine') or []
    if primary_lines and isinstance(primary_lines[0], dict):
        pl = primary_lines[0]
        total_price = pl.get('discountedPrice') or pl.get('price') or pl.get('originalPrice') or ''

    # 2. 提取每晚单价：从 priceDetails 的 description（如 "4 nights x ₫3,955,655"）提取
    descriptions = jsonpath(book_it_data, '$..explanationData..items[*].description') or []
    for desc in descriptions:
        if isinstance(desc, str):
            m = re.search(r'\d+\s+nights?\s*x\s*([^\s]+)', desc, re.IGNORECASE)
            if m:
                price = m.group(1).strip()
                break

    # 3. 兜底：若 priceDetails 无总价，取最后一个 priceString
    if not total_price:
        price_strings = jsonpath(book_it_data, '$..items..priceString') or []
        if price_strings:
            total_price = price_strings[-1]

    if not price and total_price:
        price = total_price

    if isinstance(price, str) and '__typename' in price:
        price = ''

    return str(price or ''), str(total_price or '')
