#
import csv
import time
from loguru import logger
import pandas as pd
import requests
from make_requests import make_requests
from config import city_name, first_day, last_day

"""获取所有搜索结果房源详情链接"""

headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'content-type': 'application/json',
    'device-memory': '8',
    'dpr': '1',
    'ect': '4g',
    'origin': 'https://www.airbnb.cn',
    'priority': 'u=1, i',
    'referer': 'https://www.airbnb.cn/s/%E8%83%A1%E5%BF%97%E6%98%8E%E5%B8%82/homes?refinement_paths%5B%5D=%2Fhomes&flexible_trip_lengths%5B%5D=one_week&monthly_start_date=2025-01-01&monthly_length=3&monthly_end_date=2025-04-01&price_filter_input_type=0&channel=EXPLORE&query=%E8%83%A1%E5%BF%97%E6%98%8E%E5%B8%82&date_picker_type=calendar&checkin=2025-01-01&checkout=2025-01-02&source=structured_search_input_header&search_type=filter_change&search_mode=regular_search&price_filter_num_nights=1&l2_property_type_ids%5B%5D=3&selected_filter_order%5B%5D=l2_property_type_ids%3A3&selected_filter_order%5B%5D=room_types%3AEntire%20home%2Fapt&update_selected_filters=true&room_types%5B%5D=Entire%20home%2Fapt&zoom_level=10&place_id=ChIJ0T2NLikpdTERKxE8d61aX_E&tab_id=home_tab&federated_search_session_id=58b88087-f620-4300-aa40-cce8cff5e670&cursor=eyJzZWN0aW9uX29mZnNldCI6MCwiaXRlbXNfb2Zmc2V0IjoxOCwidmVyc2lvbiI6MX0%3D',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'viewport-width': '546',
    'x-airbnb-api-key': 'd306zoyjsyarp7ifhu67rjxn52tv0t20',
    'x-airbnb-enable-cn-personalization': 'true',
    'x-airbnb-graphql-platform': 'web',
    'x-airbnb-graphql-platform-client': 'minimalist-niobe',
    'x-airbnb-supports-airlock-v2': 'true',
    'x-csrf-token': '',
    'x-csrf-without-token': '1',
    'x-niobe-short-circuited': 'true',
}
params = {
    'operationName': 'StaysSearch',
    'locale': 'zh-CN',
    'currency': 'CNY',
}
json_data = {
    'operationName': 'StaysSearch',
    'variables': {
        'staysSearchRequest': {
            'maxMapItems': 9999,
            'requestedPageType': 'STAYS_SEARCH',
            'metadataOnly': False,
            'treatmentFlags': [
                'feed_map_decouple_m11_treatment',
                'stays_search_rehydration_treatment_desktop',
                'stays_search_rehydration_treatment_moweb',
                'm1_2024_monthly_stays_dial_treatment_flag',
                'recommended_amenities_2024_treatment_b',
                'filter_redesign_2024_treatment',
                'filter_reordering_2024_roomtype_treatment',
                'recommended_filters_v2_2024_treatment',
                'recommended_filters_2024_treatment_b',
                'selected_filters_2024_treatment',
            ],
            'source': 'structured_search_input_header',
            'searchType': 'filter_change',
            'rawParams': [
                {
                    'filterName': 'categoryBarCacheId',
                    'filterValues': [
                        'Njc3LDg2NzgsODUzNiw1NjM1LDg2NjEsODE0NCw3ODksNDEwNCw4NjU4LDgxMTUsODE3NSw4NTM4LDg1MjIsODEwMiw3NzY5LDg1MjU=',
                    ],
                },
                {
                    'filterName': 'cdnCacheSafe',
                    'filterValues': [
                        'false',
                    ],
                },
                {
                    'filterName': 'channel',
                    'filterValues': [
                        'EXPLORE',
                    ],
                },
                {
                    'filterName': 'checkin',
                    'filterValues': [
                        f'{first_day}',
                    ],
                },
                {
                    'filterName': 'checkout',
                    'filterValues': [
                        f'{last_day}',
                    ],
                },
                {
                    'filterName': 'datePickerType',
                    'filterValues': [
                        'calendar',
                    ],
                },
                {
                    'filterName': 'federatedSearchSessionId',
                    'filterValues': [
                        '58b88087-f620-4300-aa40-cce8cff5e670',
                    ],
                },
                {
                    'filterName': 'flexibleTripLengths',
                    'filterValues': [
                        'one_week',
                    ],
                },
                {
                    'filterName': 'itemsPerGrid',
                    'filterValues': [
                        '18',
                    ],
                },
                {
                    'filterName': 'l2PropertyTypeIds',
                    'filterValues': [
                        '3',
                    ],
                },
                {
                    'filterName': 'monthlyEndDate',
                    'filterValues': [
                        '2025-04-01',
                    ],
                },
                {
                    'filterName': 'monthlyLength',
                    'filterValues': [
                        '3',
                    ],
                },
                {
                    'filterName': 'monthlyStartDate',
                    'filterValues': [
                        '2025-01-01',
                    ],
                },
                {
                    'filterName': 'priceFilterInputType',
                    'filterValues': [
                        '0',
                    ],
                },
                {
                    'filterName': 'priceFilterNumNights',
                    'filterValues': [
                        '1',
                    ],
                },
                {
                    'filterName': 'query',
                    'filterValues': [
                        f'{city_name}',
                    ],
                },
                {
                    'filterName': 'refinementPaths',
                    'filterValues': [
                        '/homes',
                    ],
                },
                {
                    'filterName': 'roomTypes',
                    'filterValues': [
                        'Entire home/apt',
                    ],
                },
                {
                    'filterName': 'screenSize',
                    'filterValues': [
                        'large',
                    ],
                },
                {
                    'filterName': 'searchMode',
                    'filterValues': [
                        'regular_search',
                    ],
                },
                {
                    'filterName': 'selectedFilterOrder',
                    'filterValues': [
                        'l2_property_type_ids:3',
                        'room_types:Entire home/apt',
                    ],
                },
                {
                    'filterName': 'tabId',
                    'filterValues': [
                        'home_tab',
                    ],
                },
                {
                    'filterName': 'updateSelectedFilters',
                    'filterValues': [
                        'true',
                    ],
                },
                {
                    'filterName': 'version',
                    'filterValues': [
                        '1.8.3',
                    ],
                },
                {
                    'filterName': 'zoomLevel',
                    'filterValues': [
                        '10',
                    ],
                },
            ],
        },
        'isLeanTreatment': False,
        'includeLegacyListingCardFieldsForSxS': False,
        'includeDemandStayListing': False,
        'includeDemandStayListingFieldsErf1': False,
        'includeDemandStayListingFieldsErf2': False,
        'includeDemandStayListingFieldsErf3': False,
        'includeDemandStayListingFieldsErf4': False,
    },
    'extensions': {
        'persistedQuery': {
            'version': 1,
            'sha256Hash': '32d7d7860cd65552b503305587f1ffab3606db4120b08c3b7696e8a6091be76e',
        },
    },
}


