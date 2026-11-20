import { buildHostProfileUrl, decodeAirbnbId, findObjectsWhere } from '../utils/helpers.js';
import { cleanHostLabel, isValidHostName } from './hostParser.js';
import { extractDeferredStateFromHtml } from './niobeParser.js';

function cleanHostName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = cleanHostLabel(raw);
  return isValidHostName(cleaned) ? cleaned : '';
}

/**
 * Parse Airbnb Listing Detail Page (PDP) JSON payloads from
 * `data-deferred-state-*` or `StayPdpSections` GraphQL responses.
 */
export function parsePdpPayloads(payloads) {
  const list = Array.isArray(payloads) ? payloads : [payloads];

  let hostId = '';
  let hostName = '';
  let lat = null;
  let lng = null;
  let propertyType = '';
  let description = '';
  let title = '';
  const amenitiesSet = new Set();
  const unavailableAmenitiesSet = new Set();
  let ratingAverage = 0;
  let ratingCount = 0;
  let isGuestFavorite = false;

  for (const root of list) {
    if (!root || typeof root !== 'object') continue;

    // 1. Find all PDP sections (sectionId / sectionComponentType)
    const sections = findObjectsWhere(
      root,
      (obj) =>
        typeof obj.sectionId === 'string' ||
        typeof obj.sectionComponentType === 'string'
    );

    for (const sec of sections) {
      const secId = (sec.sectionId || sec.sectionComponentType || '').toUpperCase();
      const content = sec.section || sec;

      // AMENITIES_DEFAULT
      if (secId.includes('AMENITIES')) {
        const groups = [
          ...(Array.isArray(content.seeAllAmenitiesGroups) ? content.seeAllAmenitiesGroups : []),
          ...(Array.isArray(content.previewAmenitiesGroups) ? content.previewAmenitiesGroups : []),
        ];
        for (const group of groups) {
          const items = Array.isArray(group?.amenities) ? group.amenities : [];
          for (const item of items) {
            const label = item?.title || item?.name;
            if (!label) continue;
            if (item.available === false) {
              unavailableAmenitiesSet.add(String(label).trim());
            } else {
              amenitiesSet.add(String(label).trim());
            }
          }
        }
      }

      // LOCATION_DEFAULT
      if (secId.includes('LOCATION')) {
        if (typeof content.lat === 'number' && typeof content.lng === 'number') {
          lat = content.lat;
          lng = content.lng;
        } else if (typeof content.latitude === 'number' && typeof content.longitude === 'number') {
          lat = content.latitude;
          lng = content.longitude;
        }
      }

      // DESCRIPTION_DEFAULT
      if (secId.includes('DESCRIPTION')) {
        const descText =
          content?.htmlDescription?.htmlText ||
          content?.description ||
          content?.summary ||
          '';
        if (descText && String(descText).length > description.length) {
          description = String(descText).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }

      // TITLE_DEFAULT / OVERVIEW_DEFAULT
      if (secId.includes('TITLE') && !title && content?.title) {
        title = String(content.title).trim();
      }
      if ((secId.includes('OVERVIEW') || secId.includes('TITLE')) && !propertyType) {
        const candidate =
          content?.title ||
          content?.listingTitle ||
          content?.subtitle ||
          content?.propertyType ||
          '';
        if (candidate && typeof candidate === 'string' && candidate.length < 120) {
          propertyType = candidate.trim();
        }
      }

      // MEET_YOUR_HOST / HOST_OVERVIEW
      if (secId.includes('HOST')) {
        const cardData = content?.cardData || content;
        const rawUserId =
          cardData?.userId ||
          content?.hostAvatar?.userId ||
          content?.user?.id ||
          sec?.hostId;
        const decodedHostId = decodeAirbnbId(rawUserId);
        if (decodedHostId && !hostId) hostId = decodedHostId;

        const nameCandidate =
          cardData?.smartName ||
          cardData?.firstName ||
          cardData?.name ||
          content?.hostName ||
          content?.user?.smartName ||
          content?.user?.firstName ||
          content?.title;
        if (nameCandidate && !hostName) {
          const cleaned = cleanHostName(String(nameCandidate));
          if (cleaned) {
            hostName = cleaned;
          }
        }
      }
    }

    // 1B. Direct search for Amenities groups anywhere in the JSON tree
    // (Airbnb's StaysPdpSections often separates layout sectionId from data section objects)
    const amenityContainers = findObjectsWhere(
      root,
      (obj) =>
        Array.isArray(obj.seeAllAmenitiesGroups) ||
        Array.isArray(obj.previewAmenitiesGroups)
    );
    for (const container of amenityContainers) {
      const groups = [
        ...(Array.isArray(container.seeAllAmenitiesGroups) ? container.seeAllAmenitiesGroups : []),
        ...(Array.isArray(container.previewAmenitiesGroups) ? container.previewAmenitiesGroups : []),
      ];
      for (const group of groups) {
        const items = Array.isArray(group?.amenities) ? group.amenities : [];
        for (const item of items) {
          const label = item?.title || item?.name;
          if (!label) continue;
          if (item.available === false) {
            unavailableAmenitiesSet.add(String(label).trim());
          } else {
            amenitiesSet.add(String(label).trim());
          }
        }
      }
    }

    // 1C. Direct search for MeetYourHostSection / cardData anywhere in the JSON tree
    const hostCards = findObjectsWhere(
      root,
      (obj) =>
        obj.__typename === 'MeetYourHostSection' ||
        (obj.cardData && (obj.cardData.userId || obj.cardData.name))
    );
    for (const hc of hostCards) {
      const cardData = hc.cardData || hc;
      const decoded = decodeAirbnbId(cardData?.userId || hc?.hostAvatar?.userId);
      if (decoded && !hostId) hostId = decoded;
      const candidate =
        cardData?.smartName ||
        cardData?.firstName ||
        cardData?.name ||
        hc?.hostName ||
        hc?.title;
      if (candidate && !hostName) {
        const cleaned = cleanHostName(String(candidate));
        if (cleaned) {
          hostName = cleaned;
        }
      }
    }

    // 2. Fallback deep search for coordinates if LOCATION_DEFAULT wasn't matched directly
    if (lat === null || lng === null) {
      const locNodes = findObjectsWhere(
        root,
        (obj) =>
          (typeof obj.lat === 'number' && typeof obj.lng === 'number' && Math.abs(obj.lat) <= 90) ||
          (typeof obj.latitude === 'number' && typeof obj.longitude === 'number' && Math.abs(obj.latitude) <= 90)
      );
      if (locNodes.length > 0) {
        lat = locNodes[0].lat ?? locNodes[0].latitude;
        lng = locNodes[0].lng ?? locNodes[0].longitude;
      }
    }

    // 3. Fallback deep search for Host ID / Name in loggingData or metadata
    if (!hostId) {
      const hostNodes = findObjectsWhere(
        root,
        (obj) =>
          (typeof obj.hostId === 'string' || typeof obj.hostId === 'number') ||
          (obj.__typename === 'PdpHostProfile' && obj.id)
      );
      for (const hn of hostNodes) {
        const decoded = decodeAirbnbId(hn.hostId || hn.id);
        if (decoded) {
          hostId = decoded;
          if (!hostName && (hn.name || hn.firstName)) {
            hostName = String(hn.name || hn.firstName).trim();
          }
          break;
        }
      }
    }

    // 4. Fallback propertyType / roomTypeCategory in metadata
    if (!propertyType) {
      const metaNodes = findObjectsWhere(
        root,
        (obj) => typeof obj.propertyType === 'string' || typeof obj.roomTypeCategory === 'string'
      );
      for (const mn of metaNodes) {
        if (mn.propertyType) {
          propertyType = mn.propertyType;
          break;
        }
      }
    }

    // 5. Rating / Guest Favorite fallback
    const reviewNodes = findObjectsWhere(
      root,
      (obj) =>
        typeof obj.overallRating === 'number' ||
        (typeof obj.reviewCount === 'number' && typeof obj.rating === 'number')
    );
    if (reviewNodes.length > 0) {
      ratingAverage = ratingAverage || reviewNodes[0].overallRating || reviewNodes[0].rating || 0;
      ratingCount = ratingCount || reviewNodes[0].reviewCount || 0;
    }

    const gfNodes = findObjectsWhere(
      root,
      (obj) => obj.isGuestFavorite === true || obj.badgeType === 'GUEST_FAVORITE'
    );
    if (gfNodes.length > 0) {
      isGuestFavorite = true;
    }
  }

  return {
    title,
    hostId,
    hostName,
    hostUrl: hostId ? buildHostProfileUrl(hostId) : '',
    lat,
    lng,
    propertyType,
    description,
    amenities: Array.from(amenitiesSet),
    unavailableAmenities: Array.from(unavailableAmenitiesSet),
    ratingAverage,
    ratingCount,
    isGuestFavorite,
  };
}

export function parsePdpHtml(html) {
  const states = extractDeferredStateFromHtml(html);
  return parsePdpPayloads(states);
}
