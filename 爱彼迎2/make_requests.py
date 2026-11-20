"""请求异常重试"""
import time

import requests


def make_requests(url, headers, method='GET', params=None, json=None, times=3):
    for _ in range(times):
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=10)
                return response
            elif method == 'POST':
                response = requests.post(url, headers=headers, params=params, json=json, timeout=10)
                return response
        except Exception as e:
            print(e)
            time.sleep(1)
