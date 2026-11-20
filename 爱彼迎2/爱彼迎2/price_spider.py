import json
from jsonpath import jsonpath
from make_requests import make_requests

"""
获取房源价格
"""
headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'content-type': 'application/json',
    # 'cookie': 'bev=1734961628_EAZmYzMjc3ZjdjZj; everest_cookie=1734961628.EAOTRjZjg0ZGI1NGMxZT.0CLmjDYzzSoS7vN9TVH37meffyYigFZIp7midM33Wmw; cdn_exp_edb50325b473721a8=treatment; cdn_exp_b8ad8bb8bb47fd3f5=control; _ccv=cban%3A0_183215%3D1%2C0_200000%3D1%2C0_183345%3D1%2C0_183243%3D1%2C0_183216%3D1%2C0_179751%3D1%2C0_200003%3D1%2C0_200005%3D1%2C0_179754%3D1%2C0_179750%3D1%2C0_179737%3D1%2C0_179744%3D1%2C0_179739%3D1%2C0_179743%3D1%2C0_179749%3D1%2C0_200012%3D1%2C0_200011%3D1%2C0_183217%3D1%2C0_183219%3D1%2C0_183096%3D1%2C0_179747%3D1%2C0_179740%3D1%2C0_179752%3D1%2C0_183241%3D1%2C0_200007%3D1%2C0_183346%3D1%2C0_183095%3D1%2C0_210000%3D1%2C0_210001%3D1%2C0_210002%3D1%2C0_210003%3D1%2C0_210004%3D1%2C0_210010%3D1%2C0_210012%3D1%2C0_210008%3D1; tzo=480; _user_attributes=%7B%22device_profiling_session_id%22%3A%221734961628--91f0d073264efb54770985cc%22%2C%22giftcard_profiling_session_id%22%3A%221735375538--344710082ce4ee358e1f2b21%22%2C%22reservation_profiling_session_id%22%3A%221735375538--78052d7a2a1088ed0c7943a8%22%2C%22curr%22%3A%22CNY%22%7D; jitney_client_session_id=66a7e128-3d33-482a-ade4-d7027619b06e; jitney_client_session_created_at=1735375712.163; ak_bmsc=2A56412A2442A7CC68531C4361C60401~000000000000000000000000000000~YAAQRQ1x32SZeQeUAQAAcIl/DBoJQ34oVGAdyV3xvWH18OZMoc7jsHA9FnzUbVx3VfxgGiPN/1IhJES0pLlxe6pPPBvibJ+ViTiiDdxoy2d2gGu13k2tz/l4oJ9Bf8iEYtylStBuN3gs2QaoGe5SRqbOL328kqESRjmVDQ8xB83rUR4MawzB/V73rMiX3wS4qVLvUXwD8ADWJHJSuSGhRZJaTRzlbiPdmfAdyZakckRdXce0b2lZ1sx5Bw7P4GERXp1N8djuhfVk6lEjvFfvIZBrpEmEfe1xfIuY7SupyoII9cS9DXTk1DWBDKDKEb2/soCEgf+ThYhibas69aKChKCox4mRCVivozvR65Lfc47Ss3QUBpOKFOapNOFfSPG1RdHaGCQHTr1vAKfkWM0aa1o=; frmfctr=wide; jitney_client_session_updated_at=1735376494.872; _cci=cban%3Aac-1073a097-a73a-4594-b324-8624491db420; previousTab=%7B%22id%22%3A%2205a25fd8-5167-4c6b-b67d-a7069a09bb81%22%7D; cfrmfctr=DESKTOP; cbkp=3; bm_sv=ADB7984270F5C6A694BAA65FBA4B322B~YAAQRQ1x3wHdeQeUAQAAHlqKDBo4DsKdAiM6qvxQymmyDspw07BL4mNvF96o+jZOThPqYMxxMX4cF0iidwFlf31edK3gG5WNIpCSFqr3Cpa2CoxrF7k55g/FDxKa1uTKXKmKqHjc2RWXMHykCuE0AauDOLTc3B7fpa3gbxYkSSjkRozq4vKNxA0sqYNTXC0WGSZicdOfxv5WGOnBG1wo8KmnIor91F/NauFd7+xWl1Dk5jzD4t18Uy+bwVc5yNM5~1; OptanonConsent=0_183215:1,0_200000:1,0_183345:1,0_183243:1,0_183216:1,0_179751:1,0_200003:1,0_200005:1,0_179754:1,0_179750:1,0_179737:1,0_179744:1,0_179739:1,0_179743:1,0_179749:1,0_200012:1,0_200011:1,0_183217:1,0_183219:1,0_183096:1,0_179747:1,0_179740:1,0_179752:1,0_183241:1,0_200007:1,0_183346:1,0_183095:1,0_210000:1,0_210001:1,0_210002:1,0_210003:1,0_210004:1,0_210010:1,0_210012:1,0_210008:1',
    'device-memory': '8',
    'dpr': '2',
    'ect': '4g',
    'priority': 'u=1, i',
    'referer': 'https://www.airbnb.cn/rooms/1193739414449637570?check_in=2025-01-01&check_out=2025-01-02&source_impression_id=p3_1735376494_P3wHIKRpVYcFE-Fo',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-ch-ua-platform-version': '"6.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'viewport-width': '1129',
    'x-airbnb-api-key': 'd306zoyjsyarp7ifhu67rjxn52tv0t20',
    'x-airbnb-enable-cn-personalization': 'true',
    'x-airbnb-graphql-platform': 'web',
    'x-airbnb-graphql-platform-client': 'minimalist-niobe',
    'x-airbnb-supports-airlock-v2': 'true',
    'x-client-request-id': '0um2to218yzslj03idlmb18nz2fu',
    'x-client-version': 'b86b3c5d47fd2c1b12d53e2f5a03f7300e379026',
    'x-csrf-token': '',
    'x-csrf-without-token': '1',
    'x-niobe-short-circuited': 'true',
}


def get_price(variables):
    variables['pdpSectionsRequest']['sectionIds'] = [
        "BOOK_IT_CALENDAR_SHEET",
        "POLICIES_DEFAULT",
        "BOOK_IT_SIDEBAR",
        "URGENCY_COMMITMENT_SIDEBAR",
        "BOOK_IT_NAV",
        "BOOK_IT_FLOATING_FOOTER",
        "EDUCATION_FOOTER_BANNER",
        "URGENCY_COMMITMENT",
        "CANCELLATION_POLICY_PICKER_MODAL",
        "EDUCATION_FOOTER_BANNER_MODAL"
    ]
    variables = json.dumps(variables).replace('None', 'null').replace('False', 'false')
    params = {
        'operationName': 'StaysPdpSections',
        'locale': 'zh-CN',
        'currency': 'CNY',
        'variables': variables,
        'extensions': '{"persistedQuery":{"version":1,"sha256Hash":"1e689969d9dbfde862a75be9cff6368cfe29857bf5644add79a67557149118a2"}}',
    }

    response = make_requests(
        'https://www.airbnb.cn/api/v3/StaysPdpSections/1e689969d9dbfde862a75be9cff6368cfe29857bf5644add79a67557149118a2',
        params=params,
        headers=headers,
    )
    json_data = response.json()
    price = jsonpath(json_data, "$..price")[0]
    # 总价
    total_price = jsonpath(json_data, "$..items..priceString")[-1]

    return price, total_price
