import { CLASSIFICATION_RULES, normalizeText } from '../config/index.js';

function includesAnyKeyword(text, keywords) {
  const normText = normalizeText(text);
  if (!normText || !Array.isArray(keywords)) return false;
  return keywords.some((kw) => {
    const normKw = normalizeText(kw);
    return normKw && normText.includes(normKw);
  });
}

function detectHighFloor(rawText) {
  const norm = normalizeText(rawText);
  if (!norm) return null;

  if (/\b(high floor|upper floor|tang cao|lau cao|sky floor)\b/.test(norm)) {
    return 'High floor / Tầng cao';
  }

  // Match "tầng 12", "lầu 8", "floor 15"
  const prefixMatch = norm.match(/\b(?:tang|lau|floor)\s*(\d{1,3})\b/);
  if (prefixMatch) {
    const floorNum = parseInt(prefixMatch[1], 10);
    if (floorNum >= 4) return `Tầng ${floorNum}`;
  }

  // Match "15th floor", "4th floor", "22nd floor", "23rd floor", "21st floor"
  const suffixMatch = norm.match(/\b(\d{1,3})(?:st|nd|rd|th)\s*floor\b/);
  if (suffixMatch) {
    const floorNum = parseInt(suffixMatch[1], 10);
    if (floorNum >= 4) return `Floor ${floorNum}`;
  }

  return null;
}

function detectBuildingOrProjectSignal(title, description, rules) {
  const rawCombined = `${title} ${description}`;
  const normCombined = normalizeText(rawCombined);

  // Check capitalized project/tower regex in original text
  const projectRegex =
    /\b((?:The\s+)?[A-Z0-9][A-Za-z0-9'&-]+(?:\s+[A-Z0-9][A-Za-z0-9'&-]+){0,3}\s+(?:Tower|Towers|Residence|Residences|Center|Plaza|Heights|Park|Condo|Condominium|Suites|Landmark|View|Garden|Gardens))\b/;
  const regexMatch = rawCombined.match(projectRegex);
  if (regexMatch) {
    return regexMatch[1].trim();
  }

  // Check known project names & building title keywords
  const allBuildingKeywords = [
    ...(rules.projectNameKeywords || []),
    ...(rules.buildingTitleKeywords || []),
  ];
  for (const kw of allBuildingKeywords) {
    const normKw = normalizeText(kw);
    if (normKw && normCombined.includes(normKw)) {
      return kw;
    }
  }

  return '';
}

function resolveRules(customRules) {
  if (!customRules) return CLASSIFICATION_RULES;

  const elevatorKeywords =
    Array.isArray(customRules.mandatory) && customRules.mandatory.length > 0
      ? customRules.mandatory
      : CLASSIFICATION_RULES.elevatorKeywords;

  const excludedPropertyKeywords =
    Array.isArray(customRules.excluded) && customRules.excluded.length > 0
      ? customRules.excluded
      : CLASSIFICATION_RULES.excludedPropertyKeywords;

  let complexAmenities = CLASSIFICATION_RULES.complexAmenities;
  if (Array.isArray(customRules.bonus) && customRules.bonus.length > 0) {
    complexAmenities = customRules.bonus.map((kw) => ({
      label: kw,
      keywords: [kw],
    }));
  }

  return {
    ...CLASSIFICATION_RULES,
    elevatorKeywords,
    excludedPropertyKeywords,
    complexAmenities,
  };
}

/**
 * Multi-Criteria Scoring System for High-Rise Condo classification ("YES" if score >= 4, else "NO").
 * No single keyword (like elevator) is mandatory on its own.
 */
