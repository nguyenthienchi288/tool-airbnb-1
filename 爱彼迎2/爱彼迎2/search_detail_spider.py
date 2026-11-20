import json
import re

from loguru import logger
import pandas as pd
import requests
from jsonpath import jsonpath
from lxml import etree
from price_spider import get_price
from make_requests import make_requests
from config import city_name

"""
获取所有搜索结果 房源信息
"""
headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'zh-CN,zh;q=0.9',
    'cache-control': 'max-age=0',
    # 'cookie': 'bev=1734961628_EAZmYzMjc3ZjdjZj; everest_cookie=1734961628.EAOTRjZjg0ZGI1NGMxZT.0CLmjDYzzSoS7vN9TVH37meffyYigFZIp7midM33Wmw; cdn_exp_edb50325b473721a8=treatment; cdn_exp_b8ad8bb8bb47fd3f5=control; _ccv=cban%3A0_183215%3D1%2C0_200000%3D1%2C0_183345%3D1%2C0_183243%3D1%2C0_183216%3D1%2C0_179751%3D1%2C0_200003%3D1%2C0_200005%3D1%2C0_179754%3D1%2C0_179750%3D1%2C0_179737%3D1%2C0_179744%3D1%2C0_179739%3D1%2C0_179743%3D1%2C0_179749%3D1%2C0_200012%3D1%2C0_200011%3D1%2C0_183217%3D1%2C0_183219%3D1%2C0_183096%3D1%2C0_179747%3D1%2C0_179740%3D1%2C0_179752%3D1%2C0_183241%3D1%2C0_200007%3D1%2C0_183346%3D1%2C0_183095%3D1%2C0_210000%3D1%2C0_210001%3D1%2C0_210002%3D1%2C0_210003%3D1%2C0_210004%3D1%2C0_210010%3D1%2C0_210012%3D1%2C0_210008%3D1; tzo=480; _user_attributes=%7B%22device_profiling_session_id%22%3A%221734961628--91f0d073264efb54770985cc%22%2C%22giftcard_profiling_session_id%22%3A%221735366468--01df393f43f029b79ffc5efb%22%2C%22reservation_profiling_session_id%22%3A%221735366468--c1cb1a2d6780cc4fce80702f%22%2C%22curr%22%3A%22CNY%22%7D; jitney_client_session_id=4f42a784-0411-4496-95ca-742bad606a82; jitney_client_session_created_at=1735365818.991; ak_bmsc=73A8C58CBA2CFCC609F8F762B38ADC86~000000000000000000000000000000~YAAQVQ1x34brYQeUAQAACuj6Cxrgq3UBZA0BV5EO/TBMN+BD/aaYGflHHnI8cM4ZukuaxxTxxp3D5kd9EgfA3fVUGIXFaMkj+CPosRtUYJDzbzaEb2KicOxRNrxxdR3ntYuYM7A4R/TCseMkoKecl1ETO6q0jzGZuwQ2nus+Eqibu4/wHWxaw30BVLFBZwRaGr5DHp26fjxJsYba94gwkSjFlkm/vRWv93amcNn9MAo1PrGHrg1TQfkz+qnarcYjTd4slqEwruBi9MXvcuzO5Jxf3ze/wNf8HIMgxaz5UA+weeWZbHWWsRX3qkk8jeQ1cPWlqMdLMILUDgmaMkKicq3i8F9yTWNKmf1cVRRiGB7YxEG0rB0lC93RDN1zD8gUe+oje+nvmKLjXMM5ok3DnQc=; frmfctr=wide; previousTab=%7B%22id%22%3A%2204318832-48cc-42dc-a995-2e3fbf8293f2%22%7D; jitney_client_session_updated_at=1735367465.599; OptanonConsent=0_179750%3A1%2C0_183095%3A1%2C0_183241%3A1%2C0_179754%3A1%2C0_183346%3A1%2C0_200000%3A1%2C0_210000%3A1%2C0_210010%3A1%2C0_183215%3A1%2C0_210004%3A1%2C0_179737%3A1%2C0_179752%3A1%2C0_179751%3A1%2C0_179749%3A1%2C0_200007%3A1%2C0_210001%3A1%2C0_200005%3A1%2C0_179740%3A1%2C0_179743%3A1%2C0_179744%3A1%2C0_210008%3A1%2C0_183243%3A1%2C0_183096%3A1%2C0_179747%3A1%2C0_183216%3A1%2C0_200012%3A1%2C0_183219%3A1%2C0_200003%3A1%2C0_179739%3A1%2C0_210012%3A1%2C0_210002%3A1%2C0_183217%3A1%2C0_183345%3A1%2C0_210003%3A1%2C0_200011%3A1; _cci=cban%3Aac-c09f911c-cde9-4eb4-a42d-fb15bcbebe86; cfrmfctr=DESKTOP; cbkp=3; bm_sv=F134673E81B88DE7A978168E5F353630~YAAQHFCcJAT51LOTAQAAeDoADBqzhtEfdXdqgByNSFrHJfRymPQx02HaonzwEDEjZ+RZVwZTDzhFFdNAY2Dggej5IR2/TYfkTqJaCnNQwGZ+GeRmlN5fpjBGgD08AGV30h6Wz+oburklOf/YsGvKbSv/nPEPgiY+HtC5XUs5YuNsQEkkr5yc5RnmyeOUAZ0IewovKHyei2ujHJDVGieDb5acoTcuXZiVg84FaivcGfZis3AYKgf04zCRcqk2Fi8E~1',
    'device-memory': '8',
    'dpr': '1',
    'ect': '4g',
    'priority': 'u=0, i',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-ch-ua-platform-version': '"6.0"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'viewport-width': '1021',
}


