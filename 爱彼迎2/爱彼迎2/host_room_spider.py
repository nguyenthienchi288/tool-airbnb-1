import re
import time
from loguru import logger
import pandas as pd
import requests
from make_requests import make_requests
from config import first_day, last_day, city_name
from search_detail_spider import get_room_detail

"""
获取所有房东的所有房源
"""
headers = {
    'accept': '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'content-type': 'application/json',
    # 'cookie': 'bev=1734961628_EAZmYzMjc3ZjdjZj; everest_cookie=1734961628.EAOTRjZjg0ZGI1NGMxZT.0CLmjDYzzSoS7vN9TVH37meffyYigFZIp7midM33Wmw; cdn_exp_edb50325b473721a8=treatment; cdn_exp_b8ad8bb8bb47fd3f5=control; _ccv=cban%3A0_183215%3D1%2C0_200000%3D1%2C0_183345%3D1%2C0_183243%3D1%2C0_183216%3D1%2C0_179751%3D1%2C0_200003%3D1%2C0_200005%3D1%2C0_179754%3D1%2C0_179750%3D1%2C0_179737%3D1%2C0_179744%3D1%2C0_179739%3D1%2C0_179743%3D1%2C0_179749%3D1%2C0_200012%3D1%2C0_200011%3D1%2C0_183217%3D1%2C0_183219%3D1%2C0_183096%3D1%2C0_179747%3D1%2C0_179740%3D1%2C0_179752%3D1%2C0_183241%3D1%2C0_200007%3D1%2C0_183346%3D1%2C0_183095%3D1%2C0_210000%3D1%2C0_210001%3D1%2C0_210002%3D1%2C0_210003%3D1%2C0_210004%3D1%2C0_210010%3D1%2C0_210012%3D1%2C0_210008%3D1; tzo=480; _user_attributes=%7B%22device_profiling_session_id%22%3A%221734961628--91f0d073264efb54770985cc%22%2C%22giftcard_profiling_session_id%22%3A%221735738686--ac57a74aeba114576c6969f4%22%2C%22reservation_profiling_session_id%22%3A%221735738686--234c2c6a489ff8e1e8425689%22%2C%22curr%22%3A%22CNY%22%7D; ak_bmsc=8069BA016E38650D024191C4A82FDD01~000000000000000000000000000000~YAAQJw1x3wDYTQSUAQAAf4sWIhqXuabzgiFvLMnygphMeT0alXbrycyFlmF7NZ4U2af2VOx8s5FaEphDuwx966uDz6ut5NadoXJ08XSjI9A53zqQqkQzE+iC7e0eKH2LLbbKKLgs2o2b+R0YZfakH0nYMWjg+wklkoNIgw8soH56Hi5IMMxv+pgEHUMUgfHK5kVvQJUPKGJkBv5j7WFEfCh/fhRHnW9T0hXK4JOEO0aa/YgYOJyQngkBLVCNuBHTtKorbE6r17HYtEvOOfCOijwTR3ZmfBjRP392DJN0jy4+GwUxiosDEIW8QsPc4Nb9tqjEfW9g49+EiVkvunCqeSJdHN4vYVnOaqX/9oMh1s2aL1Rgh9tXm6caFpkcsncEhwGQTg9GLMaV7w==; previousTab=%7B%22id%22%3A%2244703d78-b2e5-4f27-bd49-0d3e774a0c2e%22%7D; frmfctr=wide; OptanonConsent=0_179750%3A1%2C0_183095%3A1%2C0_183241%3A1%2C0_179754%3A1%2C0_183346%3A1%2C0_200000%3A1%2C0_210000%3A1%2C0_210010%3A1%2C0_183215%3A1%2C0_210004%3A1%2C0_179737%3A1%2C0_179752%3A1%2C0_179751%3A1%2C0_179749%3A1%2C0_200007%3A1%2C0_210001%3A1%2C0_200005%3A1%2C0_179740%3A1%2C0_179743%3A1%2C0_179744%3A1%2C0_210008%3A1%2C0_183243%3A1%2C0_183096%3A1%2C0_179747%3A1%2C0_183216%3A1%2C0_200012%3A1%2C0_183219%3A1%2C0_200003%3A1%2C0_179739%3A1%2C0_210012%3A1%2C0_210002%3A1%2C0_183217%3A1%2C0_183345%3A1%2C0_210003%3A1%2C0_200011%3A1; _cci=cban%3Aac-b069e2e4-b2ff-46eb-af85-1f32437410af; jitney_client_session_id=4f2120e1-c537-47b4-9d0a-12fafeb21c77; jitney_client_session_created_at=1735738692.655; jitney_client_session_updated_at=1735738692.655; bm_sv=CC74FE27C8ABBF36680ABDA1C25ED224~YAAQJw1x32fYTQSUAQAAqpcWIhpnqe2c83n0r++XA5+nmVVKwPxqF1k7OhUQb1w1s1T/XCUHf+1bQnIQy1jXlfr/LOYvRwKt2JRu8/BTvYIdS7wl6Zg9mNTLHLuH3nsspSTAZJIlPe7wu1oRf3brjRk8K/5mLi85y/oecIQNUN2f64YrptMFuh9CiU6RGT3JII1dgjqvn7cD+D2OUVdSnS66oE3U7MfVW9L2/Z6CRg5E5pMFD2FWLL+yCWuV5g0=~1; cfrmfctr=MOBILE; cbkp=2',
    'device-memory': '8',
    'dpr': '1',
    'ect': '4g',
    'priority': 'u=1, i',
    'referer': 'https://www.airbnb.cn/users/show/465879364',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'viewport-width': '879',
    'x-airbnb-api-key': 'd306zoyjsyarp7ifhu67rjxn52tv0t20',
    'x-airbnb-enable-cn-personalization': 'true',
    'x-airbnb-graphql-platform': 'web',
    'x-airbnb-graphql-platform-client': 'minimalist-niobe',
    'x-airbnb-supports-airlock-v2': 'true',
    'x-client-request-id': '0jk794b1fd68vr0nu64n80xef48n',
    'x-client-version': 'b86b3c5d47fd2c1b12d53e2f5a03f7300e379026',
    'x-csrf-token': '',
    'x-csrf-without-token': '1',
    'x-niobe-short-circuited': 'true',
}
def clean_string(s):
    """清理字符串中的非法字符"""
    return re.sub(r'[^\x20-\x7E]', '', s)  # 只保留可打印的 ASCII 字符

