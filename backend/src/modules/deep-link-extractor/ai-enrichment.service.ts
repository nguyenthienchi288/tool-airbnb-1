import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderType, DeepExtractedRoom, OpenAiModelType } from './types';

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

  resolveOpenAiConfig(
    requestedProvider?: AiProviderType,
    requestedKey?: string,
    requestedModel?: OpenAiModelType,
    enableAiEnrichment = true,
  ): { provider: AiProviderType; apiKey: string; model: OpenAiModelType } {
    const model: OpenAiModelType = requestedModel === 'gpt-4o-mini' ? 'gpt-4o-mini' : 'gpt-4o';
    if (!enableAiEnrichment || requestedProvider === 'none') {
      return { provider: 'none', apiKey: '', model };
    }

    const apiKey =
      requestedKey?.trim() ||
      this.configService.get<string>('OPENAI_API_KEY')?.trim() ||
      '';

    if (!apiKey) {
      return { provider: 'none', apiKey: '', model };
    }

    return { provider: 'openai', apiKey, model };
  }

  private async callOpenAiJson(
    apiKey: string,
    model: OpenAiModelType,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
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
   * Tạo Prompt có cấu trúc sẵn để người dùng copy dán trực tiếp vào ChatGPT Web trên Chrome đối chiếu 1-1.
   */
  buildManualChatGptPrompt(params: {
    rooms: DeepExtractedRoom[];
    reverseGeoAddress?: string;
    centerLat: number | null;
    centerLng: number | null;
  }): string {
    const { rooms, reverseGeoAddress, centerLat, centerLng } = params;
    const summaryRooms = rooms.map((r) => ({
      listingId: r.listingId,
      url: r.url,
      title: r.title,
      hostName: r.hostName,
      bedrooms: r.bedrooms,
      beds: r.beds,
      bathrooms: r.bathrooms,
      maxPeople: r.maxPeople,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
      childPolicy: r.childPolicy,
      amenitiesSample: r.amenities.slice(0, 25),
      description: r.description.slice(0, 500),
      houseRules: r.houseRulesText.slice(0, 350),
    }));

    return `Hãy đóng vai chuyên viên kiểm định dữ liệu căn hộ dịch vụ Airbnb (chuẩn 7Nights Global).
Dựa vào tọa độ khung bản đồ (${centerLat}, ${centerLng}), địa chỉ tham khảo (${reverseGeoAddress || 'N/A'}) và dữ liệu thật của ${rooms.length} căn hộ dưới đây:
1. Xác định chính xác Tên Tòa Nhà (Building Name song ngữ Anh-Hàn nếu có, loại bỏ từ khóa quảng cáo rác như Luxury Residence / Cozy Stay), Địa chỉ đầy đủ, District, City, Country và Google Maps Link.
2. Kiểm chứng Gym (kèm giờ mở cửa), Gym Fee (chỉ ghi Free hoặc Have to pay nếu có trong mô tả, không bịa), Parking, Swimming Pool.
3. Kiểm tra từng căn hộ để bổ sung: Mã căn (supplier_apartment_code nếu có), Child policy, giờ Check-in / Check-out chuẩn, và rà soát mâu thuẫn giữa mô tả với thông số phòng.

DỮ LIỆU CÁC CĂN HỘ:
${JSON.stringify(summaryRooms, null, 2)}`;
  }

  /**
   * Gọi OpenAI ChatGPT (gpt-4o / gpt-4o-mini) chuẩn hóa toàn bộ thông tin Building Infor từ ngữ cảnh các căn.
   */
  async enrichBuildingCluster(params: {
    apiKey: string;
    model: OpenAiModelType;
    rooms: DeepExtractedRoom[];
    reverseGeoAddress?: string;
    centerLat: number | null;
    centerLng: number | null;
  }): Promise<AiBuildingEnrichmentResult | null> {
    const { apiKey, model, rooms, reverseGeoAddress, centerLat, centerLng } = params;
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
7. "gym_fee": "Free" or "Have to pay" ONLY if explicitly supported by description/rules; otherwise "Check with host" (or "" if no gym). NEVER invent "Free".
8. "parking": "yes, free parking" or "yes, payable parking" or "NO".
Return strictly a JSON object with these keys.`;

    const contextSample = rooms.slice(0, 15).map((r) => ({
      listingId: r.listingId,
      title: r.title,
      hostName: r.hostName,
      amenities: r.amenities.filter((a) => /gym|fitness|pool|park|헬스|피트니스|수영|주차/i.test(a)),
      description: r.description.slice(0, 750),
      houseRules: r.houseRulesText.slice(0, 450),
    }));

    const userPrompt = JSON.stringify({
      centerCoords: { lat: centerLat, lng: centerLng },
      reverseGeoAddress: reverseGeoAddress || '',
      listingsContext: contextSample,
    });

    return this.callOpenAiJson(apiKey, model, systemPrompt, userPrompt);
  }

  /**
   * Batch 5–10 căn/lần: trích xuất supplier_apartment_code, child_policy, check_in_time, check_out_time, clean_host_name, room_type_verified.
   */
  async enrichRoomsBatch(params: {
    apiKey: string;
    model: OpenAiModelType;
    rooms: DeepExtractedRoom[];
  }): Promise<Map<string, AiRoomEnrichmentItem>> {
    const { apiKey, model, rooms } = params;
    const resultMap = new Map<string, AiRoomEnrichmentItem>();
    if (rooms.length === 0) return resultMap;

    const systemPrompt = `You are a precision Airbnb listing parser. For each listing in the input array, extract missing or messy fields ONLY from the provided text.
Return a JSON object: { "items": [ { "listingId": "...", "supplier_apartment_code": "", "child_policy": "", "check_in_time": "", "check_out_time": "", "clean_host_name": "", "room_type_verified": "" } ] }.
Rules:
- "supplier_apartment_code": Apartment/unit/room code if mentioned in title/description (e.g. "B-515", "#3810", "1508호"), else "".
- "child_policy": Concise normalized policy from house rules (e.g. "Suitable for children (2-12 yrs), Not suitable for infants" or "Not suitable for children/infants"), else "".
- "check_in_time" & "check_out_time": Clean times (e.g. "4:00 PM", "11:00 AM") separated cleanly.
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
        description: r.description.slice(0, 650),
        houseRules: r.houseRulesText.slice(0, 550),
      }));

      const res = await this.callOpenAiJson(
        apiKey,
        model,
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
