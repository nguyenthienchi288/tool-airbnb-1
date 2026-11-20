import { chromium } from 'playwright';
import { APP_CONFIG } from '../config/index.js';

const BLOCKED_RESOURCE_TYPES = new Set([
  'image',
  'media',
  'font',
  'stylesheet',
  'websocket',
  'other',
]);

const BLOCKED_THIRD_PARTY_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'maps.googleapis.com',
  'maps.gstatic.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com',
  'bugsnag.com',
  'sentry.io',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'datadoghq.com',
  'newrelic.com',
  'tiktok.com',
  'bing.com',
  'branch.io',
  'appsflyer.com',
];

function parseProxyOption(proxyInput) {
  if (!proxyInput) return undefined;
  if (typeof proxyInput === 'object' && proxyInput.server) return proxyInput;
  if (typeof proxyInput !== 'string' || !proxyInput.trim()) return undefined;
  try {
    const parsed = new URL(proxyInput.trim());
    const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    return {
      server,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    return { server: proxyInput.trim() };
  }
}

export function resolveProxyConfig(options = {}) {
  return parseProxyOption(options.proxyUrl || options.proxy) || APP_CONFIG.proxy;
}

/**
 * Launch a Playwright Chromium browser configured for airbnb.com.vn (locale: vi-VN).
 */
export async function launchAirbnbBrowser(options = {}) {
  const headless = options.headless ?? APP_CONFIG.headless;

  const launchOptions = {
    headless,
    slowMo: APP_CONFIG.slowMo,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  };

  const proxyConfig = resolveProxyConfig(options);
  if (proxyConfig) {
    launchOptions.proxy = proxyConfig;
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // Reduce automation fingerprint
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // Save ~95% proxy bandwidth: abort heavy assets & 3rd-party tracking/maps domains
  await context.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (BLOCKED_RESOURCE_TYPES.has(type)) {
      return route.abort();
    }
    const url = req.url().toLowerCase();
    if (BLOCKED_THIRD_PARTY_DOMAINS.some((domain) => url.includes(domain))) {
      return route.abort();
    }
    return route.continue();
  });

  return { browser, context, hasProxy: Boolean(proxyConfig) };
}