def clean_host_rooms(rooms):
    """清理房间列表中的所有字典数据"""
    for room in rooms:
        for key, value in room.items():
            if isinstance(value, str):
                room[key] = clean_string(value)  # 清理字符串
            elif value is None:
                room[key] = ''  # 将 None 值替换为空字符串
    return rooms


def get_host_rooms():
    df = pd.read_excel(f'{city_name}_homes.xlsx')
    hids = df['房东链接'].tolist()
    names = df['房东姓名'].tolist()
    host_rooms = []
    urls_check = []
    for hid, name in zip(hids, names):

        hid = hid.split('/users/show/')[1]
        logger.info(f'正在获取房东{name}（id-{hid}） 房东的所有房源...')
        try:
            params = {
                'operationName': 'UserProfileBeehiveListingQuery',
                'locale': 'en',
                'currency': 'CNY',
                'variables': f'{{"userId":"{hid}","limit":12,"offset":0}}',
                'extensions': '{"persistedQuery":{"version":1,"sha256Hash":"529ca816b8be0619618d48b31bf46c379543e297fd68c0a953922927e5497b43"}}',
            }

            check = True
            num = 0
            while check:
                time.sleep(0.5)
                params['variables'] = f'{{"userId":"{hid}","limit":12,"offset":{num * 12}}}'
                response_ = make_requests(
                    'https://www.airbnb.cn/api/v3/UserProfileBeehiveListingQuery/529ca816b8be0619618d48b31bf46c379543e297fd68c0a953922927e5497b43',
                    params=params,
                    headers=headers,
                )
                check = items = response_.json()['data']['beehive']['getListOfListings']['listings']
                for item in items:

                    try:
                        time.sleep(0.5)  # 延时
                        rid = item['id']
                        url = f'https://www.airbnb.cn/rooms/{rid}?check_in={first_day}&check_out={last_day}&locale=en'

                        # 如果当前url不在
                        if url not in urls_check:
                            data = get_room_detail(url)
                            urls_check.append(url)
                            if data:
                                host_rooms.append(data)
                    except Exception as e:
                        logger.error(e)
                num += 1
            logger.success(f'{name}-{hid} 房东的所有房源已全部抓取完毕... （注意 所有房东房源抓取结束前 如有打开host_rooms.xlsx 请关闭该文件）')

        except Exception as e:
            logger.error(e)
    host_rooms = [room for room in host_rooms if room is not None]
    # 清理 host_rooms 数据
    host_rooms = clean_host_rooms(host_rooms)
    try:
        pd.DataFrame(host_rooms).to_excel(f'{city_name}_host_rooms.xlsx')
        logger.success(f'所有房东房源数据 已保存到{city_name}_host_rooms.xlsx')
    except Exception as e:
        logger.error(f'数据保存失败-{e}')

