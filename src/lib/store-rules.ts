export type CityRule = {
  value: string;
  label: string;
  enabled: boolean;
  shipping: number;
};

export type ShippingConfigLike = {
  ciudadesOperacion?: string | null;
  envioGratisDesde?: number | null;
  pedidoMinimo?: number | null;
};

export const DEFAULT_FREE_SHIPPING_THRESHOLD = 69900;
export const DEFAULT_CITY_SHIPPING = 10000;
export const DEFAULT_MINIMUM_ORDER = 0;

export const DEFAULT_CITY_RULES: CityRule[] = [
  { value: "bucaramanga", label: "Bucaramanga", enabled: true, shipping: DEFAULT_CITY_SHIPPING },
  { value: "floridablanca", label: "Floridablanca", enabled: true, shipping: DEFAULT_CITY_SHIPPING },
  { value: "giron", label: "Girón", enabled: true, shipping: DEFAULT_CITY_SHIPPING },
  { value: "piedecuesta", label: "Piedecuesta", enabled: true, shipping: DEFAULT_CITY_SHIPPING },
  { value: "ruitoque", label: "Ruitoque", enabled: true, shipping: DEFAULT_CITY_SHIPPING }
];

export function normalizeCityValue(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function safeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCityRule(input: Partial<CityRule> | null | undefined): CityRule | null {
  const value = normalizeCityValue(input?.value || input?.label || "");
  const label = String(input?.label || "").trim();
  if (!value || !label) return null;

  return {
    value,
    label,
    enabled: input?.enabled !== false,
    shipping: Math.max(0, safeNumber(input?.shipping, DEFAULT_CITY_SHIPPING))
  };
}

export function parseCityRules(raw?: string | CityRule[] | null): CityRule[] {
  const fallback = DEFAULT_CITY_RULES.map((city) => ({ ...city }));
  const source = Array.isArray(raw)
    ? raw
    : (() => {
        try {
          const parsed = JSON.parse(String(raw || "[]"));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  if (!source.length) return fallback;

  const rules = source
    .map((item) => normalizeCityRule(item))
    .filter((item): item is CityRule => Boolean(item));

  return rules.length ? rules : fallback;
}

export function serializeCityRules(rules?: CityRule[] | null) {
  return JSON.stringify(parseCityRules(rules || DEFAULT_CITY_RULES));
}

export function getActiveCityRules(raw?: string | CityRule[] | null) {
  return parseCityRules(raw).filter((city) => city.enabled);
}

export function cityLabelFromValue(value: string | null | undefined, raw?: string | CityRule[] | null) {
  const normalized = normalizeCityValue(value);
  const match = parseCityRules(raw).find((city) => city.value === normalized);
  return match?.label || String(value || "").trim();
}

export function findCityRule(value: string | null | undefined, raw?: string | CityRule[] | null) {
  const normalized = normalizeCityValue(value);
  return parseCityRules(raw).find((city) => city.value === normalized) || null;
}

export function isCityEnabled(value: string | null | undefined, raw?: string | CityRule[] | null) {
  const rule = findCityRule(value, raw);
  return Boolean(rule?.enabled);
}

export function resolveShippingFeeForCity(value: string | null | undefined, raw?: string | CityRule[] | null) {
  const rule = findCityRule(value, raw);
  if (!rule?.enabled) return null;
  return rule.shipping;
}

export function freeShippingThreshold(config?: ShippingConfigLike | null) {
  return Math.max(0, safeNumber(config?.envioGratisDesde, DEFAULT_FREE_SHIPPING_THRESHOLD));
}

export function minimumOrderThreshold(config?: ShippingConfigLike | null) {
  return Math.max(0, safeNumber(config?.pedidoMinimo, DEFAULT_MINIMUM_ORDER));
}

export function calculateShippingAmount(
  subtotal: number,
  cityValue: string | null | undefined,
  config?: ShippingConfigLike | null
) {
  const threshold = freeShippingThreshold(config);
  if (subtotal >= threshold) return 0;
  const fee = resolveShippingFeeForCity(cityValue, config?.ciudadesOperacion);
  return fee ?? DEFAULT_CITY_SHIPPING;
}

export function buildCoverageLabel(raw?: string | CityRule[] | null) {
  const labels = getActiveCityRules(raw).map((city) => city.label);
  if (!labels.length) return "Sin ciudades activas configuradas";
  return `Cobertura ${labels.join(", ")}`;
}
