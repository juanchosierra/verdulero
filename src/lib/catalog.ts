export type StoreConfigLike = {
  wcUrl?: string | null;
  wcConsumerKey?: string | null;
  wcConsumerSecret?: string | null;
};

export type CatalogProduct = {
  id: number;
  name: string;
  price: number;
  stock_status: string;
  image?: string | null;
  unit: string;
};

export type CatalogMeasureProfile = {
  unit: string;
  unitLabel: string;
  wholeOnly: boolean;
  step: number;
};

const SNAPSHOT_TTL_MS = 60 * 1000;
const snapshotCache = new Map<string, { expiresAt: number; data: CatalogProduct[] }>();
const PRODUCT_SEARCH_ALIASES: Record<string, string[]> = {
  aguacates: ["aguacate", "aguacate hass"],
  cebollas: ["cebolla"],
  zanahorias: ["zanahoria"],
  papas: ["papa"],
  tomates: ["tomate"],
  limones: ["limon"],
  pinas: ["piña", "pina"],
  piñas: ["piña", "pina"],
  champinones: ["champiñon", "champiñon"],
  champiñones: ["champiñon", "champiñon"],
  uchuvas: ["uchuvas con cascara"],
  cebolla_cabezona: ["cebolla cabezona blanca"],
  cebollas_cabezonas: ["cebolla cabezona blanca"],
  cebolla_roja: ["cebolla roja pelada"],
  cebolla_morada: ["cebolla roja pelada"],
  cebollin: ["cebolla larga pelada"],
  cebollín: ["cebolla larga pelada"],
  cebolla_junca: ["cebolla larga pelada"],
  cebolla_de_rama: ["cebolla larga pelada"],
  silantro: ["cilantro", "cilantro completo"],
  cilantro_completo: ["cilantro completo"],
  sanaoria: ["zanahoria"],
  sanahoria: ["zanahoria"],
  peregil: ["perejil", "perejil liso completo"],
  perejil_liso: ["perejil liso completo"],
  tomte: ["tomate"],
  chonto: ["tomate chonto"],
  tomate_chont: ["tomate chonto"],
  tomate_larga_vida: ["tomate chonto"],
  tomate_milano: ["tomate chonto"],
  zapallo: ["ahuyama"],
  calabaza: ["ahuyama"],
  victoria: ["ahuyama"],
  calabacin: ["zukini verde"],
  calabacin_verde: ["zukini verde"],
  pimenton_verde: ["pimenton rojo"],
  pimenton_amarillo: ["pimenton rojo"],
  pimientos_verdes: ["pimenton rojo"],
  pimientos_amarillos: ["pimenton rojo"]
};