def get_room_detail(url):
    try:
        response = make_requests(url=url, headers=headers)  # &local=en
        page = etree.HTML(response.text)

        json_data = json.loads(''.join(page.xpath('//script[@id="data-deferred-state-0"]/text()')))
        # 房源名称
        name = jsonpath(json_data, '$..listingTitle')[0]
        # 标题
        title = jsonpath(json_data, '$..sectionData.title')[0]
        # 描述
        description = jsonpath(json_data, '$..sbuiData..sectionData..overviewItems..title')[:4]
        # 图片数量
        images = len(jsonpath(json_data, '$..previewImages')[0])

        guests, bedrooms, beds, baths = '', '', '', ''
        for j in description:
            if 'guest' in j:  # 房客
                guests = j
            elif 'bedroom' in j:  # 卧室
                bedrooms = j
            elif 'bed' in j:  # 床
                beds = j
            elif 'bath' in j:  # 卫生间
                baths = j

        # 房东描述
        host_description = ','.join(jsonpath(json_data, '$..htmlDescription..htmlText')).replace('<br />', '').replace(
            '<b>', '').replace('</b', '')
        host_description = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', host_description)
        # 房东链接
        host_url = 'https://www.airbnb.cn/users/show/' + jsonpath(json_data, '$..pdpContext.hostId')[0]
        # 房东姓名
        host_name = jsonpath(json_data, '$..cardData.name')[0]
        # 获取价格等参数
        price_param = jsonpath(json_data, '$..variables')[0]
        price, total_price = get_price(price_param)
        if '__typename' in price:
            price = ''
        data = {
            "房源名称": name,
            "房源链接": url,
            "标题": title,
            "房客": guests,
            "卧室": bedrooms,
            "床": beds,
            "卫生间": baths,
            "房东描述": host_description,
            '房间价格': price,
            "总价": total_price,
            "图片数量": images,
            "房东链接": host_url,
            "房东姓名": host_name
        }
        logger.info(data)
        return data
    except Exception as e:
        logger.error(f'抓取异常{e}  异常链接-{url}')

    # ["niobeMinimalClientData"][0][1]["data"]["presentation"]["stayProductDetailPage"]["sections"]["sections"][18][
    #     "section"]["htmlDescription"]["htmlText"]


def get_search_rooms():

    df = pd.read_csv('search_urls.csv')
    logger.info('开始抓取搜索房源信息...')
    homes = []
    for index, item in df.iterrows():
        try:
            data = get_room_detail(item['url'])
            if data:
                homes.append(data)
        except Exception as e:
            logger.error(e)
    try:
        pd.DataFrame(homes).to_excel(f'{city_name}_homes.xlsx', index=False)
        logger.success(f'全部搜索房源信息抓取完成,结果已保存为{city_name}_homes.xlsx')
    except Exception as e:
        logger.error(f'搜索房源信息保存失败-{e}')

