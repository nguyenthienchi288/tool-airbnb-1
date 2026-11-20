#
import requests


headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'content-type': 'application/json',
    # 'cookie': 'bev=1734961628_EAZmYzMjc3ZjdjZj; everest_cookie=1734961628.EAOTRjZjg0ZGI1NGMxZT.0CLmjDYzzSoS7vN9TVH37meffyYigFZIp7midM33Wmw; cdn_exp_edb50325b473721a8=treatment; cdn_exp_b8ad8bb8bb47fd3f5=control; _ccv=cban%3A0_183215%3D1%2C0_200000%3D1%2C0_183345%3D1%2C0_183243%3D1%2C0_183216%3D1%2C0_179751%3D1%2C0_200003%3D1%2C0_200005%3D1%2C0_179754%3D1%2C0_179750%3D1%2C0_179737%3D1%2C0_179744%3D1%2C0_179739%3D1%2C0_179743%3D1%2C0_179749%3D1%2C0_200012%3D1%2C0_200011%3D1%2C0_183217%3D1%2C0_183219%3D1%2C0_183096%3D1%2C0_179747%3D1%2C0_179740%3D1%2C0_179752%3D1%2C0_183241%3D1%2C0_200007%3D1%2C0_183346%3D1%2C0_183095%3D1%2C0_210000%3D1%2C0_210001%3D1%2C0_210002%3D1%2C0_210003%3D1%2C0_210004%3D1%2C0_210010%3D1%2C0_210012%3D1%2C0_210008%3D1; tzo=480; _airbed_session_id=0698ae7834600fcc018ab6d1af29f96b; _user_attributes=%7B%22device_profiling_session_id%22%3A%221734961628--91f0d073264efb54770985cc%22%2C%22giftcard_profiling_session_id%22%3A%221736163122--d7c4a5c4c3d14d5795f25e59%22%2C%22reservation_profiling_session_id%22%3A%221736163122--0fdb39f1d1d45b644c6bbd4e%22%2C%22curr%22%3A%22CNY%22%7D; jitney_client_session_id=2c796a11-e618-42ca-b419-1c72ddca1263; jitney_client_session_created_at=1736163129.651; ak_bmsc=BC5E783DB425E47758D641C4AFA50EF5~000000000000000000000000000000~YAAQLw1x3yKZFzqUAQAASVRnOxoqTWP7EFBQGxGue4tBrVvMAgWD/9D66Qga+2ltgVYoFGl/IYSHez7+Tc915fKHLwbKIQFXauzZLxdwqS/XrUd2c/B4B9Sa3iQFgmwZF+KTdwzm5TQQHv0SLLcB/iBf/GmPXGL4rRgc9nZjvuDTVAAZtIY+t8GICjsI6qpkrTPn3haSuGhwnRholZCoShoIy0wHHTektPOjfOvsGbsWgfPw96yR+27kYvZdSC++zf+KdOBSh3VOp0pEMQ7jIBGOLejIBxnzo75tOF4FEyxyu6ZxU0YCO+1L9m0NTMseZL/jTUhcT2dQWDqXlngB0KcJ6Hu0EMXwPMPpWyR04jWizCJ703goo/QUcpRPdM/W6eCKfW5k2Cd1o2xvvAel09Y=; OptanonConsent=0_179750%3A1%2C0_183095%3A1%2C0_183241%3A1%2C0_179754%3A1%2C0_183346%3A1%2C0_200000%3A1%2C0_210000%3A1%2C0_210010%3A1%2C0_183215%3A1%2C0_210004%3A1%2C0_179737%3A1%2C0_179752%3A1%2C0_179751%3A1%2C0_179749%3A1%2C0_200007%3A1%2C0_210001%3A1%2C0_200005%3A1%2C0_179740%3A1%2C0_179743%3A1%2C0_179744%3A1%2C0_210008%3A1%2C0_183243%3A1%2C0_183096%3A1%2C0_179747%3A1%2C0_183216%3A1%2C0_200012%3A1%2C0_183219%3A1%2C0_200003%3A1%2C0_179739%3A1%2C0_210012%3A1%2C0_210002%3A1%2C0_183217%3A1%2C0_183345%3A1%2C0_210003%3A1%2C0_200011%3A1; _cci=cban%3Aac-08f85778-4776-4eea-8801-ff8890d645b2; previousTab=%7B%22id%22%3A%223ac9682b-9bac-4641-a255-4efbbf6a3179%22%7D; frmfctr=wide; cfrmfctr=DESKTOP; cbkp=3; jitney_client_session_updated_at=1736164212.336; bm_sv=695CA6EB0BA6684539D06AB1424ACAF1~YAAQJw1x38I80QSUAQAA1qtzOxqni0BMAsX5yAG8cI8FFwfelQWOL1XH3M5PxUuUYtbQ64OcBH3UoaZ1yfA6fgvJTYchSXFW6VIYnH6y3d551WLEn9Mm2syokE7vR6P5Xu4LYielHVlqw4dj67fHO7dRSUJ90x2AIbQyFc30s9A/MHS6I+shhjnCu80+w3YzyctLZS3XSt1bEqmAshejoREQvXw1aLWGskR465ah3P9PkpT6648ghLKrP9L+mUld~1',
    'device-memory': '8',
    'dpr': '2',
    'ect': '4g',
    'origin': 'https://www.airbnb.cn',
    'priority': 'u=1, i',
    'referer': 'https://www.airbnb.cn/s/%E6%B2%B3%E5%86%85%E5%B8%82/homes?flexible_trip_lengths%5B%5D=one_week&monthly_start_date=2025-02-01&monthly_length=3&monthly_end_date=2025-05-01&query=%E6%B2%B3%E5%86%85%E5%B8%82&refinement_paths%5B%5D=%2Fhomes&date_picker_type=calendar&source=structured_search_input_header&search_type=autocomplete_click&price_filter_input_type=0&price_filter_num_nights=35&channel=EXPLORE&checkin=2025-02-01&checkout=2025-03-08&location_bb=QahnLkLT0lxBp%2FX3QtOVqQ%3D%3D',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-ch-ua-platform-version': '"6.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'viewport-width': '1164',
    'x-airbnb-api-key': 'd306zoyjsyarp7ifhu67rjxn52tv0t20',
    'x-airbnb-enable-cn-personalization': 'true',
    'x-airbnb-graphql-platform': 'web',
    'x-airbnb-graphql-platform-client': 'minimalist-niobe',
    'x-airbnb-supports-airlock-v2': 'true',
    'x-client-request-id': '155dblc1r5txgz0og0rgn1gieodj',
    'x-client-version': 'b86b3c5d47fd2c1b12d53e2f5a03f7300e379026',
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
            'searchType': 'autocomplete_click',
            'rawParams': [
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
                        '2025-02-01',
                    ],
                },
                {
                    'filterName': 'checkout',
                    'filterValues': [
                        '2025-03-08',
                    ],
                },
                {
                    'filterName': 'datePickerType',
                    'filterValues': [
                        'calendar',
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
                    'filterName': 'monthlyEndDate',
                    'filterValues': [
                        '2025-05-01',
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
                        '2025-02-01',
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
                        '35',
                    ],
                },
                {
                    'filterName': 'query',
                    'filterValues': [
                        '胡志明市',
                    ],
                },
                {
                    'filterName': 'refinementPaths',
                    'filterValues': [
                        '/homes',
                    ],
                },
                {
                    'filterName': 'screenSize',
                    'filterValues': [
                        'large',
                    ],
                },
                {
                    'filterName': 'tabId',
                    'filterValues': [
                        'home_tab',
                    ],
                },
                {
                    'filterName': 'version',
                    'filterValues': [
                        '1.8.3',
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

response = requests.post(
    'https://www.airbnb.cn/api/v3/StaysSearch/32d7d7860cd65552b503305587f1ffab3606db4120b08c3b7696e8a6091be76e',
    params=params,
    headers=headers,
    json=json_data,
)

print(response.json())