export function stripDiacritics(raw: string) {
  return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeUnitCode(raw: unknown): string {
  const value = stripDiacritics(String(raw || "").toLowerCase().trim());
  if (!value) return "";
  if (/(^|\b)(kg|kilo|kilos)($|\b)/.test(value)) return "kg";
  if (/(^|\b)(lb|lbr|libra|libras|livra|livras)($|\b)/.test(value)) return "lb";
  if (/(^|\b)(und|unidad|unidades|botella|botellas|frasco|frascos)($|\b)/.test(value)) return "und";
  if (/(^|\b)(carton|cartones)($|\b)/.test(value)) return "carton";
  if (/(^|\b)(bidon|bidones)($|\b)/.test(value)) return "bidon";
  if (/(^|\b)(canastilla|canastillas)($|\b)/.test(value)) return "canastilla";
  if (/(^|\b)(lt|lts|litro|litros)($|\b)/.test(value)) return "lts";
  if (/(^|\b)(bja|bandeja|bandejas)($|\b)/.test(value)) return "bja";
  if (/(^|\b)(atado|atados|atdo|atdos|rama|ramas|ramo|ramos)($|\b)/.test(value)) return "atado";
  return "";
}

export function isPackagedVolumeUnitProduct(productName: string | null | undefined) {
  const normalized = stripDiacritics(String(productName || "").toLowerCase());
  if (!/\b(zumo|jugo)\b/.test(normalized)) return false;
  return /\b(?:x\s*)?(?:4|cuatro)\s*(?:l|lt|lts|litro|litros)\b/.test(normalized);
}

export function catalogUnitForProduct(productName: string | null | undefined, unit: string | null | undefined) {
  if (isPackagedVolumeUnitProduct(productName)) return "und";
  return normalizeUnitCode(unit) || unit || "und";
}

export function unitLabel(unit: string) {
  const normalized = normalizeUnitCode(unit) || unit;
  if (normalized === "lb") return "libra(s)";
  if (normalized === "kg") return "kilo(s)";
  if (normalized === "und") return "unidad(es)";
  if (normalized === "carton") return "cartón(es)";
  if (normalized === "bidon") return "bidón(es)";
  if (normalized === "canastilla") return "canastilla(s)";
  if (normalized === "lts") return "litro(s)";
  if (normalized === "bja") return "bandeja(s)";
  if (normalized === "atado") return "atado(s)";
  return normalized || "unidad(es)";
}

export function getCatalogMeasureProfile(unit: string): CatalogMeasureProfile {
  const normalized = normalizeUnitCode(unit) || "und";
  const wholeOnly = !["kg", "lts"].includes(normalized);
  return {
    unit: normalized,
    unitLabel: unitLabel(normalized),
    wholeOnly,
    step: wholeOnly ? 1 : 0.5
  };
}

export function allowsFractionalQuantity(unit: string) {
  return !getCatalogMeasureProfile(unit).wholeOnly;
}

export function isValidQuantityForUnit(quantity: number, unit: string) {
  const profile = getCatalogMeasureProfile(unit);
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (profile.wholeOnly) return Number.isInteger(quantity);
  const scaled = quantity / profile.step;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

export function cleanSearchTerm(raw: string) {
  return raw
    .toLowerCase()
    .replace(/\b(por favor|porfa|gracias|porfis|quiero|me regalas|deme|dame|necesito|ponme|pongame|póngame|agregame|agrégame|agrega|anotame|anótame|anota|si|sí|ok|dale)\b/g, " ")
    .replace(/[^a-z0-9áéíóúñü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForMatch(raw: string) {
  return stripDiacritics(cleanSearchTerm(raw));
}

function aliasKey(raw: string) {
  return normalizeForMatch(raw).replace(/\s+/g, "_");
}

export function singularizeSpanishToken(token: string) {
  const normalized = normalizeForMatch(token);
  if (normalized.length <= 3) return normalized;

  if (normalized.endsWith("ces")) return `${normalized.slice(0, -3)}z`;

  // Plurals like "tomates" and "aguacates" come from singulars ending in "e".
  // Removing "es" would produce "tomat"/"aguacat"; only trim the final "s".
  if (/(ates|etes|ites|otes|utes)$/.test(normalized)) {
    return normalized.slice(0, -1);
  }

  if (normalized.endsWith("es") && normalized.length > 4) {
    const beforeEs = normalized.slice(0, -2);
    if (!/[aeiou]$/.test(beforeEs)) return beforeEs;
  }
  if (normalized.endsWith("s") && normalized.length > 3) {
    const withoutS = normalized.slice(0, -1);
    if (/[aeiou]$/.test(withoutS)) return withoutS;
  }
  if (normalized.endsWith("s") && normalized.length > 3) return normalized.slice(0, -1);
  return normalized;
}

export function tokenizeForMatch(raw: string) {
  return normalizeForMatch(raw)
    .split(" ")
    .filter(Boolean)
    .map((t) => t.replace(/^(kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos|de|el|la|los|las|marca|tipo|ref|referencia|x)$/i, ""))
    .filter((t) => t.length > 1)
    .filter(Boolean);
}

function hasTokenMatch(productName: string, queryTokens: string[]) {
  const productTokens = tokenizeForMatch(productName);
  const productStems = productTokens.map(singularizeSpanishToken);
  const queryStems = queryTokens.map(singularizeSpanishToken);
  return queryStems.some((q) => productStems.some((p) => p === q));
}

function productMatchScore(productName: string, term: string) {
  const query = normalizeForMatch(term);
  const queryTokens = tokenizeForMatch(term);
  const queryStems = queryTokens.map(singularizeSpanishToken);
  const productNormalized = normalizeForMatch(productName);
  const productTokens = tokenizeForMatch(productName);
  const productStems = productTokens.map(singularizeSpanishToken);
  const matchedQueryStems = queryStems.filter((token) => productStems.some((p) => p === token));
  const matchedCount = matchedQueryStems.length;
  const coverage = queryStems.length > 0 ? matchedCount / queryStems.length : 0;
  const exactPhrase = productNormalized === query;
  const containsPhrase = query.length > 0 && new RegExp(`(^|\\s)${query}(\\s|$)`).test(productNormalized);

  let score = 0;
  if (exactPhrase) score += 1000;
  if (containsPhrase) score += 400;
  score += matchedCount * 90;
  if (coverage === 1) score += 280;
  if (queryTokens.length === 1 && matchedCount === 1) score += 120;
  if (productTokens.length === queryTokens.length) score += 30;
  if (productTokens.length > queryTokens.length) score -= (productTokens.length - queryTokens.length) * 6;
  return { score, exactPhrase, containsPhrase, matchedCount, coverage };
}

export function isStrongProductMatch(productName: string, term: string) {
  const queryTokens = tokenizeForMatch(term);
  if (queryTokens.length === 0) return false;
  const match = productMatchScore(productName, term);
  if (match.exactPhrase || match.containsPhrase) return true;
  if (queryTokens.length === 1) return match.matchedCount >= 1;
  return match.coverage === 1;
}

export function dedupeVisibleProducts<T extends { name: string; price: number; unit?: string }>(products: T[]) {
  const unique = new Map<string, T>();
  for (const product of products) {
    const key = `${normalizeForMatch(product.name)}::${Number(product.price || 0)}::${product.unit || "und"}`;
    if (!unique.has(key)) unique.set(key, product);
  }
  return Array.from(unique.values());
}

function storeBaseUrl(config?: StoreConfigLike) {
  return (config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co").replace(/\/+$/, "");
}

function decodeHtml(raw: string) {
  return raw
    .replace(/&#0?36;/g, "$")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(raw: string) {
  return decodeHtml(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractUnitFromStoreProduct(product: any): string {
  const candidates = [
    product?.price_html,
    product?.short_description,
    product?.description,
    product?.add_to_cart?.description
  ]
    .map((value) => stripHtml(String(value || "")))
    .filter(Boolean);

  for (const text of candidates) {
    const slashMatch = text.match(/\/\s*(kg|kilos?|lb|libras?|und|unidades?|carton|cartones|bidon|bidones|canastilla|canastillas|lt|lts|litros?|bja|bandejas?|atado|atados)\b/i);
    if (slashMatch?.[1]) {
      const normalized = normalizeUnitCode(slashMatch[1]);
      if (normalized) return normalized;
    }
    const normalized = normalizeUnitCode(text);
    if (normalized) return normalized;
  }

  return "";
}

async function fetchStoreApiProducts(config: StoreConfigLike | undefined, page: number) {
  const url = new URL(`${storeBaseUrl(config)}/wp-json/wc/store/v1/products`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "100");
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 }
  });
  if (!response.ok) {
    throw new Error(`Store API error ${response.status}`);
  }
  return await response.json();
}

function extractUnitFromWooProduct(product: any): string {
  const meta = Array.isArray(product?.meta_data) ? product.meta_data : [];
  const supportedMetaKeys = new Set([
    "_unit_measure",
    "unit_measure",
    "_unit",
    "unit",
    "_product_unit",
    "product_unit",
    "_tipo_unidad",
    "tipo_unidad",
    "_medida",
    "medida",
    "_unidad",
    "unidad"
  ]);
  for (const entry of meta) {
    const key = stripDiacritics(String(entry?.key || "").toLowerCase());
    if (supportedMetaKeys.has(key)) {
      const normalized = normalizeUnitCode(entry?.value);
      if (normalized) return normalized;
    }
  }
  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
  for (const attr of attributes) {
    const attrName = stripDiacritics(String(attr?.name || "").toLowerCase());
    if (!/(unidad|medida|presentacion|presentación|peso|venta)/.test(attrName)) continue;
    const options = Array.isArray(attr?.options) ? attr.options : [];
    for (const option of options) {
      const normalized = normalizeUnitCode(option);
      if (normalized) return normalized;
    }
  }
  return "";
}

function mapWooProduct(product: any): CatalogProduct {
  const rawUnit = extractUnitFromWooProduct(product) || extractUnitFromStoreProduct(product) || "und";
  return {
    id: product.id,
    name: product.name,
    price: parseFloat(product?.prices?.regular_price || product?.regular_price || product?.prices?.price || product?.price || 0),
    stock_status: product?.stock_status || (product?.is_in_stock ? "instock" : "outofstock"),
    image: product.images?.[0]?.src || null,
    unit: catalogUnitForProduct(product.name, rawUnit)
  };
}

function cacheKeyForConfig(config?: StoreConfigLike) {
  return config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "default";
}

export async function fetchCatalogSnapshot(config?: StoreConfigLike, forceRefresh = false): Promise<CatalogProduct[]> {
  const key = cacheKeyForConfig(config);
  const cached = snapshotCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.data;

  const merged: any[] = [];
  const seen = new Set<number>();
  for (const page of [1, 2, 3]) {
    const data = await fetchStoreApiProducts(config, page);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;
    for (const p of rows) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
    if (rows.length < 100) break;
  }

  const snapshot = dedupeVisibleProducts(merged.map(mapWooProduct));
  snapshotCache.set(key, { expiresAt: Date.now() + SNAPSHOT_TTL_MS, data: snapshot });
  return snapshot;
}

export function searchCatalogProducts(snapshot: CatalogProduct[], term: string, limit = 24): CatalogProduct[] {
  const normalized = normalizeForMatch(term);
  const queryTokens = tokenizeForMatch(term);
  if (!normalized && queryTokens.length === 0) return snapshot.slice(0, limit);

  const candidates = Array.from(new Set([term, ...productCandidates(term)]));
  const ranked = snapshot
    .map((product) => {
      let bestScore = -1;
      let matched = false;

      for (const candidate of candidates) {
        const score = productMatchScore(product.name, candidate).score;
        if (score > bestScore) bestScore = score;
        if (isStrongProductMatch(product.name, candidate) || hasTokenMatch(product.name, tokenizeForMatch(candidate))) {
          matched = true;
        }
      }

      return { product, bestScore, matched };
    })
    .filter((entry) => entry.matched && entry.bestScore > 0)
    .sort((a, b) => b.bestScore - a.bestScore)
    .map((entry) => entry.product);

  return dedupeVisibleProducts(ranked).slice(0, limit);
}

export function pickBestCatalogProduct(products: CatalogProduct[], term: string): CatalogProduct | null {
  if (products.length === 0) return null;
  const sorted = [...products].sort((a, b) => productMatchScore(b.name, term).score - productMatchScore(a.name, term).score);
  return sorted[0] || null;
}

export function productCandidates(raw: string) {
  const cleaned = cleanSearchTerm(raw);
  const normalized = normalizeForMatch(raw);
  const candidates = new Set<string>();
  const add = (v: string) => {
    const t = v.trim();
    if (t.length >= 2) candidates.add(t);
  };
  add(raw);
  add(cleaned);
  add(normalized);
  const cleanedTokens = cleaned.split(" ").filter(Boolean);
  const normalizedTokens = normalized.split(" ").filter(Boolean);
  if (cleanedTokens.length > 0) {
    const singularCleaned = cleanedTokens.map(singularizeSpanishToken).join(" ");
    add(singularCleaned);
  }
  if (normalizedTokens.length > 0) {
    const singularNormalized = normalizedTokens.map(singularizeSpanishToken).join(" ");
    add(singularNormalized);
  }
  if (cleanedTokens.length > 1) {
    const lastSingular = [...cleanedTokens];
    lastSingular[lastSingular.length - 1] = singularizeSpanishToken(lastSingular[lastSingular.length - 1]);
    add(lastSingular.join(" "));
  }
  if (normalizedTokens.length > 1) {
    const lastSingular = [...normalizedTokens];
    lastSingular[lastSingular.length - 1] = singularizeSpanishToken(lastSingular[lastSingular.length - 1]);
    add(lastSingular.join(" "));
  }
  for (const key of Array.from(candidates).map(aliasKey)) {
    const aliases = PRODUCT_SEARCH_ALIASES[key] || [];
    for (const alias of aliases) add(alias);
  }
  return Array.from(candidates);
}

export function invalidateCatalogSnapshot(config?: StoreConfigLike) {
  snapshotCache.delete(cacheKeyForConfig(config));
}
