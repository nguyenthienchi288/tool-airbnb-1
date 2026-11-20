export const APP_VERSION =
  'v4.2.0 - Tab 2 High-Precision JSON & Korean Building Deep Parser';
export const SHORT_VERSION = 'v4.2.0';

export const AIRBNB_BASE_URL = 'https://www.airbnb.com.vn';
export const AIRBNB_API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface PriceBucketConfig {
  min: number;
  max: number | null;
  label: string;
  splitDepth?: number;
}

export const DEFAULT_PRICE_BUCKETS_VND: PriceBucketConfig[] = [
  { min: 0, max: 500000, label: '0 - 500k' },
  { min: 500000, max: 750000, label: '500k - 750k' },
  { min: 750000, max: 1000000, label: '750k - 1tr' },
  { min: 1000000, max: 1300000, label: '1tr - 1.3tr' },
  { min: 1300000, max: 1700000, label: '1.3tr - 1.7tr' },
  { min: 1700000, max: 2200000, label: '1.7tr - 2.2tr' },
  { min: 2200000, max: 3000000, label: '2.2tr - 3tr' },
  { min: 3000000, max: 4500000, label: '3tr - 4.5tr' },
  { min: 4500000, max: 8000000, label: '4.5tr - 8tr' },
  { min: 8000000, max: null, label: 'Trên 8tr' },
];

export const DEFAULT_PRICE_BUCKETS_TEXT =
  '0-500000, 500000-750000, 750000-1000000, 1000000-1300000, 1300000-1700000, 1700000-2200000, 2200000-3000000, 3000000-4500000, 4500000-8000000, 8000000+';

export const SEOUL_PRICE_BUCKETS_VND: PriceBucketConfig[] = [
  { min: 0, max: 1000000, label: '0 - 1tr' },
  { min: 1000001, max: 1500000, label: '1tr - 1.5tr' },
  { min: 1500001, max: 2200000, label: '1.5tr - 2.2tr' },
  { min: 2200001, max: 3200000, label: '2.2tr - 3.2tr' },
  { min: 3200001, max: 5000000, label: '3.2tr - 5tr' },
  { min: 5000001, max: null, label: 'Trên 5tr' },
];

export const SEOUL_PRICE_BUCKETS_TEXT =
  '0-1000000, 1000001-1500000, 1500001-2200000, 2200001-3200000, 3200001-5000000, 5000001+';

export const SEOUL_CITY_VARIANTS = [
  'Seoul',
  'Seoul, South Korea',
  '서울',
  '서울특별시',
  '首尔',
  'ソウル',
];

export const SEOUL_DISTRICT_GROUPS = {
  cbd: [
    'Myeongdong Seoul',
    'Jung-gu Seoul',
    'Jongno-gu Seoul',
    'Dongdaemun Seoul',
    'Yongsan-gu Seoul',
    'Itaewon Seoul',
  ],
  northwest: [
    'Hongdae Seoul',
    'Mapo-gu Seoul',
    'Yeonnam-dong Seoul',
    'Sinchon Seoul',
    'Yeongdeungpo-gu Seoul',
  ],
  south: [
    'Gangnam-gu Seoul',
    'Seocho-gu Seoul',
    'Songpa-gu Seoul',
    'Jamsil Seoul',
    'Seongsu-dong Seoul',
  ],
};

export const KNOWN_BUILDING_REGEX =
  /\b(Vinhomes\s+Central\s+Park|Vinhomes\s+Golden\s+River|Vinhomes\s+Grand\s+Park|Vinhomes\s+Smart\s+City|Vinhomes\s+Ocean\s+Park|Vinhomes\s+Metropolis|Masteri\s+Th[aả]o\s+[ĐD]i[eề]n|Masteri\s+An\s+Ph[uú]|Millennium|Rivergate|The\s+Gold\s*View|GoldView|Saigon\s+Royal|Saigon\s+Pearl|Sunwah\s+Pearl|Empire\s+City|The\s+Metropole|The\s+Manor|Eco\s+Green|Lavida\s+Plus|Icon\s*56|Sunrise\s+City|Sunrise\s+Riverside|Estella\s+Heights|Gateway\s+Th[aả]o\s+[ĐD]i[eề]n|The\s+Sun\s+Avenue|Landmark\s*81|The\s+Tresor|Kingdom\s*101|HaDo\s+Centrosa|Diamond\s+Island|Galaxy\s*9|Scenic\s+Valley|Happy\s+Valley|Kingston\s+Residence|The\s+Vista|Vista\s+Verde|Feliz\s+en\s+Vista|Sadora|Sarimi|Sala|Keangnam|Lotte\s+Center|Royal\s+City|Times\s+City|D['’]?Capitale)\b/i;

export const HIGH_RISE_KEYWORDS = [
  'thang máy',
  'elevator',
  'lift',
  'chung cư',
  'căn hộ',
  'condo',
  'apartment',
  'tower',
  'tòa',
  'tầng',
  'floor',
  'penthouse',
  'studio',
  'vinhomes',
  'masteri',
  'landmark',
  'rivergate',
  'millennium',
  'goldview',
];
