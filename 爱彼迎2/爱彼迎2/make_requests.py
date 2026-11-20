import time
import requests
from loguru import logger

def make_requests(url, headers, method='GET', params=None, json=None, times=2):
    for attempt in range(times):
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=15)
            else:
                response = requests.post(url, headers=headers, params=params, json=json, timeout=15)

            if response.status_code != 200:
                logger.error(f"Airbnb từ chối (HTTP {response.status_code}): {response.text[:500]}")
                return None

            return response
        except Exception as e:
            logger.error(f"Lỗi kết nối Python: {e}")
            time.sleep(1)
    return None