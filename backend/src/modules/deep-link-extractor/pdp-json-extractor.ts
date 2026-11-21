import { cleanControlChars, decodeAirbnbId } from '../../common/helpers';

export interface StructuredPdpJsonData {
  title: string;
  description: string;
  gettingAround: string;
  guestInteraction: string;
  availableAmenities: string[];
  unavailableAmenities: string[];
  personCapacity: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  checkInTime: string;
  checkOutTime: string;
  childPolicy: string;
  houseRulesItems: string[];
  hostId: string;
  hostName: string;
  lat: number | null;
  lng: number | null;
  locationSubtitle: string;
  photoUrls: string[];
}

function stripHtml(html: string): string {
  return cleanControlChars(
    (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\u202f|\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeUnicodeSpaces(text: string): string {
  return cleanControlChars(text || '')
    .replace(/[\u202f\u00a0\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INVALID_HOST_NAMES = new Set([
  'airbnb host',
  'host',
  'about your host',
  'meet your host',
  'superhost',
  'stay tuned',
  'log in',
  'sign up',
  'login',
  'signup',
  'oops',
  'error',
  '429',
  '503',
]);

export function isValidHostName(name: string): boolean {
  const clean = normalizeUnicodeSpaces(name).toLowerCase();
  if (!clean || clean.length <= 1) return false;
  if (INVALID_HOST_NAMES.has(clean)) return false;
  if (/(log\s*in|sign\s*up|oops|stay\s*tuned|error\s*\d{3})/i.test(clean)) return false;
  return true;
}

/**
 * Trích xuất chính xác tuyệt đối từ cây JSON StaysPdpSections / niobeMinimalClientData.
 * Chỉ lấy tiện nghi có available !== false và không nằm trong nhóm "Not included".
 */
export function extractStructuredPdpFromJson(
  jsonRoots: unknown[],
): StructuredPdpJsonData {
  const result: StructuredPdpJsonData = {
    title: '',
    description: '',
    gettingAround: '',
    guestInteraction: '',
    availableAmenities: [],
    unavailableAmenities: [],
    personCapacity: 0,
    bedrooms: 0,
    beds: 0,
    bathrooms: 0,
    checkInTime: '',
    checkOutTime: '',
    childPolicy: '',
    houseRulesItems: [],
    hostId: '',
    hostName: '',
    lat: null,
    lng: null,
    locationSubtitle: '',
    photoUrls: [],
  };

  const availSet = new Set<string>();
  const unavailSet = new Set<string>();
  const descParts: string[] = [];
  const ruleItems: string[] = [];
  const photoSet = new Set<string>();
  let arrangementBedsTotal = 0;

  const isNotIncludedGroup = (groupTitle: string): boolean => {
    const t = (groupTitle || '').toLowerCase();
    return (
      t.includes('not included') ||
      t.includes('unavailable') ||
      t.includes('không bao gồm') ||
      t.includes('포함되지 않음') ||
      t.includes('不包含')
    );
  };

  const processAmenityList = (list: any[], groupTitle = '') => {
    const groupExcluded = isNotIncludedGroup(groupTitle);
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const title = normalizeUnicodeSpaces(String(item.title || ''));
      if (!title || title.includes('__typename')) continue;
      const isAvail = !groupExcluded && item.available !== false;
      if (isAvail) {
        availSet.add(title);
      } else {
        unavailSet.add(title);
      }
    }
  };

  const processSection = (sectionId: string, sectionObj: any) => {
    if (!sectionObj || typeof sectionObj !== 'object') return;
    const idUpper = (sectionId || '').toUpperCase();

    // 1. Amenities
    if (
      idUpper.includes('AMENITIES') ||
      Array.isArray(sectionObj.seeAllAmenitiesGroups) ||
      Array.isArray(sectionObj.previewAmenitiesGroups)
    ) {
      for (const grp of sectionObj.seeAllAmenitiesGroups || []) {
        if (grp && Array.isArray(grp.amenities)) {
          processAmenityList(grp.amenities, String(grp.title || ''));
        }
      }
      for (const grp of sectionObj.previewAmenitiesGroups || []) {
        if (grp && Array.isArray(grp.amenities)) {
          processAmenityList(grp.amenities, String(grp.title || ''));
        }
      }
    }

    // 2. Overview & Sleeping Arrangements
    if (idUpper.includes('OVERVIEW')) {
      if (typeof sectionObj.personCapacity === 'number' && sectionObj.personCapacity > 0) {
        result.personCapacity = Math.max(result.personCapacity, sectionObj.personCapacity);
      }
      const items = [
        ...(Array.isArray(sectionObj.detailItems) ? sectionObj.detailItems : []),
        ...(Array.isArray(sectionObj.overviewItems) ? sectionObj.overviewItems : []),
      ];
      for (const it of items) {
        const txt = normalizeUnicodeSpaces(String(it?.title || ''));
        const mGuest = txt.match(/(\d+)\s*(?:guests?|khách|명|位房客)/i);
        if (mGuest) result.personCapacity = Math.max(result.personCapacity, Number(mGuest[1]));
        const mBr = txt.match(/(\d+)\s*(?:bedrooms?|phòng ngủ|침실|间卧室)/i);
        if (mBr) result.bedrooms = Math.max(result.bedrooms, Number(mBr[1]));
        const mBed = txt.match(/(\d+)\s*(?:beds?|giường|침대|张床)/i);
        if (mBed) result.beds = Math.max(result.beds, Number(mBed[1]));
        const mBath = txt.match(/(\d+(?:\.\d+)?)\s*(?:baths?|bathrooms?|phòng tắm|욕실|间卫生间)/i);
        if (mBath) result.bathrooms = Math.max(result.bathrooms, Number(mBath[1]));
      }
    }

    if (idUpper.includes('SLEEPING') || Array.isArray(sectionObj.arrangementDetails)) {
      const arr = Array.isArray(sectionObj.arrangementDetails) ? sectionObj.arrangementDetails : [];
      for (const br of arr) {
        const sub = normalizeUnicodeSpaces(String(br?.subtitle || br?.title || ''));
        const bedMatches = sub.match(/(\d+)\s+(?:king|queen|double|single|twin|sofa|bunk|futon|bed)/gi);
        if (bedMatches) {
          for (const bm of bedMatches) {
            const n = parseInt(bm, 10);
            if (!Number.isNaN(n)) arrangementBedsTotal += n;
          }
        }
      }
    }

    // 3. Description & Additional Details
    if (idUpper.includes('DESCRIPTION')) {
      if (sectionObj.htmlDescription?.htmlText) {
        descParts.push(stripHtml(sectionObj.htmlDescription.htmlText));
      }
      if (Array.isArray(sectionObj.descriptionItems)) {
        for (const di of sectionObj.descriptionItems) {
          const dTitle = normalizeUnicodeSpaces(String(di?.title || ''));
          const dText = stripHtml(String(di?.html?.htmlText || di?.text || ''));
          if (dText) {
            descParts.push(dTitle ? `${dTitle}: ${dText}` : dText);
            if (/guest interaction|tương tác|게스트와의 교류/i.test(dTitle)) {
              result.guestInteraction = dText;
            }
          }
        }
      }
    }

    // 4. House Rules / Policies (Anh + Hàn + Trung, hỗ trợ cả PoliciesSection & key checkIn/checkOut trực tiếp)
    if (
      idUpper.includes('POLICIES') ||
      sectionObj.__typename === 'PoliciesSection' ||
      Array.isArray(sectionObj.houseRulesSections) ||
      Array.isArray(sectionObj.houseRules) ||
      sectionObj.additionalHouseRules !== undefined ||
      sectionObj.checkIn !== undefined ||
      sectionObj.checkOut !== undefined
    ) {
      if (typeof sectionObj.checkIn === 'string' && !result.checkInTime) {
        result.checkInTime = normalizeUnicodeSpaces(sectionObj.checkIn);
      }
      if (typeof sectionObj.checkOut === 'string' && !result.checkOutTime) {
        result.checkOutTime = normalizeUnicodeSpaces(sectionObj.checkOut);
      }
      const ruleGroups: any[] = [];
      if (Array.isArray(sectionObj.houseRulesSections)) {
        ruleGroups.push(...sectionObj.houseRulesSections);
      }
      if (Array.isArray(sectionObj.houseRules)) {
        ruleGroups.push({ items: sectionObj.houseRules });
      }
      for (const grp of ruleGroups) {
        const subItems = Array.isArray(grp?.items) ? grp.items : [grp];
        for (const item of subItems) {
          const rTitle = normalizeUnicodeSpaces(String(item?.title || ''));
          const rSub = normalizeUnicodeSpaces(String(item?.subtitle || item?.html?.htmlText || ''));
          const combined = [rTitle, rSub].filter(Boolean).join(' — ');
          if (!combined) continue;
          ruleItems.push(combined);

          const hasTimeDigit = /\d/.test(rTitle);
          if (
            hasTimeDigit &&
            /(?:check-?in|after|입실|체크인|入住时间)/i.test(rTitle) &&
            /(?:check-?out|checkout|before|퇴실|체크아웃|退房时间)/i.test(rTitle)
          ) {
            const parts = rTitle.split(/(?=check-?out|checkout|퇴실|체크아웃|退房时间)/i);
            const inPart = (parts[0] || '')
              .replace(/^.*?(?:check-?in|입실|체크인|入住时间)(?:\s+after|\s+from|\s+is|\s*:|：)?\s*/i, '')
              .replace(/^(?:after|from)\s+/i, '')
              .trim();
            const outPart = (parts.slice(1).join(' ') || '')
              .replace(/^.*?(?:check-?out|checkout|퇴실|체크아웃|退房时间)(?:\s+before|\s+by|\s+is|\s*:|：)?\s*/i, '')
              .replace(/^(?:before|by)\s+/i, '')
              .trim();
            if (inPart && !result.checkInTime) result.checkInTime = inPart;
            if (outPart && !result.checkOutTime) result.checkOutTime = outPart;
          } else if (hasTimeDigit) {
            if (
              /^(?:check-?in|after|입실|체크인|入住时间)/i.test(rTitle) ||
              /(?:check-?in|입실|체크인|入住时间)\s*(?:after|from|is|:|：)/i.test(rTitle)
            ) {
              const timeVal = rTitle
                .replace(/^.*?(?:check-?in|입실|체크인|入住时间)(?:\s+after|\s+from|\s+is|\s*:|：)?\s*/i, '')
                .replace(/^(?:after|from)\s+/i, '')
                .trim();
              if (timeVal && !result.checkInTime) result.checkInTime = timeVal;
            }
            if (/(?:check-?out|checkout|before|퇴실|체크아웃|退房时间)/i.test(rTitle)) {
              const timeVal = rTitle
                .replace(/^.*?(?:check-?out|checkout|퇴실|체크아웃|退房时间)(?:\s+before|\s+by|\s+is|\s*:|：)?\s*/i, '')
                .replace(/^(?:before|by)\s+/i, '')
                .trim();
              if (timeVal && !result.checkOutTime) result.checkOutTime = timeVal;
            }
          }
          if (/(children|infants?|kids|어린이|유아|儿童|婴幼儿)/i.test(combined)) {
            if (!result.childPolicy.includes(combined)) {
              result.childPolicy = result.childPolicy
                ? `${result.childPolicy}; ${combined}`
                : combined;
            }
          }
        }
      }
      if (sectionObj.additionalHouseRules) {
        const extra = stripHtml(String(sectionObj.additionalHouseRules));
        if (extra) {
          ruleItems.push(extra);
          for (const line of extra.split(/\r?\n/)) {
            if (/(children|infants?|kids|어린이|유아|儿童|婴幼儿)/i.test(line)) {
              const cleanLine = normalizeUnicodeSpaces(line);
              if (cleanLine && !result.childPolicy.includes(cleanLine)) {
                result.childPolicy = result.childPolicy
                  ? `${result.childPolicy}; ${cleanLine}`
                  : cleanLine;
              }
            }
          }
        }
      }
    }

    // 5. Meet Your Host / Host Overview
    if (idUpper.includes('HOST')) {
      const rawHostId =
        sectionObj.cardData?.userId ||
        sectionObj.host?.id ||
        sectionObj.hostAvatar?.userId ||
        sectionObj.userId;
      const decoded = decodeAirbnbId(rawHostId);
      if (decoded && !result.hostId) result.hostId = decoded;

      const candidates = [
        sectionObj.cardData?.name,
        sectionObj.host?.name,
        sectionObj.hostName,
        sectionObj.title,
      ];
      for (const c of candidates) {
        if (typeof c === 'string') {
          const cleaned = normalizeUnicodeSpaces(c).replace(/^(Hosted by|Meet your host,?)\s+/i, '');
          if (isValidHostName(cleaned) && !result.hostName) {
            result.hostName = cleaned;
          }
        }
      }
    }

    // 6. Location
    if (idUpper.includes('LOCATION')) {
      if (typeof sectionObj.lat === 'number' && sectionObj.lat !== 0) result.lat = sectionObj.lat;
      if (typeof sectionObj.lng === 'number' && sectionObj.lng !== 0) result.lng = sectionObj.lng;
      if (typeof sectionObj.subtitle === 'string' && sectionObj.subtitle.trim()) {
        result.locationSubtitle = normalizeUnicodeSpaces(sectionObj.subtitle);
      }
      for (const pd of sectionObj.previewLocationDetails || []) {
        const t = normalizeUnicodeSpaces(String(pd?.title || ''));
        const c = stripHtml(String(pd?.content?.htmlText || ''));
        if (c) {
          result.gettingAround = [result.gettingAround, t ? `${t}: ${c}` : c]
            .filter(Boolean)
            .join('\n');
        }
      }
    }

    // 7. Photo Tour (PHOTO_TOUR_SCROLLABLE_MODAL / HERO_DEFAULT — đệ quy tìm mọi mediaItem trong section, lọc ảnh nhỏ width < 400 & icon hệ thống)
    if (
      idUpper.includes('PHOTO') ||
      idUpper.includes('HERO') ||
      Array.isArray(sectionObj.mediaItems) ||
      Array.isArray(sectionObj.previewImages)
    ) {
      const walkPhotos = (obj: any, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 8) return;
        if (Array.isArray(obj)) {
          for (const el of obj) walkPhotos(el, depth + 1);
          return;
        }
        const w = Number(obj.width || obj.aspectRatioWidth || 0);
        const rawUrl = obj.originalUrl || obj.baseUrl || obj.pictureUrl || obj.url;
        if (typeof rawUrl === 'string' && !(w > 0 && w < 400)) {
          if (
            /muscache\.com\/im\/pictures\//i.test(rawUrl) &&
            !/user|avatar|AirbnbPlatformAssets|search-bar-icons|orthographic-images/i.test(rawUrl)
          ) {
            photoSet.add(rawUrl.replace(/im_w=\d+/i, 'im_w=1200'));
          }
        }
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') walkPhotos(v, depth + 1);
        }
      };
      walkPhotos(sectionObj, 0);
    }
  };

  const walk = (node: any, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 25) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    if (typeof node.sectionId === 'string' && node.section && typeof node.section === 'object') {
      processSection(node.sectionId, node.section);
    }
    if (typeof node.id === 'string' && node.section && typeof node.section === 'object') {
      processSection(node.id, node.section);
    }
    if (
      node.__typename === 'PoliciesSection' ||
      Array.isArray(node.houseRulesSections) ||
      Array.isArray(node.houseRules)
    ) {
      processSection('POLICIES_NODE', node);
    }
    if (typeof node.title === 'string' && !result.title && node.__typename === 'PdpTitleSection') {
      result.title = normalizeUnicodeSpaces(node.title);
    }

    // Bắt trực tiếp mọi URL ảnh phòng chất lượng cao trong JSON
    const rawPhotoUrl = node.originalUrl || node.baseUrl || node.pictureUrl || node.url;
    if (typeof rawPhotoUrl === 'string') {
      const w = Number(node.width || node.aspectRatioWidth || 0);
      if (
        !(w > 0 && w < 400) &&
        /muscache\.com\/im\/pictures\//i.test(rawPhotoUrl) &&
        !/\/users\/|user|avatar|AirbnbPlatformAssets|search-bar-icons|orthographic-images/i.test(
          rawPhotoUrl,
        )
      ) {
        photoSet.add(rawPhotoUrl.replace(/im_w=\d+/i, 'im_w=1200'));
      }
    }

    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };

  for (const root of jsonRoots) {
    walk(root, 0);
  }

  if (arrangementBedsTotal > result.beds) {
    result.beds = arrangementBedsTotal;
  }

  result.availableAmenities = Array.from(availSet);
  result.unavailableAmenities = Array.from(unavailSet);
  result.description = Array.from(new Set(descParts)).join('\n');
  result.houseRulesItems = Array.from(new Set(ruleItems));
  result.photoUrls = Array.from(photoSet);

  return result;
}
