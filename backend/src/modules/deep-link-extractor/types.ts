export interface ParsedAirbnbUrl {
  originalUrl: string;
  platformLocation: {
    origin: string;
    domain: string;
    rawLocationPath: string;
    locationDisplay: string;
    cityGuess: string;
    countryGuess: string;
    placeId: string;
    source: string;
    searchMode: string;
  };
  dates: {
    checkIn: string;
    checkOut: string;
    nights: number;
    datePickerType: string;
    flexibleTripLengths: string[];
    monthlyStartDate: string;
    monthlyLength: string;
    monthlyEndDate: string;
  };
  mapBounds: {
    neLat: number | null;
    swLat: number | null;
    neLng: number | null;
    swLng: number | null;
    zoom: string;
    searchByMap: boolean;
    searchType: string;
    hasBounds: boolean;
  };
  filters: {
    l2PropertyTypeIds: string[];
    roomTypes: string[];
    priceMin: string;
    priceMax: string;
    priceFilterNumNights: string;
    channel: string;
    selectedFilterOrder: string[];
  };
  tracking: {
    refFsid: string;
    refSearchSessionId: string;
  };
}

export type BoundsStatus = 'inside' | 'nearby' | 'outside' | 'unknown';

export interface DeepExtractedRoom {
  listingId: string;
  url: string;
  title: string;
  subtitle: string;
  description: string;
  address: string;
  district: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  boundsStatus: BoundsStatus;
  boundsLabel: string;
  buildingName: string;
  supplierApartmentCode: string;
  roomType: string;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  maxPeople: number;
  pricePerNight: number;
  totalPrice: number;
  cleaningFee: number;
  serviceFee: number;
  currency: string;
  rating: number;
  reviewsCount: number;
  checkInTime: string;
  checkOutTime: string;
  childPolicy: string;
  houseRulesText: string;
  amenities: string[];
  amenityFlags: {
    airConditioner: 'YES' | 'NO';
    hairDryer: 'YES' | 'NO';
    shampooBodyWash: 'YES' | 'NO';
    towel: 'YES' | 'NO';
    tv: 'YES' | 'NO';
    wifi: 'YES' | 'NO';
    washingMachine: 'YES' | 'NO';
    kitchen: 'YES' | 'NO';
    basicCookingStaff: 'YES' | 'NO';
    swimmingPool: string;
    gym: string;
    gymFee: string;
    parking: string;
  };
  photoUrls: string[];
  localPhotoDir: string;
  hostId: string;
  hostName: string;
  hostAirbnbLink: string;
  hostTotalListings: number;
}

export interface SevenNightsBuildingRow {
  'Building Code': string;
  'Building Name': string;
  Address: string;
  'google link': string;
  district: string;
  city: string;
  country: string;
  'swimming pool': string;
  gym: string;
  'gym fee': string;
  parking: string;
  'ROOM INFOR': string;
}

export interface SevenNightsHostRow {
  'Host code': string;
  'host name': string;
  country: string;
  'host phone number': string;
  'bank name': string;
  'account number': string;
  'account name': string;
  'host airbnb link': string;
  'supplier apartment code': string;
  'ROOM INFOR': string;
}

export interface SevenNightsRoomRow {
  'Room code': string;
  'Airbnb Room ID': string;
  'Room URL': string;
  'building name': string;
  'Building code': string;
  'Host name': string;
  'Host code': string;
  'Room type': string;
  city: string;
  'air conditioner': 'YES' | 'NO';
  'hair dryer': 'YES' | 'NO';
  'shampoo/body wash': 'YES' | 'NO';
  towel: 'YES' | 'NO';
  TV: 'YES' | 'NO';
  WIFI: 'YES' | 'NO';
  'washing machine': 'YES' | 'NO';
  kitchen: 'YES' | 'NO';
  'basic cooking staff': 'YES' | 'NO';
  'HOW MANY BED': number;
  'Child policy': string;
  'how many room': number;
  'how many toilet': number;
  'max people': number;
  'check in time': string;
  'check out time': string;
  Photo: string;
}

export interface SevenNightsPreviewData {
  buildings: SevenNightsBuildingRow[];
  hosts: SevenNightsHostRow[];
  rooms: SevenNightsRoomRow[];
}

export type AiProviderType = 'gemini' | 'openai' | 'none';

export interface DeepExtractJobInput {
  url: string;
  downloadPhotos: boolean;
  strictBoundsOnly: boolean;
  proxyUrl?: string;
  useWarpProxy?: boolean;
  humanLikeMode?: boolean;
  aiProvider?: AiProviderType;
  aiApiKey?: string;
  enableAiEnrichment?: boolean;
}

export interface DeepExtractBundleResult {
  bundleName: string;
  bundleDir: string;
  sevenNightsExcelFile: string;
  rawExcelFile: string;
  rawJsonFile: string;
  zipFileName: string;
  totalFound: number;
  totalExtracted: number;
  totalPhotosDownloaded: number;
  stoppedEarly?: boolean;
  preview: SevenNightsPreviewData;
}
