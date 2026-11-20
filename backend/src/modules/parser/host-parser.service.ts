import { Injectable } from '@nestjs/common';
import { Page, Response } from 'playwright';
import { sleep } from '../../common/helpers';

@Injectable()
export class HostParserService {
  /**
   * Ánh xạ 1-1 _collect_host_room_ids(page, host_url) từ host_room_spider.py:
   * Mở hồ sơ Host -> Bấm "View all" -> Cuộn & bấm "Show more" -> Trả về toàn bộ room_id duy nhất.
   */
  async collectHostRoomIds(
    page: Page,
    hostUrl: string,
    onNavigated?: (response: Response | null) => Promise<void>,
  ): Promise<string[]> {
    const response = await page.goto(hostUrl, { timeout: 60000, waitUntil: 'commit' });
    if (onNavigated) {
      await onNavigated(response);
    }
    await page.waitForSelector('a[href*="/rooms/"]', { timeout: 20000 }).catch(() => null);
    await sleep(1500);

    const viewAllBtn = page.locator("button:has-text('View all'), a:has-text('View all')").first();
    if ((await viewAllBtn.count()) > 0) {
      try {
        await viewAllBtn.click({ timeout: 3000 });
        await sleep(1800);
      } catch {
        // Ignore
      }
    }

    const dialog = page.locator('[role="dialog"]').first();
    const hasDialog = (await dialog.count()) > 0;
    const container = hasDialog ? dialog : page;

    let prevCount = -1;
    for (let i = 0; i < 15; i++) {
      const links = await container.locator('a[href*="/rooms/"]').all();
      if (links.length === prevCount) {
        const showMore = container.locator("button:has-text('Show more')").first();
        if ((await showMore.count()) > 0 && (await showMore.isVisible().catch(() => false))) {
          try {
            await showMore.click({ timeout: 3000 });
            await sleep(1400);
            continue;
          } catch {
            break;
          }
        }
        break;
      }
      prevCount = links.length;
      try {
        if (hasDialog) {
          await dialog.evaluate((el) => el.scrollBy(0, 1500));
        } else {
          await page.mouse.wheel(0, 1500);
        }
        await sleep(700);
      } catch {
        break;
      }
    }

    const finalLinks = await container.locator('a[href*="/rooms/"]').all();
    const roomIds: string[] = [];
    const seen = new Set<string>();
    for (const link of finalLinks) {
      const href = (await link.getAttribute('href').catch(() => '')) || '';
      if (!href.includes('/rooms/')) continue;
      const roomId = href.split('/rooms/')[1]?.split('?')[0] || '';
      if (/^\d+$/.test(roomId) && !seen.has(roomId)) {
        seen.add(roomId);
        roomIds.push(roomId);
      }
    }
    return roomIds;
  }
}
