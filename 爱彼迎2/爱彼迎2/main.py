from search_detail_spider import get_search_rooms
from search_urls_spider import get_search_urls
from host_room_spider import get_host_rooms


# 注意 切换抓取城市时 新保存的结果会覆盖之前抓取的城市数据 （抓取完一个城市时 请先做好备份）
def main():
    get_search_urls(5)  # 先获取所有搜索结果房源的链接
    get_search_rooms()  # 通过房源链接抓取所有搜索房源信息
    get_host_rooms()  # 抓取所有房东的房源信息


if __name__ == '__main__':
    main()