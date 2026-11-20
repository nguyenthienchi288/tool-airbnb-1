import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderType, DeepExtractedRoom } from './types';

export interface AiBuildingEnrichmentResult {
  building_name?: string;
  address?: string;
  district?: string;
  city?: string;
  country?: string;
  google_link?: string;
  swimming_pool?: string;
  gym?: string;
  gym_fee?: string;
  parking?: string;
}

export interface AiRoomEnrichmentItem {
  listingId: string;
  supplier_apartment_code?: string;
  child_policy?: string;
  check_in_time?: string;
  check_out_time?: string;
  clean_host_name?: string;
  room_type_verified?: string;
}

@Injectable()
export class AiEnrichmentService {
  constructor(private readonly configService: ConfigService) {}

  resolveProviderAndKey(
    requestedProvider?: AiProviderType,
    requestedKey?: string,
    enableAiEnrichment = true,
  ): { provider: AiProviderType; apiKey: string } {
    if (!enableAiEnrichment || requestedProvider === 'none') {
      return { provider: 'none', apiKey: '' };
    }

    const geminiKey =
      (requestedProvider === 'gemini' ? requestedKey?.trim() : '') ||
      this.configService.get<string>('GEMINI_API_KEY')?.trim() ||
      '';
    const openaiKey =
      (requestedProvider === 'openai' ? requestedKey?.trim() : '') ||
      this.configService.get<string>('OPENAI_API_KEY')?.trim() ||
      '';

    if (requestedProvider === 'openai' && openaiKey) {
      return { provider: 'openai', apiKey: openaiKey };
    }
    if (requestedProvider === 'gemini' && geminiKey) {
      return { provider: 'gemini', apiKey: geminiKey };
    }
    if (requestedKey?.trim()) {
      return { provider: requestedProvider || 'gemini', apiKey: requestedKey.trim() };
    }
    if (geminiKey) return { provider: 'gemini', apiKey: geminiKey };
    if (openaiKey) return { provider: 'openai', apiKey: openaiKey };

    return { provider: 'none', apiKey: '' };
  }

  private async callJsonLlm(
    provider: 'gemini' | 'openai',
    apiKey: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        });
        if (!resp.ok) return null;
        const data: any = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return text ? JSON.parse(text) : null;
      }

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!resp.ok) return null;
      const data: any = await resp.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 1 lần gọi AI cho cả cụm tòa nhà: chuẩn hóa Building Name, Address (EN+KO+Postal), District, Gym, Gym fee, Parking, Pool.
   */
  async enrichBuildingCluster(params: {
    provider: 'gemini' | 'openai';
    apiKey: string;
    rooms: DeepExtractedRoom[];
    reverseGeoAddress?: string;
    centerLat: number | null;
    centerLng: number | null;
  }): Promise<AiBuildingEnrichmentResult | null> {
    const { provider, apiKey, rooms, reverseGeoAddress, centerLat, centerLng } = params;
    if (rooms.length === 0) return null;

    const systemPrompt = `You are a real-estate & serviced-apartment data analyst specializing in South Korea (Seoul) and global Airbnb properties.
Extract the exact, canonical building information from the combined context of all listings in the same map bounding box.
Rules:
1. "building_name": Official building/Officetel/condo name (include bilingual English + Korean if known, e.g. "Zizel Signity (지젤시그니티)"). NEVER use generic ad phrases like "Luxury Residence", "Cozy Stay", "Modern Studio", or tourist landmarks like "Gyeongbokgung Palace", "Namsan", "Myeongdong".
2. "address": Full street address including English, Korean (if in Korea), and postal code if known.
3. "district", "city", "country": Normalized administrative names (e.g. "Seocho-gu", "Seoul", "South Korea").
4. "google_link": Google Maps search URL for that exact building.
5. "swimming_pool": "YES" (with hours/notes if mentioned) or "NO".
6. "gym": "YES" with opening hours if mentioned (e.g. "YES, 10:00 AM – 7:00 PM") or "NO".
7. "gym_fee": "Free" or "Have to pay" ONLY if explicitly supported by description/rules; otherwise "Check with host" (or "" if no gym). NEVER guess "Free".
8. "parking": "yes, free parking" or "yes, payable parking" or "NO".
Return strictly a JSON object with these keys.`;

    const contextSample = rooms.slice(0, 15).map((r) => ({
      listingId: r.listingId,
      title: r.title,
      hostName: r.hostName,
      amenities: r.amenities.filter((a) => /gym|fitness|pool|park|헬스|피트니스|수영|주차/i.test(a)),
      description: r.description.slice(0, 700),
      houseRules: r.houseRulesText.slice(0, 400),
    }));

    const userPrompt = JSON.stringify({
      centerCoords: { lat: centerLat, lng: centerLng },
      reverseGeoAddress: reverseGeoAddress || '',
      listingsContext: contextSample,
    });

    return this.callJsonLlm(provider, apiKey, systemPrompt, userPrompt);
  }

  /**
   * Batch 5–10 căn/lần: trích xuất supplier_apartment_code, child_policy, check_in_time, check_out_time, clean_host_name, room_type_verified.
   */
  async enrichRoomsBatch(params: {
    provider: 'gemini' | 'openai';
    apiKey: string;
    rooms: DeepExtractedRoom[];
  }): Promise<Map<string, AiRoomEnrichmentItem>> {
    const { provider, apiKey, rooms } = params;
    const resultMap = new Map<string, AiRoomEnrichmentItem>();
    if (rooms.length === 0) return resultMap;

    const systemPrompt = `You are a precision Airbnb listing parser. For each listing in the input array, extract missing or messy fields ONLY from the provided text.
Return a JSON object: { "items": [ { "listingId": "...", "supplier_apartment_code": "", "child_policy": "", "check_in_time": "", "check_out_time": "", "clean_host_name": "", "room_type_verified": "" } ] }.
Rules:
- "supplier_apartment_code": Apartment/unit/room code if mentioned in title/description (e.g. "B-515", "#3810", "1508호"), else "".
- "child_policy": Concise normalized policy from house rules (e.g. "Suitable for children (2-12 yrs), Not suitable for infants" or "Not suitable for children/infants"), else "".
- "check_in_time" & "check_out_time": Clean 12h or 24h times (e.g. "4:00 PM", "11:00 AM") if missing or merged.
- "clean_host_name": Real host name; NEVER return "Log in", "Sign up", "Oops", "Airbnb Host", "Stay tuned", "Error".
- "room_type_verified": Verify "Studio", "1BR", "2BR", "3BR" based on description vs bedrooms.`;

    const batchSize = 8;
    for (let i = 0; i < rooms.length; i += batchSize) {
      const slice = rooms.slice(i, i + batchSize).map((r) => ({
        listingId: r.listingId,
        title: r.title,
        rawHostName: r.hostName,
        bedrooms: r.bedrooms,
        currentRoomType: r.roomType,
        checkInTime: r.checkInTime,
        checkOutTime: r.checkOutTime,
        description: r.description.slice(0, 600),
        houseRules: r.houseRulesText.slice(0, 500),
      }));

      const res = await this.callJsonLlm(
        provider,
        apiKey,
        systemPrompt,
        JSON.stringify({ listings: slice }),
      );
      const items = Array.isArray(res?.items) ? res.items : [];
      for (const item of items) {
        if (item?.listingId) {
          resultMap.set(String(item.listingId), item);
        }
      }
    }

    return resultMap;
  }
}