def get_search_urls(num):
    logger.info('开始抓取搜索列表...')
    urls = []
    for i in range(num):
        logger.info('第{}次抓取数据...'.format(i + 1))
        for _ in range(17):
            logger.info('正在抓取搜索列表第{}页的内容...'.format(_ + 1))
            time.sleep(2)
            response = make_requests(
                'https://www.airbnb.cn/api/v3/StaysSearch/32d7d7860cd65552b503305587f1ffab3606db4120b08c3b7696e8a6091be76e',
                params=params,
                headers=headers,
                json=json_data,
                method='POST',
            )
            items = response.json()["data"]["presentation"]["staysSearch"]["results"]["searchResults"]

            for item in items:
                id = item["listing"]["id"]
                if id:
                    url = f'https://www.airbnb.cn/rooms/{id}?check_in={first_day}&check_out={last_day}&locale=en'
                    urls.append({'url': url})
                    print(url)

            next_page = response.json()["data"]["presentation"]["staysSearch"]["results"]["paginationInfo"][
                "nextPageCursor"]

            json_data["variables"]["staysSearchRequest"]["cursor"] = next_page
    #
    logger.success('搜索列表抓取结束')
    # 对字典列表的进行去重
    logger.info('去重前房源搜索结果总长度：{}'.format(len(urls)))
    #
    # 使用字典去重
    urls = {d['url']: d for d in urls}.values()
    urls = list(urls)
    # 去重后
    logger.info('去重后房源搜索结果总长度：{}'.format(len(urls)))
    filename = 'search_urls.csv'
    pd.DataFrame(urls).to_csv(filename, index=False)
    logger.info(f'去重结果已经写入{filename}文件')