export function classifyHighRiseCondo({
  amenities = [],
  unavailableAmenities = [],
  propertyType = '',
  description = '',
  title = '',
  rules = null,
}) {
  const activeRules = resolveRules(rules);
  const normAmenities = amenities.map((a) => normalizeText(a));
  const normUnavailable = unavailableAmenities.map((a) => normalizeText(a));
  const combinedText = `${title} ${propertyType} ${description}`;
  const propertyAndTitleText = `${title} ${propertyType}`;

  // 1. Nhóm C — Hard Exclusions -> "NO" immediately
  if (includesAnyKeyword(propertyAndTitleText, activeRules.excludedPropertyKeywords)) {
    return {
      isHighRise: 'NO',
      score: 0,
      matchedAmenities: [],
      reason: `Loại trừ cứng theo loại hình: ${propertyType || title}`,
    };
  }

  const hasGroundHouseText = includesAnyKeyword(combinedText, [
    'nhà nguyên căn mặt đất',
    'hẻm xe máy',
    'entire house',
    'townhouse',
    'villa',
    'bungalow',
  ]);
  if (hasGroundHouseText) {
    return {
      isHighRise: 'NO',
      score: 0,
      matchedAmenities: [],
      reason: 'Loại trừ cứng: Mô tả thuộc nhà thấp tầng / mặt đất',
    };
  }

  const hasNoElevatorSignal =
    normAmenities.some((a) => includesAnyKeyword(a, activeRules.noElevatorKeywords)) ||
    includesAnyKeyword(combinedText, activeRules.noElevatorKeywords) ||
    normUnavailable.some((a) => includesAnyKeyword(a, activeRules.elevatorKeywords));

  if (hasNoElevatorSignal) {
    return {
      isHighRise: 'NO',
      score: 0,
      matchedAmenities: [],
      reason: 'Loại trừ cứng: Không có thang máy / Chỉ có cầu thang bộ',
    };
  }

  // 2. Multi-Criteria Scoring Engine
  let score = 0;
  const scoreBreakdown = [];
  const matchedAmenities = [];

  // (+3) Property Type belongs to Condo / Rental Unit / Serviced Apartment / Loft / Căn hộ
  const isCondoPropertyType = includesAnyKeyword(
    propertyAndTitleText,
    activeRules.condoPropertyKeywords
  );
  if (isCondoPropertyType) {
    score += 3;
    scoreBreakdown.push(`Loại hình ${propertyType || 'Condo/Căn hộ'} (+3)`);
  }

  // (+3) Elevator keyword present in amenities or text
  const hasElevator =
    normAmenities.some((a) => includesAnyKeyword(a, activeRules.elevatorKeywords)) ||
    includesAnyKeyword(combinedText, activeRules.elevatorKeywords);
  if (hasElevator) {
    score += 3;
    matchedAmenities.push('Thang máy');
    scoreBreakdown.push('Thang máy (+3)');
  }

  // (+2) High-rise / Tower / Residence keywords or detected project/building name
  const buildingSignal = detectBuildingOrProjectSignal(title, description, activeRules);
  if (buildingSignal) {
    score += 2;
    scoreBreakdown.push(`Tên tòa/cao tầng "${buildingSignal}" (+2)`);
  }

  // (+2) High floor detected (floor >= 4, "tầng 12", "15th floor", "high floor")
  const floorSignal = detectHighFloor(combinedText);
  if (floorSignal) {
    score += 2;
    scoreBreakdown.push(`${floorSignal} (+2)`);
  }

  // (+1 each) Complex amenities in AMENITIES_DEFAULT
  for (const rule of activeRules.complexAmenities) {
    const matched = normAmenities.some((a) => {
      if (rule.excludeIfIncludes && includesAnyKeyword(a, rule.excludeIfIncludes)) {
        return false;
      }
      return includesAnyKeyword(a, rule.keywords);
    });
    if (matched) {
      score += 1;
      matchedAmenities.push(rule.label);
      scoreBreakdown.push(`${rule.label} (+1)`);
    }
  }

  // 3. Decision Threshold: score >= 4 => "YES", else "NO"
  if (score >= 4) {
    return {
      isHighRise: 'YES',
      score,
      matchedAmenities,
      reason: `Đạt ${score}đ: ${scoreBreakdown.join(', ')}`,
    };
  }

  return {
    isHighRise: 'NO',
    score,
    matchedAmenities,
    reason:
      scoreBreakdown.length > 0
        ? `Không đạt (${score}đ < 4đ): ${scoreBreakdown.join(', ')}`
        : `Không đạt (0đ < 4đ): Thiếu tín hiệu chung cư cao tầng`,
  };
}
