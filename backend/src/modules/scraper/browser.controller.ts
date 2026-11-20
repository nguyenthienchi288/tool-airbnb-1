import { Body, Controller, Get, Post } from '@nestjs/common';
import { parseProxyUrl } from '../../common/helpers';
import { BrowserService } from './browser.service';

@Controller('api/browser')
export class BrowserController {
  constructor(private readonly browserService: BrowserService) {}

  @Post('open-setup')
  async openSetupBrowser(
    @Body() body?: { proxyUrl?: string; useWarpProxy?: boolean },
  ) {
    const warpProxy = body?.useWarpProxy
      ? { server: 'socks5://127.0.0.1:40000' }
      : undefined;
    const proxyOverride = parseProxyUrl(body?.proxyUrl) || warpProxy;
    const res = await this.browserService.openSetupBrowser(proxyOverride);
    return {
      ok: true,
      channelUsed: res.channelUsed,
      profileDir: res.profileDir,
      message:
        'Đã mở Chrome với Hồ sơ VPN cố định! Hãy cài/bật VPN Extension rồi đóng cửa sổ để lưu.',
    };
  }

  @Get('check-ip')
  async checkIp() {
    return this.browserService.checkIpTrace();
  }
}
