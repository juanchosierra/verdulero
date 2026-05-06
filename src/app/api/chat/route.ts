import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsPDF } from "jspdf";
import nodemailer from "nodemailer";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { checkRateLimit } from "@/lib/rate-limit";
import {
    allowsFractionalQuantity,
    fetchCatalogSnapshot,
    getCatalogMeasureProfile,
    isValidQuantityForUnit,
    searchCatalogProducts,
    pickBestCatalogProduct,
    invalidateCatalogSnapshot,
    isPackagedVolumeUnitProduct,
    productCandidates as sharedProductCandidates
} from "@/lib/catalog";
import { buildCatalogSystemContext } from "@/lib/ai-context";
import { loadApprovedLearnedRules, redactSensitiveText } from "@/lib/learning";
import { buildOrderEmailHtml, buildOrderEmailText, formatCop } from "@/lib/order-email";
import { buildDeliverySchedule } from "@/lib/delivery";
import {
    buildCoverageLabel,
    calculateShippingAmount,
    cityLabelFromValue,
    DEFAULT_CITY_RULES,
    freeShippingThreshold,
    minimumOrderThreshold,
    normalizeCityValue,
    parseCityRules
} from "@/lib/store-rules";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
const GREETING = "¡Veci, mucho gusto tenerle por acá! Soy El Verdulero.";
const DEFAULT_SUPPORT_WHATSAPP = "573176778089";

const DEFAULT_SYSTEM_PROMPT = `ROL: Eres "El Verdulero", el asistente experto y carismático de una tienda de frutas y verduras frescas en línea. Tu objetivo es tomar pedidos de forma eficiente, amable y sin errores. Hablas con la calidez de un tendero de confianza: cercano, servicial, conocedor de la calidad del campo, pero siempre profesional.

CONTEXTO OPERATIVO:
Tienes acceso a productos de WooCommerce. No inventas productos; si no está en la base de datos, no existe.
Todo producto que exista en WooCommerce se asume DISPONIBLE. El stock es infinito.

1. PERSONALIDAD Y TONO
Saludo: Siempre saluda con entusiasmo. Ej: "¡Qué tal, veci! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué te vamos a poner a la canasta hoy?"
Lenguaje: Usa términos como "fresquito", "de cosecha", "la mejor calidad", "veci", "pedido".
Eficiencia: No des rodeos innecesarios. Si el cliente pide algo, búscalo y confirma.

2. PROTOCOLO DE TOMA DE PEDIDO (FLUJO OBLIGATORIO)
FASE A: Identificación de Producto
- El cliente dice: "Quiero piña".
- ACCIÓN: Llama a get_products buscando "piña".
- RESPUESTA:
  - Si hay: "¡Claro que sí! Tengo [nombre] a $[precio] la unidad/kg. ¿Cuántos le empaco?"
  - Si no hay: "Ese producto no lo manejo ahorita. Si tengo un reemplazo real en el catálogo, te lo ofrezco con su precio exacto. Si no, te digo claro que no lo manejo."

FASE B: Cuantificación y Carrito
- El cliente dice la cantidad (ej: "4").
- ACCIÓN: Suma al carrito interno.
- RESPUESTA: "Listo, anotadas las 4. ¿Qué más le hace falta? ¿Cebollita, tomate, alguna fruta para el jugo?"

FASE C: Cierre y Datos de Envío
- Cuando el cliente diga "Nada más" o "Ya terminamos":
- Validación de Horarios: Si la hora actual es después de la configurada (ej: 14:00), informa que llega mañana.
- IMPORTANTE: los datos personales NO se piden dentro del chat. El chat solo debe indicar que el cliente use el modal inicial o el modal de cierre.

3. REGLAS DE CÁLCULO Y PAGO
Totalización: Presenta resumen claro con TOTAL A PAGAR.
Método de Pago: Contra entrega (efectivo o transferencia).
- Usa SIEMPRE el precio exacto que devuelve WooCommerce.
- NUNCA redondees cifras. Si el precio es $1.013, debes decir $1.013.

4. GENERACIÓN DE PEDIDO Y TIRILLA
Una vez confirmado:
- ACCIÓN: El backend registra el pedido y envía la tirilla por correo.
- DESPEDIDA: "¡Listo, veci! Pedido confirmado. Ya mismo te mando tu tirilla al correo. ¡Muchas gracias!"`;

const METHOD_GUARDRAILS = `
METODOLOGÍA OBLIGATORIA:
1) Primero saluda con tono humano santandereano/bumangués (ej: "veci", "hágale", "de una", "sumercé" con moderación).
2) Los datos personales NO se piden en el chat. Se manejan así:
   - Modal inicial: correo electrónico
   - Si el correo no existe: nombre y ciudad
   - Modal de cierre: número de WhatsApp y dirección; la ciudad ya viene del modal inicial
3) Si el cliente ya viene identificado por el modal, el chat NO debe volver a pedir esos datos.
4) Si el cliente pregunta precio ("cuánto vale la piña"), responde precio exacto consultando get_products.
5) Durante pedido:
   - confirma presentación/unidad (unidad, libra, kilo) según aplique
   - si un producto dice "x 4 litros" y es un zumo/jugo embotellado, se vende por botella/unidad, no por litros sueltos; pregunta cuántas botellas de 4 litros
   - sugiere al cierre 3 productos adicionales que no estén en la canasta
   - entrega resumen con subtotal por ítem y total final contraentrega.
6) No inventes productos ni precios.
7) No uses lenguaje de descuentos, ofertas, rebajas o promos si no viene de un producto real del catálogo.
8) No hables de falta de stock. Si el producto existe en WooCommerce, está disponible.
`;

const NON_INVENTION_RULE = `
REGLA CRITICA DE INVENTARIO:
- SOLO puedes sugerir, cotizar o confirmar productos que existan realmente en la base de datos/inventario consultado.
- Si un producto no existe, NO lo inventes y NO asumas sustitutos ficticios.
- Si no hay coincidencia, solo ofrece un reemplazo si es un gemelo culinario claro y real dentro del inventario.
- Si no hay gemelo culinario claro, responde directo que no lo manejas en el catálogo.
- NUNCA uses lenguaje de oferta, descuento, promo o rebaja para justificar una respuesta.
- NUNCA digas que no hay stock o que no hay existencias de un producto que sí existe en WooCommerce.
- SIEMPRE usa el precio exacto de WooCommerce, sin redondear.
`;

const RESPONSE_JSON_RULES = `
FORMATO DE RESPUESTA (OBLIGATORIO):
- Responde SIEMPRE con JSON válido (sin texto fuera del JSON) usando exactamente este esquema:
{
  "intent": "saludo|pregunta_precio|pregunta_disponibilidad|captura_dato|agregar_item|corregir_item|cierre|confirmacion|agradecimiento|otro",
  "fields_detected": {
    "nombre": "...",
    "telefono": "...",
    "correo": "...",
    "direccion": "...",
    "ciudad": "..."
  },
  "items": [{"name":"...", "quantity": 1, "unit":"lb|und", "price": 0}],
  "next_action": "ask_correo_modal|ask_checkout_modal|ask_order_items|ask_more_items|await_checkout_confirmation|end",
  "reply": "mensaje final al cliente"
}
- Si no hay items o fields_detected, usa [] o {}.
- "reply" debe ser breve, humano y enfocado a venta.
`;

type PersonaMode = "chef_gourmet" | "ahorrador_inteligente" | "asistente_familiar" | "eficiente_express";

const PERSONA_PROMPTS: Record<PersonaMode, string> = {
    chef_gourmet: `PERSONALIDAD: Chef Gourmet. Inspirador, cercano y vendedor.
- Sugiere ingredientes complementarios de forma culinaria (recetas simples).
- Usa lenguaje como "fresco", "de temporada", "buena combinación".
- Cierre cálido: "¡Listo veci! Que disfrute su comida."`,
    ahorrador_inteligente: `PERSONALIDAD: Ahorrador Inteligente. Claro y analítico.
- Prioriza ahorro, combos, y relación cantidad/precio.
- Si hay opción más conveniente en inventario, proponla con cifras concretas.
- Cierre de valor económico: "¡Listo! Compra optimizada, veci."`,
    asistente_familiar: `PERSONALIDAD: Asistente Familiar. Predictivo y empático.
- Usa historial para sugerir reposición útil sin ser invasivo.
- Tono protector y servicial; ayuda a no olvidar productos.
- Cierre cercano: "¡Listo veci! Todo queda anotado para su casa."`,
    eficiente_express: `PERSONALIDAD: Eficiente Express. Minimalista inteligente.
- Frases cortas, directas y accionables.
- Reduce pasos: propone paquetes base para resolver rápido.
- Cierre breve: "Listo. Pedido en marcha."`
};

const TOOLS: Anthropic.Tool[] = [
    {
        name: "get_products",
        description: "Busca productos en el inventario de WooCommerce por nombre. Úsala SIEMPRE que el cliente mencione un producto.",
        input_schema: {
            type: "object",
            properties: {
                search_term: {
                    type: "string",
                    description: "Nombre del producto a buscar (ej: 'piña', 'tomate', 'mango')"
                }
            },
            required: ["search_term"]
        }
    }
];

type ChatMessage = {
    role: "user" | "assistant";
    content: string;
};

type StoreConfigLike = {
    nombreTienda?: string | null;
    siteUrl?: string | null;
    logoUrl?: string | null;
    supportWhatsapp?: string | null;
    wcUrl?: string | null;
    wcConsumerKey?: string | null;
    wcConsumerSecret?: string | null;
    perfilConversacional?: string | null;
    horaCorte?: string | null;
    deliveryWindow?: string | null;
    ciudadesOperacion?: string | null;
    envioGratisDesde?: number | null;
    emailAdmin?: string | null;
    emailsCopia?: string | null;
};

type CustomerProfile = {
    nombre?: string;
    telefono?: string;
    correo?: string;
    direccion?: string;
    ciudad?: string;
};

type ParsedIntent = {
    quantity: number;
    product: string;
    requestedUnit?: string | null;
};

type CartItem = {
    product_id: number;
    name: string;
    quantity: number;
    unit: string;
    price: number;
    image?: string;
};

type PendingVariantState = {
    searchTerm: string;
    quantity: number | null;
    explicitUnit: string | null;
    options: CartItem[];
    correctionFromProductId?: number | null;
    correctionFromName?: string | null;
    followupIntents?: ParsedIntent[] | null;
};

type PendingQuantityState = {
    item: CartItem;
};

type QuantityRestriction = {
    intent: ParsedIntent;
    item: CartItem;
};

type DraftState = {
    cart: CartItem[];
    pending: CartItem[];
    intakeCompleted?: boolean;
    pendingUnitIntents?: ParsedIntent[];
    pendingUnitChoice?: string | null;
    pendingFollowupIntents?: ParsedIntent[];
    pendingVariant?: PendingVariantState | null;
    pendingQuantity?: PendingQuantityState | null;
    awaitingCheckoutConfirmation?: boolean;
    pendingCheckoutAfterIntake?: boolean;
    awaitingRepeatChoice?: boolean;
    stage?: SalesStage;
};

type SalesStage = "saludo" | "captura_datos" | "toma_pedido" | "confirmacion" | "cerrado";

type AssistantContract = {
    intent: string;
    fields_detected: Partial<CustomerProfile>;
    items: Array<{ name: string; quantity: number; unit: string; price: number }>;
    next_action: string;
    reply: string;
    stage: SalesStage;
};

type BootstrapProfileInput = {
    correo?: string;
    nombre?: string;
    ciudad?: string;
};

type CheckoutProfileInput = {
    telefono?: string;
    direccion?: string;
    ciudad?: string;
};

type ReturningContext = {
    customer: {
        name: string;
        email?: string | null;
        lastAddress?: string | null;
        lastCity?: string | null;
    } | null;
    lastItems: CartItem[];
};

let runtimeCityRules = DEFAULT_CITY_RULES;

function syncRuntimeCityRules(config?: StoreConfigLike | null) {
    runtimeCityRules = parseCityRules(config?.ciudadesOperacion);
}

type IntentResolution = {
    item: CartItem | null;
    substitutionNote?: string;
    quantityRestriction?: QuantityRestriction;
    unitClarification?: {
        intent: ParsedIntent;
        item: CartItem;
    };
    ambiguous?: {
        searchTerm: string;
        quantity: number;
        options: CartItem[];
    };
};

const CROSS_SELL_ASSOCIATIONS: Record<string, string[]> = {
    carbon: ["carne", "sal", "encendedor"],
    arroz: ["huevo", "aceite", "platano"],
    pasta: ["salsa", "queso", "atun"],
    papa: ["cebolla", "tomate", "cilantro"],
    limon: ["sal", "aguacate", "cebolla"],
    cafe: ["pan", "huevo", "banano"],
    banano: ["fresa", "guanabana", "mora"],
    fruta: ["banano", "guanabana", "naranja"],
    frutas: ["banano", "guanabana", "naranja"]
};

const CULINARY_REPLACEMENTS: Record<string, string[]> = {
    zapallo: ["ahuyama"],
    victoria: ["ahuyama"],
    calabaza: ["ahuyama"],
    "aji pajarito": ["aji dulce rojo"],
    "ají pajarito": ["aji dulce rojo"],
    habanero: ["aji dulce rojo"],
    chiles: ["aji dulce rojo"],
    chile: ["aji dulce rojo"],
    ajo: ["ajo"],
    arracacha: ["apio arracacha"],
    "legumbres verdes": ["arveja cascara"],
    cebollin: ["cebolla roja pelada"],
    cebollín: ["cebolla roja pelada"],
    "cebolla morada": ["cebolla roja pelada"],
    "cebolla junca": ["cebolla larga pelada"],
    "cebolla de rama": ["cebolla larga pelada"],
    "papa para frita": ["papa pastusa sucia"],
    rustica: ["papa pastusa sucia"],
    "rústica": ["papa pastusa sucia"],
    "papa para pure": ["papa pastusa lavada"],
    "papa para puré": ["papa pastusa lavada"],
    "papa salada": ["papa pastusa lavada"],
    "pimientos verdes": ["pimenton rojo"],
    "pimientos amarillos": ["pimenton rojo"],
    "pimiento verde": ["pimenton rojo"],
    "pimiento amarillo": ["pimenton rojo"],
    "pimenton verde": ["pimenton rojo"],
    "pimentón verde": ["pimenton rojo"],
    "pimenton amarillo": ["pimenton rojo"],
    "pimentón amarillo": ["pimenton rojo"],
    lechuga: ["pepino cohombro"],
    "hojas para ensalada": ["pepino cohombro", "brocoli"],
    "repollos": ["repollo blanco"],
    coles: ["repollo blanco"],
    repollo: ["repollo blanco"],
    "tomate milano": ["tomate chonto"],
    "tomate larga vida": ["tomate chonto"],
    calabacines: ["zukini verde"],
    calabacin: ["zukini verde"],
    calabacín: ["zukini verde"],
    "frutos rojos": ["agraz", "arandanos"],
    fresa: ["agraz", "arandanos"],
    mora: ["agraz", "arandanos"],
    moras: ["agraz", "arandanos"],
    "limon tahiti": ["limon"],
    "limon tahití": ["limon"],
    "aguacate papelillo": ["aguacate hass", "aguacate"],
    pina: ["piña perolera", "piña oro miel"],
    "piña": ["piña perolera", "piña oro miel"]
};

const MEAL_INTENT_BUNDLES: Array<{ pattern: RegExp; items: string[]; title: string }> = [
    { pattern: /(para.*pasta|hacer.*pasta|algo.*pasta|pasta)/i, items: ["tomate", "cebolla", "ajo"], title: "pasta" },
    { pattern: /(asado|parrilla|bbq|barbacoa)/i, items: ["carbon", "sal", "limon"], title: "asado" },
    { pattern: /(desayuno|desayunar)/i, items: ["huevo", "banano", "naranja"], title: "desayuno" }
];

const FRUIT_HINTS = /\b(fruta|frutas|jugo|licuado)\b/i;
const GREEN_HINTS = /\b(verde|verdes|espinaca|acelga|lechuga|brocoli|br[oó]coli)\b/i;
const SOUP_HINTS = /\b(sancocho|sopa|caldo|almuerzo)\b/i;
const UNIT_LABELS: Record<string, string> = {
    lb: "Lb (Libras)",
    kg: "Kg (Kilos)",
    und: "Und (Unidad)",
    carton: "Cartón",
    bidon: "Bidón",
    canastilla: "Canastilla",
    lts: "Lts (Litros)",
    bja: "Bja (Bandeja)",
    atado: "Atado"
};

const PRODUCT_SEARCH_CACHE_TTL_MS = 45 * 1000;
const productSearchCache = new Map<string, { expiresAt: number; data: any }>();

function clearProductSearchCache(config?: { wcUrl?: string | null }) {
    const storeKey = config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "default";
    for (const key of Array.from(productSearchCache.keys())) {
        if (key.endsWith(`::${storeKey}`)) {
            productSearchCache.delete(key);
        }
    }
}

function normalizeMessages(rawMessages: unknown): ChatMessage[] {
    if (!Array.isArray(rawMessages)) return [];

    const parsed = rawMessages
        .map((msg: any) => ({
            role: msg?.role === "assistant" ? "assistant" : msg?.role === "user" ? "user" : null,
            content: typeof msg?.content === "string" ? msg.content.trim() : ""
        }))
        .filter((msg): msg is ChatMessage => Boolean(msg.role && msg.content));

    // Anthropic works best when the first turn is from user. Drop any leading assistant turns.
    const firstUserIndex = parsed.findIndex((m) => m.role === "user");
    if (firstUserIndex === -1) return [];
    return parsed.slice(firstUserIndex);
}

function extractText(content: Anthropic.ContentBlock[]): string {
    return content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n");
}

function buildWooClient(config?: {
    wcUrl?: string | null;
    wcConsumerKey?: string | null;
    wcConsumerSecret?: string | null;
}) {
    return new WooCommerceRestApi({
        url: config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co",
        consumerKey: config?.wcConsumerKey || process.env.WC_CONSUMER_KEY || "",
        consumerSecret: config?.wcConsumerSecret || process.env.WC_CONSUMER_SECRET || "",
        version: "wc/v3"
    });
}

function normalizeUnitCode(raw: unknown): string {
    const value = stripDiacritics(String(raw || "").toLowerCase().trim());
    if (!value) return "";
    if (["lb", "lbs", "lbr", "lbrs", "libra", "libras", "librita", "libritas"].includes(value)) return "lb";
    if (["k", "ks", "kilo", "kilos", "kg", "kgs", "kilito", "kilitos"].includes(value)) return "kg";
    if (["und", "unds", "unidad", "unidades", "unit", "units", "botella", "botellas", "frasco", "frascos"].includes(value)) return "und";
    if (["carton", "cartones"].includes(value)) return "carton";
    if (["bidon", "bidones"].includes(value)) return "bidon";
    if (["canastilla", "canastillas"].includes(value)) return "canastilla";
    if (["lt", "lts", "litro", "litros"].includes(value)) return "lts";
    if (["bja", "bandeja", "bandejas"].includes(value)) return "bja";
    if (["atado", "atados", "ramo", "ramos", "rama", "ramas", "manojo", "manojos"].includes(value)) return "atado";
    return "";
}

const UNIT_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
    [/\b(k|ks|kilo|kilos|kg|kgs|kilito|kilitos)\b/gi, "kg"],
    [/\b(lb|lbs|lbr|lbrs|libra|libras|livra|livras|librita|libritas)\b/gi, "lb"],
    [/\b(und|unds|unidad|unidades|unit|units|botella|botellas|frasco|frascos)\b/gi, "und"],
    [/\b(carton|cartones)\b/gi, "carton"],
    [/\b(bidon|bidones)\b/gi, "bidon"],
    [/\b(canastilla|canastillas)\b/gi, "canastilla"],
    [/\b(lt|lts|litro|litros)\b/gi, "lts"],
    [/\b(bja|bandeja|bandejas)\b/gi, "bja"],
    [/\b(atado|atados|atdo|atdos|ramo|ramos|rama|ramas|manojo|manojos)\b/gi, "atado"]
];

function normalizeUnitSynonymsInText(raw: string) {
    let text = stripDiacritics(raw.toLowerCase());
    for (const [pattern, replacement] of UNIT_TEXT_REPLACEMENTS) {
        text = text.replace(pattern, replacement);
    }
    return text;
}

function unitShortLabel(unit: string, productName?: string | null) {
    if (isPackagedVolumeUnitProduct(productName)) return "Botella de 4 litros";
    return UNIT_LABELS[unit] || unit || "Und (Unidad)";
}

function unitAskLabel(unit: string, productName?: string | null) {
    if (isPackagedVolumeUnitProduct(productName)) return "botellas de 4 litros";
    if (unit === "lb") return "libras";
    if (unit === "kg") return "kilos";
    if (unit === "und") return "unidades";
    if (unit === "carton") return "cartones";
    if (unit === "bidon") return "bidones";
    if (unit === "canastilla") return "canastillas";
    if (unit === "lts") return "litros";
    if (unit === "bja") return "bandejas";
    if (unit === "atado") return "atados";
    return "unidades";
}

function formatLineUnit(unit: string, productName?: string | null, quantity?: number) {
    if (isPackagedVolumeUnitProduct(productName)) {
        return quantity === 1 ? "botella de 4 litros" : "botellas de 4 litros";
    }
    return unit || "und";
}

function canonicalCatalogUnit(unit: string, productName?: string | null) {
    if (isPackagedVolumeUnitProduct(productName)) return "und";
    return unit;
}

function isWeightUnit(unit: string | null | undefined) {
    return unit === "lb" || unit === "kg";
}

function requiresUnitClarification(requestedUnit: string | null | undefined, catalogUnit: string | null | undefined, productName?: string | null) {
    if (!requestedUnit || !catalogUnit) return false;
    const normalizedCatalogUnit = canonicalCatalogUnit(catalogUnit, productName);
    if (requestedUnit === normalizedCatalogUnit) return false;
    return true;
}

function unitClarificationReply(intent: ParsedIntent, catalogItem: CartItem) {
    const requestedLabel = unitShortLabel(intent.requestedUnit || "").toLowerCase();
    const catalogUnit = canonicalCatalogUnit(catalogItem.unit, catalogItem.name);
    const catalogLabel = unitShortLabel(catalogUnit, catalogItem.name).toLowerCase();
    return `Ojo, veci: ${catalogItem.name} se maneja en ${catalogLabel}, no en ${requestedLabel}. Para no equivocarme, mándamelo en ${unitAskLabel(catalogUnit, catalogItem.name)}, por ejemplo: \`${intent.quantity} ${unitAskLabel(catalogUnit, catalogItem.name)} de ${catalogItem.name}\`.`;
}

function unitQuantityQuestion(unit: string, productName?: string | null) {
    const label = unitAskLabel(unit, productName);
    const article = /^(unidades|canastillas|bandejas|libras|botellas)/.test(label) ? "¿Cuántas" : "¿Cuántos";
    return `${article} ${label} le doy?`;
}

function formatQuantityValue(quantity: number) {
    if (Number.isInteger(quantity)) return String(quantity);
    const formatted = quantity.toFixed(1);
    return formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted;
}

function quantityRestrictionReply(intent: ParsedIntent, catalogItem: CartItem) {
    const measure = getCatalogMeasureProfile(catalogItem.unit);
    const lowerLabel = unitShortLabel(catalogItem.unit, catalogItem.name).toLowerCase();
    const lowerAskLabel = unitAskLabel(catalogItem.unit, catalogItem.name);
    const lowerOption = Math.max(1, Math.floor(intent.quantity));
    const upperOption = Math.max(lowerOption + 1, Math.ceil(intent.quantity));
    if (allowsFractionalQuantity(catalogItem.unit)) {
        return `Ojo, veci: ${catalogItem.name} se maneja en ${lowerLabel} y solo en pasos de ${formatQuantityValue(measure.step)}. Para no equivocarme, mándemelo en ${lowerAskLabel}, por ejemplo: \`${formatQuantityValue(upperOption)} ${lowerAskLabel} de ${catalogItem.name}\`.`;
    }
    return `Pena, veci: ${catalogItem.name} se maneja en ${lowerLabel} completas. No le puedo anotar ${formatQuantityValue(intent.quantity)} ${lowerAskLabel}; tiene que ser ${lowerOption} o ${upperOption} ${lowerAskLabel}.`;
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

function enrichProductsWithUnits(products: any[], searchTerm: string) {
    const mapped = products.map((p: any) => ({
        id: p.id,
        name: p.name,
        price: parseFloat(p.price),
        stock_status: p.stock_status,
        image: p.images?.[0]?.src || null,
        unit: canonicalCatalogUnit(extractUnitFromWooProduct(p), p.name)
    }));

    const queryTokens = tokenizeForMatch(searchTerm);
    const siblingUnits = new Map<string, number>();
    for (const product of mapped) {
        if (!product.unit) continue;
        if (!hasTokenMatch(product.name, queryTokens)) continue;
        siblingUnits.set(product.unit, (siblingUnits.get(product.unit) || 0) + 1);
    }

    const inferred = Array.from(siblingUnits.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return mapped.map((product) => ({
        ...product,
        unit: canonicalCatalogUnit(product.unit || inferred || "und", product.name)
    }));
}

function dedupeVisibleProducts<T extends { name: string; price: number; unit?: string }>(products: T[]) {
    const unique = new Map<string, T>();
    for (const product of products) {
        const key = `${normalizeForMatch(product.name)}::${Number(product.price || 0)}::${product.unit || "und"}`;
        if (!unique.has(key)) unique.set(key, product);
    }
    return Array.from(unique.values());
}

function buildVariantOptions(products: Array<{ id: number; name: string; price: number; stock_status: string; image?: string | null; unit?: string }>, searchTerm: string) {
    const normalizedTerm = normalizeForMatch(searchTerm);
    const termTokens = tokenizeForMatch(searchTerm);
    if (termTokens.length === 0) return [];

    const exact = products.filter((p) => normalizeForMatch(p.name) === normalizedTerm);
    if (exact.length > 0) return [];

    const genericStems = termTokens.map(stemToken);
    const candidates = dedupeVisibleProducts(products)
        .filter((p) => isRecommendationCandidate(p.name, searchTerm))
        .filter((p) => {
            const productStems = tokenizeForMatch(p.name).map(stemToken);
            const overlap = genericStems.filter((token) => productStems.includes(token)).length;
            if (overlap === 0) return false;
            if (termTokens.length === 1) return true;
            return overlap === genericStems.length;
        })
        .slice(0, 4);

    if (candidates.length < 2) return [];
    return candidates.map((p) => ({
        product_id: p.id,
        name: p.name,
        quantity: 1,
        unit: canonicalCatalogUnit(p.unit || "und", p.name),
        price: Number(p.price || 0),
        image: p.image || undefined
    }));
}

function variantPrompt(searchTerm: string, options: CartItem[]) {
    const lines = options.map((option) => `- ${option.name} (${unitShortLabel(option.unit, option.name)}) - $${option.price}`).join("\n");
    return `Veci, para ${searchTerm} tengo estas opciones reales:\n${lines}\n¿Cuál le doy?`;
}

function defaultVariantForIntent(intent: ParsedIntent, options: CartItem[]) {
    const normalized = normalizeForMatch(intent.product);
    if (normalized !== "tomate") return null;

    const requestedUnit = intent.requestedUnit || null;
    if (requestedUnit) {
        const sameUnit = options.filter((option) => option.unit === requestedUnit);
        const preferredSameUnit = sameUnit.find((option) => /\btomate\s+cherry\b/i.test(normalizeForMatch(option.name)));
        if (preferredSameUnit) return preferredSameUnit;
        if (sameUnit.length === 1) return sameUnit[0];
        if (sameUnit.length > 1) return sameUnit[0];
    }

    return options.find((option) => /\btomate\s+chonto\b/i.test(normalizeForMatch(option.name))) || null;
}

function itemAlreadyInCartReply(product: string, cart: CartItem[]) {
    const tokens = tokenizeForMatch(product);
    if (tokens.length === 0) return null;
    const existing = cart.find((item) => hasTokenMatch(item.name, tokens));
    if (!existing) return null;
    return `Ya lo tengo agregado, veci: ${existing.quantity} ${formatLineUnit(existing.unit, existing.name, existing.quantity)} de ${existing.name}. ¿Qué más necesita?`;
}

function findVariantChoice(message: string, options: CartItem[], searchTerm?: string) {
    const correction = parseCorrectionMessage(message);
    const choiceSource = correction?.to || message;
    const normalized = normalizeForMatch(choiceSource);
    const tokens = tokenizeForMatch(choiceSource);
    const genericTokens = new Set(tokenizeForMatch(searchTerm || ""));

    if (/\b(primero|primera|1|uno|una)\b/.test(normalized) && options[0]) return options[0];
    if (/\b(segundo|segunda|2|dos)\b/.test(normalized) && options[1]) return options[1];
    if (/\b(tercero|tercera|3|tres)\b/.test(normalized) && options[2]) return options[2];
    if (/\b(cuarto|cuarta|4|cuatro)\b/.test(normalized) && options[3]) return options[3];

    const tokenMatchedOption = options.find((option) => {
        const optionTokens = tokenizeForMatch(option.name).filter((token) => !genericTokens.has(token));
        if (optionTokens.length === 0 || tokens.length === 0) return false;
        return tokens.every((token) => optionTokens.includes(token));
    });
    if (tokenMatchedOption) return tokenMatchedOption;

    let best: CartItem | null = null;
    let bestScore = -1;

    for (const option of options) {
        const name = normalizeForMatch(option.name);
        const optionTokens = tokenizeForMatch(option.name).filter((token) => !genericTokens.has(token));
        let score = 0;
        if (normalized && name.includes(normalized)) score += 50;
        for (const token of tokens) {
            if (name.includes(token)) score += 20;
        }
        for (const token of optionTokens) {
            if (token && normalized.includes(token)) score += 35;
        }
        if (/\bverde\b/.test(normalized) && /\bverde\b/.test(name)) score += 60;
        if (/\bamarill[oa]\b/.test(normalized) && /\bamarill[oa]\b/.test(name)) score += 60;
        if (/\bperolera\b/.test(normalized) && /\bperolera\b/.test(name)) score += 60;
        if (/\boro miel\b/.test(normalized) && /\boro miel\b/.test(name)) score += 60;
        if (score > bestScore) {
            best = option;
            bestScore = score;
        }
    }

    return bestScore > 0 ? best : null;
}

function refersToDifferentProduct(message: string, currentItemName: string) {
    const intents = parseMultipleOrderIntents(message);
    const singleIntent = intents[0] || parseOrderIntent(message);
    if (!singleIntent?.product) return false;

    const currentTokens = tokenizeForMatch(currentItemName);
    const requestedTokens = tokenizeForMatch(singleIntent.product);
    if (requestedTokens.length === 0) return false;

    const overlaps = requestedTokens.some((token) => currentTokens.includes(token));
    return !overlaps;
}

function extractLooseQuantity(message: string): number | null {
    const composite = extractCompositeQuantity(message);
    if (composite && composite > 0) return composite;

    const text = collapseCompositeQuantityPhrases(message);
    const match = text.match(/\b(\d+(?:[.,]\d+)?)\b/);
    if (!match?.[1]) return null;
    const value = parseNumeric(match[1]);
    return value > 0 ? value : null;
}

function extractEachVariantQuantity(message: string): number | null {
    const collapsed = collapseCompositeQuantityPhrases(message);
    const normalized = cleanSearchTerm(collapsed);
    const normalizedRaw = stripDiacritics(normalizeText(message));

    if (!/\b(cada uno|cada una|cada 1|de cada uno|de cada una|de cada 1|de los dos|de las dos|ambos|las dos|los dos)\b/i.test(normalized) &&
        !/\b(cada uno|cada una|de cada uno|de cada una|de los dos|de las dos|ambos|las dos|los dos)\b/i.test(normalizedRaw)) {
        return null;
    }

    const explicit = normalized.match(/\b(\d+(?:[.,]\d+)?)\b/);
    if (explicit?.[1]) {
        const value = parseNumeric(explicit[1]);
        return value > 0 ? value : null;
    }

    if (/\b(un|una|uno)\b/i.test(normalized)) return 1;
    return 1;
}

async function executeGetProducts(searchTerm: string, config?: {
    wcUrl?: string | null;
    wcConsumerKey?: string | null;
    wcConsumerSecret?: string | null;
}) {
    try {
        const cacheKey = `${normalizeForMatch(searchTerm)}::${config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "default"}`;
        const cached = productSearchCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        const snapshot = await fetchCatalogSnapshot(config || undefined);
        const found = searchCatalogProducts(snapshot, searchTerm, 24).map((product) => ({
            ...product,
            image: product.image || null
        }));
        const result = dedupeVisibleProducts(found).slice(0, 10);
        if (result.length > 0) {
            productSearchCache.set(cacheKey, {
                expiresAt: Date.now() + PRODUCT_SEARCH_CACHE_TTL_MS,
                data: result
            });
            return result;
        }

        const emptyResult = { message: "No se encontraron productos con ese nombre" };
        productSearchCache.set(cacheKey, {
            expiresAt: Date.now() + PRODUCT_SEARCH_CACHE_TTL_MS,
            data: emptyResult
        });
        return emptyResult;
    } catch (error) {
        console.error("WooCommerce error:", error);
        return { error: "No se pudo consultar el inventario" };
    }
}

async function executeGetProductById(productId: number, config?: {
    wcUrl?: string | null;
    wcConsumerKey?: string | null;
    wcConsumerSecret?: string | null;
}) {
    try {
        const snapshot = await fetchCatalogSnapshot(config || undefined);
        const p = snapshot.find((product) => Number(product.id) === Number(productId));
        if (!p || !p.id) return null;
        return {
            id: p.id,
            name: p.name,
            price: parseFloat(String(p.price)),
            stock_status: p.stock_status,
            image: p.image || null,
            unit: canonicalCatalogUnit(p.unit || "und", p.name)
        };
    } catch {
        return null;
    }
}

function normalizeForMatch(raw: string) {
    return stripDiacritics(cleanSearchTerm(raw));
}

function tokenizeForMatch(raw: string) {
    return normalizeForMatch(raw)
        .split(" ")
        .filter(Boolean)
        .map((t) => t.replace(/^(k|ks|kilo|kilos|kg|kgs|lb|lbs|lbr|lbrs|libra|libras|librita|libritas|unidad|unidades|und|unds|botella|botellas|frasco|frascos|de|el|la|los|las|marca|tipo|ref|referencia|x)$/i, ""))
        .filter((t) => t.length > 1)
        .filter(Boolean);
}

function stemToken(token: string) {
    return singularizeSpanishToken(token);
}

function singularizeSpanishToken(token: string) {
    const normalized = normalizeForMatch(token);
    if (normalized.length <= 3) return normalized;

    if (normalized.endsWith("ces")) return `${normalized.slice(0, -3)}z`;

    // Words like "tomates" or "aguacates" pluralize from singulars ending in "e".
    // Removing only the trailing "s" preserves the real base form.
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

function hasTokenMatch(productName: string, queryTokens: string[]) {
    const productTokens = tokenizeForMatch(productName);
    const productStems = productTokens.map(stemToken);
    const queryStems = queryTokens.map(stemToken);
    return queryStems.some((q) => productStems.some((p) => p === q));
}

function productMatchScore(productName: string, term: string) {
    const query = normalizeForMatch(term);
    const queryTokens = tokenizeForMatch(term);
    const queryStems = queryTokens.map(stemToken);
    const productNormalized = normalizeForMatch(productName);
    const productTokens = tokenizeForMatch(productName);
    const productStems = productTokens.map(stemToken);

    const matchedQueryStems = queryStems.filter((token) => productStems.some((p) => p === token));
    const matchedCount = matchedQueryStems.length;
    const coverage = queryStems.length > 0 ? matchedCount / queryStems.length : 0;
    const exactPhrase = productNormalized === query;
    const containsPhrase = query.length > 0 && new RegExp(`(^|\\s)${query}(\\s|$)`).test(productNormalized);

    let score = 0;
    if (exactPhrase) score += 1000;
    if (containsPhrase) score += 400;
    score += matchedCount * 80;
    if (coverage === 1) score += 250;
    if (queryTokens.length === 1 && matchedCount === 1) score += 120;
    if (productTokens.length === queryTokens.length) score += 30;
    if (productTokens.length > queryTokens.length) score -= (productTokens.length - queryTokens.length) * 5;

    return {
        score,
        exactPhrase,
        containsPhrase,
        matchedCount,
        coverage
    };
}

function isStrongProductMatch(productName: string, term: string) {
    const queryTokens = tokenizeForMatch(term);
    if (queryTokens.length === 0) return false;

    const match = productMatchScore(productName, term);
    if (match.exactPhrase || match.containsPhrase) return true;
    if (queryTokens.length === 1) return match.matchedCount >= 1;
    return match.coverage === 1;
}

function pickBestProduct<T extends { name: string; id?: number | string }>(products: T[], term: string): T | null {
    const query = normalizeForMatch(term);
    const queryTokens = tokenizeForMatch(term);
    const queryStems = queryTokens.map(stemToken);
    const queryHasProcessedHint = /\b(zumo|jugo|pulpa|aceite|salsa|mermelada)\b/.test(query);

    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < products.length; i += 1) {
        const productName = normalizeForMatch(products[i].name);
        const productTokens = tokenizeForMatch(products[i].name);
        const productStems = productTokens.map(stemToken);
        let score = 0;

        if (productName === query) score += 100;
        if (new RegExp(`(^|\\s)${query}(\\s|$)`).test(productName)) score += 60;
        for (const token of queryStems) {
            if (productStems.some((p) => p === token)) score += 35;
        }

        // If user asked for raw produce, prefer raw produce over processed products.
        if (!queryHasProcessedHint && /\b(zumo|jugo|pulpa|aceite|salsa|mermelada)\b/.test(productName)) {
            score -= 25;
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    if (bestScore <= 0) return null;
    return products[bestIndex];
}

function cleanSearchTerm(raw: string) {
    return raw
        .toLowerCase()
        .replace(/\b(por favor|porfa|gracias|porfis|please|quiero|me regalas|deme|dame|give me|necesito|ponme|pongame|póngame|agregame|agrégame|agrega|agregue|anotame|anótame|anota)\b/g, " ")
        .replace(/[^a-z0-9áéíóúñü\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeQuantityWords(raw: string) {
    const base = normalizeUnitSynonymsInText(raw);
    const map: Record<string, string> = {
        un: "1",
        una: "1",
        uno: "1",
        dos: "2",
        tres: "3",
        cuatro: "4",
        cinco: "5",
        seis: "6",
        siete: "7",
        ocho: "8",
        nueve: "9",
        diez: "10",
        once: "11",
        doce: "12",
        trece: "13",
        catorce: "14",
        quince: "15",
        dieciseis: "16",
        diecisiete: "17",
        dieciocho: "18",
        diecinueve: "19",
        veinte: "20",
        veintiun: "21",
        veintiuno: "21",
        veintiuna: "21",
        veintidos: "22",
        veintitres: "23",
        veinticuatro: "24",
        veinticinco: "25",
        veintiseis: "26",
        veintisiete: "27",
        veintiocho: "28",
        veintinueve: "29",
        treinta: "30",
        cuarenta: "40",
        cincuenta: "50",
        sesenta: "60",
        setenta: "70",
        ochenta: "80",
        noventa: "90",
        cien: "100",
        medio: "0.5",
        media: "0.5",
        otro: "1",
        otra: "1"
    };
    let normalized = base.replace(/\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiun|veintiuno|veintiuna|veintidos|veintitres|veinticuatro|veinticinco|veintiseis|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|medio|media|otro|otra)\b/g, (m) => map[m] || m);
    normalized = normalized.replace(
        /\b(30|40|50|60|70|80|90)\s+y\s+(1|2|3|4|5|6|7|8|9)\b/g,
        (_, tens: string, ones: string) => String(Number(tens) + Number(ones))
    );
    return normalized;
}

function parseNumeric(value: string) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
}

function extractCompositeQuantity(text: string): number | null {
    const normalized = normalizeQuantityWords(stripDiacritics(normalizeText(text)));
    const units = "(?:kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos|carton|cartones|bidon|bidones|canastilla|canastillas|lt|lts|litro|litros|bja|bandeja|bandejas|atado|atados|rama|ramas|ramo|ramos)";

    const explicitOneAndHalf = normalized.match(new RegExp(`^(?:1\\s+)?${units}\\s+y\\s+0\\.5(?:\\s+de\\b|\\b|$)`, "i"));
    if (explicitOneAndHalf) return 1.5;

    const numberAndHalf = normalized.match(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*${units}\\s+y\\s+0\\.5\\b`, "i"));
    if (numberAndHalf?.[1]) {
        const quantity = parseNumeric(numberAndHalf[1]);
        return quantity > 0 ? quantity + 0.5 : null;
    }

    const standaloneComposite = normalized.match(/\b(\d+(?:[.,]\d+)?)\s+y\s+0\.5\b/i);
    if (standaloneComposite?.[1]) {
        const quantity = parseNumeric(standaloneComposite[1]);
        return quantity > 0 ? quantity + 0.5 : null;
    }

    return null;
}

function collapseCompositeQuantityPhrases(text: string) {
    const normalized = normalizeQuantityWords(stripDiacritics(normalizeText(text)));
    return normalized.replace(
        /\b(?:(\d+(?:[.,]\d+)?)\s+)?(kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos|carton|cartones|bidon|bidones|canastilla|canastillas|lt|lts|litro|litros|bja|bandeja|bandejas|atado|atados|rama|ramas|ramo|ramos)\s+y\s+0\.5\b/gi,
        (_, qty: string | undefined, unit: string) => {
            const baseQuantity = qty ? parseNumeric(qty) : 1;
            return `${baseQuantity + 0.5} ${unit}`;
        }
    );
}

function stripLeadingQuantityPhrase(raw: string) {
    return cleanSearchTerm(
        normalizeQuantityWords(raw)
            .replace(
                /^(?:\d+(?:[.,]\d+)?|0\.5)\s*(?:kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)?\s*(?:de\s+)?/i,
                ""
            )
    );
}

function cleanOrderText(raw: string) {
    return stripDiacritics(raw.toLowerCase())
        .replace(/\b(por favor|porfa|gracias|porfis|please|quiero|me regalas|deme|dame|give me|necesito|ponme|pongame|póngame|agregame|agrégame|agrega|agregue|anotame|anótame|anota)\b/g, " ")
        .replace(/[^a-z0-9áéíóúñü\s.,]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractGenericProductTerm(raw: string) {
    const words = cleanSearchTerm(raw)
        .split(" ")
        .map((w) => w.trim())
        .filter(Boolean)
        .filter((w) => !/^(marca|tipo|ref|referencia|la|el|los|las|de|del|x|por|favor|premium|clasico|clasica|grande|mediano|pequeno|pequena)$/.test(stripDiacritics(w)));

    if (words.length === 0) return "";
    return words.slice(-2).join(" ");
}

function normalizeText(raw: string) {
    return raw.toLowerCase().trim();
}

function stripDiacritics(raw: string) {
    return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractPhone(text: string): string | null {
    const compact = text.replace(/[()\s.-]/g, "");
    const direct = compact.match(/(?:\+?57)?(3\d{9})\b/);
    if (direct?.[1]) return direct[1];

    const generic = text.match(/\b(3\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
    if (generic) return `${generic[1]}${generic[2]}${generic[3]}`;
    return null;
}

function extractEmail(text: string): string | null {
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0].toLowerCase() : null;
}

function looksLikeAddress(text: string): boolean {
    const normalized = normalizeText(
        text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    );
    return /(calle|carrera|cra|cl|av|avenida|transversal|diagonal|#|apto|casa|barrio)/.test(normalized);
}

function extractAddressFromText(text: string): string | null {
    if (!looksLikeAddress(text)) return null;
    const withoutEmail = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
    const cleaned = withoutEmail.replace(/\b(vivo en|mi direccion es|direccion|estoy en)\b/gi, " ");
    const match = cleaned.match(/((?:calle|carrera|cra|cl|av|avenida|transversal|diagonal)\s+[^,.;\n]+(?:#\s*[^,.;\n]+)?)/i);
    if (match?.[1]) {
        return match[1].replace(/\s+/g, " ").trim();
    }
    return null;
}

function sanitizeName(text: string): string | null {
    const value = String(text || "")
        .replace(/^(me llamo|soy|mi nombre es)\s+/i, "")
        .replace(/[^a-záéíóúñü\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (value.length < 3 || value.length > 70) return null;
    if (/(hola|buenas|buenos dias|buenas tardes|buenas noches)/i.test(value)) return null;
    if (/^(cliente web|visitante web)$/i.test(value)) return null;
    if (/(otra vez|eche|repite|repita|pedido|canasta|correo|whatsapp|telefono|n[uú]mero|monda|joda|carajos|uno nuevo|una nueva|nuevo mercado|mercado nuevo)/i.test(value)) return null;
    if (/(piña|pina|papa|tomate|cebolla|platano|banano|mango|limon|naranja|zanahoria|lechuga|aguacate|kilo|libra|unidad)/i.test(value)) return null;
    if (looksLikeCatalogProductText(value)) return null;
    if (looksLikeVariantSelectionText(value)) return null;

    const words = value.split(" ").filter(Boolean);
    if (words.length < 2) return null;
    if (words.some((w) => w.length < 2)) return null;

    return value;
}

function sanitizeBootstrapName(text: string): string | null {
    const strictName = sanitizeName(text);
    if (strictName) return strictName;

    const value = String(text || "")
        .replace(/^(me llamo|soy|mi nombre es)\s+/i, "")
        .replace(/[^a-záéíóúñü\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (value.length < 3 || value.length > 70) return null;
    if (/(hola|buenas|buenos dias|buenas tardes|buenas noches)/i.test(value)) return null;
    if (/^(cliente web|visitante web)$/i.test(value)) return null;
    return value;
}

function firstNameOf(text: string | null | undefined): string | null {
    const safe = sanitizeBootstrapName(String(text || ""));
    if (!safe) return null;
    return safe.split(" ")[0] || null;
}

function extractNameFromText(text: string): string | null {
    let candidate = text.trim();
    const nameLead = candidate.match(/(?:mi nombre es|me llamo|soy)\s+(.+)/i);
    if (nameLead?.[1]) {
        candidate = nameLead[1];
    }

    candidate = candidate
        .replace(/\b(y|e)\s+(mi\s+)?(numero|número|whatsapp|celular|telefono|teléfono).*/i, "")
        .replace(/\b(mi\s+)?(numero|número|whatsapp|celular|telefono|teléfono).*/i, "")
        .replace(/\d+/g, " ")
        .trim();

    return sanitizeName(candidate);
}

function extractStandaloneName(text: string): string | null {
    if (extractPhone(text)) return null;
    if (extractEmail(text)) return null;
    if (looksLikeAddress(text)) return null;

    const normalized = stripDiacritics(normalizeText(text));
    if (/(quiero|pedido|comprar|precio|cuanto|vale|tiene|hay|agrega|agregar|carrito|repetir|kilo|kg|libra|unidad|botella|frasco|nada mas|no mas|eso es todo|ya termine|ya esta|ya quedo|listo no mas|gracias)/.test(normalized)) {
        return null;
    }
    if (isNewBasketChoice(text) || isRepeatOrderRequest(text) || isStartOrderIntent(text)) return null;
    if (looksLikeCatalogProductText(text)) return null;
    if (looksLikeVariantSelectionText(text)) return null;

    return sanitizeName(text);
}

function looksLikeCatalogProductText(text: string) {
    const normalized = stripDiacritics(normalizeText(text));
    if (!normalized) return false;

    if (/\b(de|lb|libras?|kilos?|kg|unidades?|unidad|und|botellas?|frascos?|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)\b/.test(normalized)) {
        return true;
    }

    const knownProductHints = [
        ...Object.keys(CULINARY_REPLACEMENTS),
        ...Object.values(CULINARY_REPLACEMENTS).flat(),
        ...Object.keys(CROSS_SELL_ASSOCIATIONS),
        "aguacate",
        "aguacates",
        "cebolla",
        "cebollas",
        "zanahoria",
        "zanahorias",
        "tomate",
        "tomates",
        "papa",
        "papas",
        "limon",
        "limones",
        "aji",
        "ají",
        "pimiento",
        "pimientos",
        "fruto",
        "frutos",
        "rojos",
        "brocoli",
        "brócoli",
        "pepino",
        "cohombro",
        "agraz",
        "arandanos",
        "arándanos",
        "ahuyama",
        "apio arracacha",
        "repollo",
        "zukini",
        "piña",
        "pina",
        "hass",
        "cherry",
        "chonto",
        "criollo",
        "mandarino",
        "tahiti",
        "perolera",
        "oro miel",
        "lavada",
        "sucia",
        "cabezona",
        "larga",
        "pelada"
    ];

    return knownProductHints.some((hint) => {
        const token = stripDiacritics(hint);
        return token.length > 2 && normalized.includes(token);
    });
}

function looksLikeVariantSelectionText(text: string) {
    const normalized = stripDiacritics(normalizeText(text));
    if (!normalized) return false;

    const variantOnlyPatterns = [
        /\bhass\b/,
        /\bcherry\b/,
        /\bchonto\b/,
        /\bcriollo\b/,
        /\bmandarino\b/,
        /\btahiti\b/,
        /\bperolera\b/,
        /\boro miel\b/,
        /\blavada\b/,
        /\bsucia\b/,
        /\bcabezona\b/,
        /\blarga\b/,
        /\bpelada\b/,
        /\broja\b/,
        /\bverde\b/,
        /\bamarilla?\b/,
        /\bblanca\b/
    ];

    return variantOnlyPatterns.some((pattern) => pattern.test(normalized));
}

function sanitizeCity(text: string): string | null {
    const raw = normalizeText(String(text || ""));
    if (/@/.test(raw)) return null;
    if (/\d/.test(raw)) return null;

    const value = normalizeCityValue(stripDiacritics(raw)
        .replace(/^(mi ciudad es|vivo en|estoy en)\s+/i, "")
        .replace(/[^a-z\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim());

    const match = runtimeCityRules.find((city) => city.value === value && city.enabled);
    return match?.value || null;
}

function cityLabel(value: string | undefined | null) {
    return cityLabelFromValue(value, runtimeCityRules);
}

function extractCityFromText(text: string): string | null {
    const normalized = stripDiacritics(normalizeText(text));
    for (const city of runtimeCityRules.filter((item) => item.enabled)) {
        const needle = normalizeCityValue(city.label);
        if (needle && normalized.includes(needle)) {
            return city.value;
        }
    }

    const explicit = normalized.match(/(?:mi ciudad es|vivo en|estoy en|en la ciudad de)\s+([a-záéíóúñü\s]+)/i);
    if (explicit?.[1]) {
        return sanitizeCity(explicit[1]);
    }

    return null;
}

function extractUnsupportedCityCandidate(text: string): string | null {
    const normalized = stripDiacritics(normalizeText(text))
        .replace(/^(mi ciudad es|vivo en|estoy en|en la ciudad de)\s+/i, "")
        .replace(/[^a-z\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized || normalized.split(" ").length > 3) return null;
    if (extractCityFromText(text)) return null;
    if (extractPhone(text) || extractEmail(text) || looksLikeAddress(text)) return null;
    if (isPriceQuestion(text) || isAvailabilityQuestion(text)) return null;
    if (extractStandaloneName(text)) return null;
    return normalized || null;
}

function extractProfileFromMessages(messages: ChatMessage[]): CustomerProfile {
    const profile: CustomerProfile = {};

    for (const message of messages) {
        if (message.role !== "user") continue;
        const text = message.content;
        const normalized = normalizeText(text);

        if (!profile.telefono) {
            const phone = extractPhone(text);
            if (phone) profile.telefono = phone;
        }

        if (!profile.correo) {
            const email = extractEmail(text);
            if (email) profile.correo = email;
        }

        if (!profile.nombre) {
            const hasNameLead = /(me llamo|mi nombre es|soy)/i.test(normalized);
            const name = hasNameLead ? extractNameFromText(text) : extractStandaloneName(text);
            if (name) profile.nombre = name;
        }

        if (!profile.direccion && /(calle|carrera|cra|cl|av|avenida|transversal|diagonal|#|apto|casa|barrio)/i.test(normalized)) {
            const address = extractAddressFromText(text);
            if (address) profile.direccion = address;
        }

        if (!profile.ciudad) {
            const city = extractCityFromText(text);
            if (city) profile.ciudad = city;
        }

        if (!profile.ciudad && profile.direccion) {
            const city = extractCityFromText(text);
            if (city && city.split(" ").length <= 3) {
                profile.ciudad = city;
            }
        }
    }

    return profile;
}

function firstMissingInitialField(profile: CustomerProfile): keyof CustomerProfile | null {
    if (!profile.correo) return "correo";
    if (!profile.ciudad) return "ciudad";
    return null;
}

function firstMissingCheckoutField(profile: CustomerProfile): keyof CustomerProfile | null {
    if (!profile.telefono) return "telefono";
    if (!profile.direccion) return "direccion";
    return null;
}

function firstMissingField(profile: CustomerProfile): keyof CustomerProfile | null {
    return firstMissingInitialField(profile) || firstMissingCheckoutField(profile);
}

function hasInitialProfile(profile: CustomerProfile) {
    return firstMissingInitialField(profile) === null;
}

function hasCompleteProfile(profile: CustomerProfile) {
    return firstMissingField(profile) === null;
}

function deriveSalesStage(profile: CustomerProfile, draft: DraftState): SalesStage {
    if (draft.awaitingCheckoutConfirmation) return "confirmacion";
    if (!hasInitialProfile(profile)) return "captura_datos";
    if (draft.cart.length > 0) return "toma_pedido";
    return "toma_pedido";
}

function inferIntentLabel(userText: string, replyText: string): string {
    const user = stripDiacritics(normalizeText(userText));
    const reply = stripDiacritics(normalizeText(replyText));

    if (isGratitudeOnly(user)) return "agradecimiento";
    if (isPriceQuestion(user)) return "pregunta_precio";
    if (isAvailabilityQuestion(user)) return "pregunta_disponibilidad";
    if (isDoneOrderingIntent(user) || /resumen final|tirilla/.test(reply)) return "cierre";
    if (/pedido confirmado|orden es #/.test(reply)) return "confirmacion";
    if (parseCorrectionMessage(user)) return "corregir_item";
    if (parseMultipleOrderIntents(user).length > 0) return "agregar_item";
    if (extractPhone(userText) || extractEmail(userText) || extractStandaloneName(userText)) return "captura_dato";
    return "otro";
}

function buildAssistantContract(params: {
    userText: string;
    reply: string;
    profile: CustomerProfile;
    draft: DraftState;
}): AssistantContract {
    const missing = firstMissingInitialField(params.profile);
    const normalizedReply = stripDiacritics(normalizeText(params.reply));
    const confirmed = /pedido confirmado|su orden es #/.test(normalizedReply);
    const thankedAfterClose = /pedido listo y confirmado|gracias por comprar/.test(normalizedReply);
    const closed = confirmed || thankedAfterClose;
    const next_action = missing
        ? ("ask_correo_modal" as AssistantContract["next_action"])
        : closed
            ? "end"
            : params.draft.awaitingCheckoutConfirmation
            ? "await_checkout_confirmation"
            : params.draft.pendingCheckoutAfterIntake
                ? "ask_checkout_modal"
            : params.draft.cart.length > 0
                ? "ask_more_items"
                : "ask_order_items";
    const stage = closed
        ? "cerrado"
        : deriveSalesStage(params.profile, params.draft);

    return {
        intent: inferIntentLabel(params.userText, params.reply),
        fields_detected: {
            nombre: params.profile.nombre,
            telefono: params.profile.telefono,
            correo: params.profile.correo,
            direccion: params.profile.direccion,
            ciudad: params.profile.ciudad
        },
        items: params.draft.cart.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            price: i.price
        })),
        next_action,
        reply: params.reply,
        stage
    };
}

function parseModelContract(raw: string): Partial<AssistantContract> | null {
    const text = raw.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed || typeof parsed !== "object") return null;
        return parsed as Partial<AssistantContract>;
    } catch {
        return null;
    }
}

function extractFieldValue(field: keyof CustomerProfile, text: string): string | null {
    if (field === "nombre") {
        if (looksLikeCatalogProductText(text)) return null;
        return extractNameFromText(text) || extractStandaloneName(text);
    }
    if (field === "telefono") return extractPhone(text);
    if (field === "correo") return extractEmail(text);
    if (field === "direccion") return extractAddressFromText(text);
    if (field === "ciudad") return extractCityFromText(text);
    return null;
}

function fieldQuestion(field: keyof CustomerProfile) {
    if (field === "correo" || field === "nombre" || field === "ciudad") {
        return "Antes de empezar, completa tus datos en el modal de entrada para seguir.";
    }
    if (field === "telefono" || field === "direccion") {
        return "Para confirmar tu pedido, usa el botón \"Confirmar pedido\" y completa tu WhatsApp y dirección de entrega en el modal.";
    }
    return "Para seguir, completa tus datos en el modal correspondiente.";
}

function intakeNudge(field: keyof CustomerProfile) {
    if (field === "correo" || field === "nombre" || field === "ciudad") return fieldQuestion(field);
    if (field === "telefono" || field === "direccion") {
        return "Completa esos datos en el modal de cierre para confirmar el pedido.";
    }
    return "Completa tus datos en el modal para seguir.";
}

function fieldLabel(field: keyof CustomerProfile) {
    if (field === "nombre") return "nombre";
    if (field === "telefono") return "número de WhatsApp";
    if (field === "correo") return "correo";
    if (field === "direccion") return "dirección";
    return "ciudad";
}

function getNewCapturedFields(before: CustomerProfile, current: CustomerProfile): Array<keyof CustomerProfile> {
    const fields: Array<keyof CustomerProfile> = ["nombre", "telefono", "correo", "direccion", "ciudad"];
    return fields.filter((f) => !before[f] && Boolean(current[f]));
}

async function persistCustomerProfile(sessionId: string | null, profile: CustomerProfile) {
    if (!sessionId) return;
    const safeName = profile.nombre ? sanitizeName(profile.nombre) : null;

    await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
            customerName: safeName || undefined,
            customerEmail: profile.correo || undefined,
            customerCity: profile.ciudad || undefined,
            customerAddress: profile.direccion || undefined,
            phoneNumber: profile.telefono || undefined,
            updatedAt: new Date()
        }
    });

    if (safeName && profile.telefono) {
        await prisma.customer.upsert({
            where: { phone: profile.telefono },
            update: {
                name: safeName,
                email: profile.correo || undefined,
                lastAddress: profile.direccion || undefined,
                lastCity: profile.ciudad || undefined
            },
            create: {
                phone: profile.telefono,
                name: safeName,
                email: profile.correo || undefined,
                lastAddress: profile.direccion || undefined,
                lastCity: profile.ciudad || undefined
            }
        });
    }

    if (profile.correo && safeName && !profile.telefono) {
        await prisma.customer.updateMany({
            where: {
                email: {
                    equals: profile.correo,
                    mode: "insensitive"
                }
            },
            data: {
                name: safeName,
                lastCity: profile.ciudad || undefined,
                lastAddress: profile.direccion || undefined
            }
        });
    }
}

function parseOrderIntent(message: string): { quantity: number | null; product: string; requestedUnit?: string | null } | null {
    if (extractEmail(message) && !hasEmbeddedOrderSignal(message)) return null;
    if (isLikelyAddressText(message) && !hasEmbeddedOrderSignal(message)) return null;
    if (parseRemoveItemMessage(message)) return null;
    if ((isStartOrderIntent(message) || isResumePreviousRequestIntent(message)) && !hasConcreteOrderDetail(message)) return null;
    if (isNewBasketChoice(message) && !hasConcreteOrderDetail(message)) return null;
    if (isGreetingMessage(message) && !hasConcreteOrderDetail(message)) return null;

    const normalizedQuantityMessage = normalizeQuantityWords(message);
    const normalizedText = stripDiacritics(normalizeText(normalizedQuantityMessage));
    const halfMatch = normalizedText.match(/^(?:media|medio)\s*(?:kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos|carton|cartones|bidon|bidones|canastilla|canastillas|lt|lts|litro|litros|bja|bandeja|bandejas|atado|atados|rama|ramas|ramo|ramos)?\s*(?:de\s+)?(.+)$/i);
    if (halfMatch?.[1]) {
        const product = cleanSearchTerm(halfMatch[1]);
        if (product && !isUnitOnlyText(product)) {
            return { quantity: 0.5, product, requestedUnit: extractRequestedUnit(message) };
        }
    }

    const normalizedRaw = collapseCompositeQuantityPhrases(normalizedQuantityMessage);
    const compositeMatch = normalizedRaw.match(/^(?:(\d+(?:[.,]\d+)?)\s*)?(kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)\s+y\s+0\.5\s*(?:de\s+)?(.+)$/i);
    if (compositeMatch?.[2] && compositeMatch?.[3]) {
        const baseQuantity = compositeMatch[1] ? parseNumeric(compositeMatch[1]) : 1;
        const product = cleanSearchTerm(compositeMatch[3]);
        if (baseQuantity > 0 && product && !isUnitOnlyText(product)) {
            return { quantity: baseQuantity + 0.5, product, requestedUnit: extractRequestedUnit(compositeMatch[2]) };
        }
    }

    const verbDriven = normalizedRaw.match(/^(quiero|necesito|me regalas|deme|dame|ponme|pongame|póngame|agregame|agrégame|agrega|agregue|anotame|anótame|anota)\s+(.+)$/i);
    if (verbDriven?.[2]) {
        const remainder = cleanSearchTerm(normalizeQuantityWords(verbDriven[2])).replace(/^bien\s+/i, "");
        const qtyFromVerb = remainder.match(/(\d+(?:[.,]\d+)?)\s+(.+)/);
        if (qtyFromVerb) {
            const quantity = parseNumeric(qtyFromVerb[1]);
            const rawProduct = normalizeRequestedProductTerm(qtyFromVerb[2]
                .replace(/^(kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)\s*(de)?\s*/i, "")
                .replace(/^de\s+/i, "")
                .trim());
            if (!rawProduct || isUnitOnlyText(rawProduct)) return null;
            return { quantity, product: rawProduct, requestedUnit: extractRequestedUnit(qtyFromVerb[2]) };
        }
        const product = normalizeRequestedProductTerm(verbDriven[2]);
        if (/^(hacer un pedido|un pedido|pedido|comprar|compras|hacer compra)$/.test(product)) return null;
        if (product) return { quantity: null, product };
    }

    const embeddedVerb = normalizedRaw.match(/\b(quiero|necesito|me regalas|deme|dame|ponme|pongame|póngame|agregame|agrégame|agrega|agregue|anotame|anótame|anota)\s+(.+)$/i);
    if (embeddedVerb?.[2]) {
        const remainder = cleanSearchTerm(
            embeddedVerb[2].replace(/^(quiero|necesito|me regalas|deme|dame|ponme|pongame|póngame|agregame|agrégame|agrega|agregue|anotame|anótame|anota)\s+/i, "")
        ).replace(/^bien\s+/i, "");
        const parsedEmbedded = parseOrderIntent(remainder);
        if (parsedEmbedded) return parsedEmbedded;
    }

    const clean = cleanOrderText(collapseCompositeQuantityPhrases(normalizedQuantityMessage));
    // Prevent phone numbers from being parsed as "quantity + product"
    if (/^[+\d\s().-]+$/.test(clean) && clean.replace(/\D/g, "").length >= 10) {
        return null;
    }

    const qtyAndProduct = clean.match(/^(\d+(?:[.,]\d+)?)\s+(.+)/);
    if (qtyAndProduct) {
        const quantity = parseNumeric(qtyAndProduct[1]);
        const rawProduct = normalizeRequestedProductTerm(qtyAndProduct[2]
            .replace(/^(kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)\s*(de)?\s*/i, "")
            .replace(/^de\s+/i, "")
            .trim());
        // If it contains another quantity, let multi-intent parser handle it.
        if (/\d+\s+[a-záéíóúñü]/i.test(rawProduct)) return null;
        if (!rawProduct || !/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(rawProduct)) return null;
        return { quantity, product: rawProduct, requestedUnit: extractRequestedUnit(qtyAndProduct[2]) };
    }

    const trailingQty = clean.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)$/i);
    if (trailingQty?.[1] && trailingQty?.[2]) {
        const quantity = parseNumeric(trailingQty[2]);
        const product = normalizeRequestedProductTerm(trailingQty[1]);
        if (quantity > 0 && product && !isUnitOnlyText(product)) {
            return { quantity, product, requestedUnit: extractRequestedUnit(trailingQty[3]) };
        }
    }

    const plainProduct = normalizeRequestedProductTerm(stripLeadingQuantityPhrase(message) || cleanSearchTerm(message));
    if (
        plainProduct &&
        !isUnitOnlyText(plainProduct) &&
        !extractPhone(message) &&
        !extractEmail(message) &&
        !extractStandaloneName(message) &&
        !extractCityFromText(message) &&
        !looksLikeAddress(message) &&
        !isStartOrderIntent(message) &&
        !isDoneOrderingIntent(message) &&
        !isCheckoutIntent(message) &&
        !isPriceQuestion(message) &&
        !isAvailabilityQuestion(message) &&
        !isGratitudeOnly(message) &&
        !isFrustrationMessage(message)
    ) {
        return { quantity: null, product: plainProduct, requestedUnit: extractRequestedUnit(message) };
    }

    return null;
}

function parseMultipleOrderIntents(message: string): ParsedIntent[] {
    if (extractEmail(message) && !hasEmbeddedOrderSignal(message)) return [];
    if (isLikelyAddressText(message) && !hasEmbeddedOrderSignal(message)) return [];
    if (parseRemoveItemMessage(message)) return [];
    if ((isStartOrderIntent(message) || isResumePreviousRequestIntent(message)) && !hasConcreteOrderDetail(message)) return [];

    const normalizedMessage = collapseCompositeQuantityPhrases(normalizeQuantityWords(message));
    const cleaned = cleanSearchTerm(normalizedMessage);
    if (/^[+\d\s().-]+$/.test(cleaned) && cleaned.replace(/\D/g, "").length >= 10) {
        return [];
    }

    const normalized = normalizedMessage
        .replace(/\b((?:(?:un(?:a|o)?|\d+(?:[.,]\d+)?)\s+)?(?:kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?))\s+y\s+(media|medio)\b/gi, "$1 __Y_MEDIA__")
        .replace(/\s+y\s+/gi, ", ")
        .replace(/\n/g, ", ")
        .replace(/__Y_MEDIA__/g, " y media");

    const parts = normalized
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

    const intents: ParsedIntent[] = [];
    for (const part of parts) {
        const parsed = parseOrderIntent(part);
        if (parsed && typeof parsed.quantity === "number" && parsed.quantity > 0) {
            const splitProducts = parsed.product.includes(" y ")
                ? parsed.product.split(/\s+y\s+/).map((p: string) => p.trim()).filter((p: string) => p.length > 2)
                : [parsed.product];
            for (const product of splitProducts) {
                intents.push({ quantity: parsed.quantity, product, requestedUnit: parsed.requestedUnit || null });
            }
        }
    }

    // Fallback: detect multiple items in one phrase without commas.
    // Example: "10 piñas 2 kilos de papa 3 de limones"
    if (intents.length <= 1) {
        const text = cleanOrderText(normalizedMessage);
        const pattern = /(\d+(?:[.,]\d+)?)\s*(kilos?|kg|libras?|lb|unidades?|unidad|unds?|und|cartones?|bidones?|canastillas?|lts?|litros?|bja|bandejas?|atados?|ramas?|ramos?)?\s*(de\s+)?([a-záéíóúñü][a-záéíóúñü\s]{1,50}?)(?=\s+\d+(?:[.,]\d+)?\s|$)/gi;
        const detected: ParsedIntent[] = [];
        const seen = new Set<string>();
        let match: RegExpExecArray | null = null;

        while ((match = pattern.exec(text)) !== null) {
            const quantity = parseNumeric(match[1] || "0");
            const productRaw = (match[4] || "").trim();
            const product = productRaw
                .replace(/\b(por favor|porfa|gracias|porfis)\b/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            if (!quantity || quantity <= 0 || !product || isUnitOnlyText(product)) continue;
            const alternatives = product.includes(" y ")
                ? product.split(/\s+y\s+/).map((p) => p.trim()).filter((p) => p.length > 2)
                : [product];
            for (const option of alternatives) {
                const key = `${quantity}:${normalizeForMatch(option)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                detected.push({ quantity, product: option, requestedUnit: extractRequestedUnit(match[2] || "") });
            }
        }

        if (detected.length > intents.length) return detected;
    }

    return intents;
}

function parseProductListMessage(message: string) {
    if (/\d/.test(message)) return [];
    const normalized = stripDiacritics(normalizeText(message))
        .replace(/^(hola|buenas|buenos dias|buenas tardes|buenas noches)\s+/i, "")
        .replace(/^(quiero|necesito|me regalas|deme|dame)\s+/i, "")
        .replace(/^(lo siguiente|estos|estas)\s*:\s*/i, "")
        .replace(/^hola necesito lo siguiente:\s*/i, "")
        .trim();

    if (!/[;,]/.test(normalized)) return [];

    const parts = normalized
        .split(/[;,]+/)
        .map((part) => normalizeRequestedProductTerm(part))
        .map((part) => part.replace(/^(y|e)\s+/i, "").trim())
        .filter((part) => part.length > 2)
        .filter((part) => !isUnitOnlyText(part));

    return Array.from(new Set(parts));
}

function isLikelyAddressText(message: string) {
    const normalized = stripDiacritics(cleanSearchTerm(message));
    const hasAddressWord = /\b(direccion|direccion es|calle|carrera|cra|avenida|av|barrio|casa|apto|apartamento|conjunto|torre|piso|interior|manzana)\b/i.test(normalized);
    const digitCount = (normalized.match(/\d/g) || []).length;
    return hasAddressWord && digitCount >= 1;
}

function hasEmbeddedOrderSignal(message: string) {
    const normalized = stripDiacritics(normalizeText(message));
    return /\b(quiero|necesito|dame|deme|me regalas|ponme|pongame|agregame|agrega|agregue|anotame|anota|llevar|pedido|libra|libras|kilo|kilos|kg|unidad|unidades|und|botella|botellas|frasco|frascos)\b/.test(normalized);
}

function hasConcreteOrderDetail(message: string) {
    const normalized = stripDiacritics(normalizeText(message));
    return /(\d+(?:[.,]\d+)?\s*(kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos)?\s*(de\s+)?[a-záéíóúñü]{2,}|media\s+libra\s+de|medio\s+kilo\s+de|(?:\d+\s+)?(?:libra|libras|lb|kilo|kilos|kg|unidad|unidades|und|botella|botellas|frasco|frascos|atado|atados)\s+y\s+(?:media|medio)\s+de)/i.test(normalized);
}

function isAffirmative(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /^(si|ok|dale|hagale|de una|correcto|confirmo|confirmar)\b/i.test(text);
}

function isNegative(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /^(no|negativo|cancelar|corrige|corregir)\b/i.test(text);
}

function isRepeatOrderRequest(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /(repetir|lo mismo|pedido anterior|mercar lo anterior|ultima compra|ultima vez|otra vez|de nuevo|eche otra vez|hagalo otra vez|hagal[oó] de nuevo)/.test(text);
}

function isNewBasketChoice(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /(^|\b)(nuevo|uno nuevo|una nueva|uno nuevo mejor|armemos uno nuevo|canasta nueva|mercado nuevo|nuevo mercado|arranquemos nuevo|algo nuevo|uno diferente|nuevo por favor)(\b|$)/.test(text);
}

function isStartOrderIntent(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /(quiero hacer un pedido|quiero pedido|hacer un pedido|hacer pedido|iniciar pedido|armar pedido|quiero mercar|vengo a pedir|canasta nueva|una canasta nueva)/.test(text);
}

function isGreetingMessage(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|que mas|como vas|como va|alo)\b/.test(text);
}

function isResumePreviousRequestIntent(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /(con lo que te pedi|lo que te pedi|eso que te pedi|con eso que te dije)/.test(text);
}

function isCheckoutIntent(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /(finalizar pedido|confirmar pedido|terminar pedido|cerrar pedido|enviar pedido|listo para pagar|confirmar compra)/.test(text);
}

function isDoneOrderingIntent(message: string) {
    const text = stripDiacritics(cleanSearchTerm(message));
    return /(no mas|nada mas|eso es todo|eso seria todo|ya termine|ya esta|ya quedo|listo no mas)/.test(text);
}

function isGratitudeOnly(message: string) {
    const text = stripDiacritics(normalizeText(message))
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return /^(gracias|muchas gracias|mil gracias|ok gracias|listo gracias|gracias veci|gracias sumerce|gracias sumerce veci|gracias sumerc[eé])$/.test(text);
}

function wasOrderJustConfirmed(messages: ChatMessage[]) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.content) return false;
    const text = stripDiacritics(cleanSearchTerm(lastAssistant.content));
    return /(pedido confirmado|su orden es #)/.test(text);
}

function isFrustrationMessage(message: string) {
    const text = stripDiacritics(normalizeText(message));
    return /(no vales|no sirve|no entiendes|estas jodido|tas jodido|joda|monda|carajos|que pasa|que pasaaaa|idiota|bobad|no me vaya a salir|no me salgas)/.test(text);
}

function parseRemoveItemMessage(message: string): { product: string } | null {
    const text = stripDiacritics(normalizeText(message)).replace(/\s+/g, " ").trim();
    const match = text.match(/\b(?:quite|quita|quitar|saque|saca|sacar|elimine|elimina|eliminar|borre|borra|borrar|remueva|remueve|remover)\s+(?:de\s+la\s+canasta\s+)?(?:el|la|los|las|un|una|unos|unas)?\s*(.+)$/i);
    if (!match?.[1]) return null;
    const product = normalizeRequestedProductTerm(match[1]);
    if (!product || isUnitOnlyText(product)) return null;
    return { product };
}

function isLastItemRemoveRequest(message: string) {
    const text = stripDiacritics(normalizeText(message)).replace(/\s+/g, " ").trim();
    return /\b(?:quite|quita|quitar|saque|saca|sacar|elimine|elimina|eliminar|borre|borra|borrar|remueva|remueve|remover)\s+(?:el|la)?\s*(?:ultimo|último|ultima|última)\b/i.test(text);
}

function extractQuantityUnitOnly(message: string): { quantity: number; unit: "lb" | "kg" | "und" } | null {
    const text = normalizeQuantityWords(normalizeText(message));
    const m = text.match(/^(\d+(?:[.,]\d+)?)\s*(kg|lb|und)\s*$/i);
    if (!m?.[1] || !m?.[2]) return null;
    const quantity = parseNumeric(m[1]);
    if (!quantity || quantity <= 0) return null;
    const unit = /\bkg\b/i.test(m[2]) ? "kg" : /\blb\b/i.test(m[2]) ? "lb" : "und";
    return { quantity, unit };
}

function parseCorrectionMessage(message: string): { from: string; to: string } | null {
    const raw = normalizeText(message).replace(/\s+/g, " ").trim();
    const swap = raw.match(/^(?:mejor\s+)?(?:cambia|cambie|cambiar|cámbiame|cambiame|reemplaza|reemplace)\s+(.+?)\s+por\s+(.+)$/i);
    if (swap?.[1] && swap?.[2]) {
        const from = normalizeRequestedProductTerm(swap[1]);
        const to = normalizeRequestedProductTerm(swap[2]);
        if (from && to) return { from, to };
    }
    const m = raw.match(/^(.+?)\s+no[, ]+\s*(.+)$/i);
    if (!m?.[1] || !m?.[2]) return null;
    const from = cleanSearchTerm(m[1]);
    const to = cleanSearchTerm(m[2]);
    if (!from || !to) return null;
    return { from, to };
}

function cartSummary(items: CartItem[]) {
    if (items.length === 0) return "El carrito está vacío todavía.";
    const lines = items.map((i) => {
        return `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`;
    });
    const total = items.reduce((acc, i) => acc + i.quantity * i.price, 0);
    return `TIRILLA DE COMPRA:\n${lines.join("\n")}\nTOTAL A PAGAR: $${total}`;
}

function merchandiseTotal(items: CartItem[]) {
    return items.reduce((acc, i) => acc + i.quantity * i.price, 0);
}

function shippingCost(items: CartItem[], city?: string | null, config?: StoreConfigLike | null) {
    return calculateShippingAmount(merchandiseTotal(items), city, config);
}

function minimumOrderStatusText(subtotal: number, config?: StoreConfigLike | null) {
    const minimum = minimumOrderThreshold(config);
    if (minimum <= 0) return null;
    if (subtotal >= minimum) return `Ya cumples el pedido mínimo de $${minimum}.`;
    return `Te faltan $${minimum - subtotal} para llegar al pedido mínimo.`;
}

function checkoutSummary(items: CartItem[], deliveryInfo: DeliveryInfo, city?: string | null, config?: StoreConfigLike | null) {
    if (items.length === 0) return "El carrito está vacío todavía.";
    const lines = items.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`);
    const subtotal = merchandiseTotal(items);
    const shipping = shippingCost(items, city, config);
    const total = subtotal + shipping;
    const shippingLine = shipping === 0 ? "Envío: GRATIS" : `Envío: $${shipping}`;
    const minimumLine = minimumOrderStatusText(subtotal, config);
    return `TIRILLA DE COMPRA:\n${lines.join("\n")}\nSubtotal mercado: $${subtotal}\n${shippingLine}${minimumLine ? `\n${minimumLine}` : ""}\nTOTAL A PAGAR: $${total}\n${deliveryInfo.note}`;
}

function compactItems(items: CartItem[]) {
    return items.map((i) => `${i.quantity} x ${i.name}`).join(", ");
}

function cartHasProductTerm(cart: CartItem[], term: string) {
    const queryTokens = tokenizeForMatch(term);
    if (queryTokens.length === 0) return false;
    return cart.some((item) => hasTokenMatch(item.name, queryTokens));
}

function isRecommendationCandidate(name: string, queryTerm?: string) {
    const n = normalizeForMatch(name);
    const q = normalizeForMatch(queryTerm || "");
    if (n.includes("super promo")) return false;
    if (n.includes("promo") && !q.includes("promo")) return false;
    return true;
}

function visibleNotFoundTerms(terms: string[]) {
    return terms.filter((term) => {
        const normalized = normalizeForMatch(term);
        if (!normalized) return false;
        if (/^(script|alert|onclick|onerror|style|div|span|html|body)$/.test(normalized)) return false;
        return true;
    });
}

function detectAmbiguousQuantityProduct(message: string): string | null {
    const text = cleanSearchTerm(message);
    const match = text.match(/\b(un poco de|poquito de|poquita de|algo de|unas|unos)\s+([a-záéíóúñü\s]+)$/i);
    if (!match?.[2]) return null;
    const product = match[2]
        .replace(/\b(para|por favor|porfa|gracias)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return product || null;
}

function detectMealIntent(message: string) {
    return MEAL_INTENT_BUNDLES.find((bundle) => bundle.pattern.test(message));
}

function hasExplicitUnitWord(message: string) {
    const text = normalizeQuantityWords(normalizeText(message));
    return /\b(kg|lb|und|carton|bidon|canastilla|lts|bja|atado)\b/.test(text);
}

function extractUnitChoice(message: string): string | null {
    const text = normalizeQuantityWords(normalizeText(message));
    const matches = Array.from(
        text.matchAll(/\b(kg|lb|und|carton|bidon|canastilla|lts|bja|atado)\b/g),
        (match) => normalizeUnitCode(match[1] || "")
    ).filter(Boolean);
    const uniqueUnits = Array.from(new Set(matches));
    return uniqueUnits.length === 1 ? uniqueUnits[0] : null;
}

function extractRequestedUnit(message: string): string | null {
    return extractUnitChoice(message);
}

function messageCarriesOwnProductIntent(message: string) {
    const intents = parseMultipleOrderIntents(message);
    if (intents.length > 0) return true;
    const singleIntent = parseOrderIntent(message);
    return Boolean(singleIntent?.product);
}

function intentLikelyTargetsPendingIntent(intent: ParsedIntent, pendingIntent: ParsedIntent) {
    const intentTokens = tokenizeForMatch(intent.product);
    const pendingTokens = tokenizeForMatch(pendingIntent.product);
    if (intentTokens.length === 0 || pendingTokens.length === 0) return false;
    return pendingTokens.some((token) => intentTokens.includes(token));
}

function messageResolvesPendingUnitIntent(message: string, pendingIntent: ParsedIntent) {
    const intents = parseMultipleOrderIntents(message);
    if (intents.length === 1 && intentLikelyTargetsPendingIntent(intents[0], pendingIntent)) {
        return intents[0];
    }

    const singleIntent = parseOrderIntent(message);
    if (
        singleIntent?.product &&
        typeof singleIntent.quantity === "number" &&
        intentLikelyTargetsPendingIntent(singleIntent as ParsedIntent, pendingIntent)
    ) {
        return singleIntent as ParsedIntent;
    }

    return null;
}

function isUnitOnlyText(text: string) {
    const normalized = normalizeQuantityWords(cleanSearchTerm(text));
    return /^(kg|lb|und|carton|bidon|canastilla|lts|bja|atado)$/.test(normalized);
}

function isSancochoRequest(message: string) {
    const text = stripDiacritics(normalizeText(message));
    return /\b(para un sancocho|sancocho|algo para el almuerzo)\b/.test(text);
}

function normalizePersonaMode(raw: unknown): PersonaMode {
    const value = String(raw || "").trim().toLowerCase();
    if (value === "chef_gourmet") return "chef_gourmet";
    if (value === "ahorrador_inteligente") return "ahorrador_inteligente";
    if (value === "eficiente_express") return "eficiente_express";
    return "asistente_familiar";
}

type DeliveryInfo = {
    fullDate: string;
    dateOnly: string;
    window: string;
    note: string;
};

const GENERIC_VARIANT_TERMS = new Set([
    "papa",
    "tomate",
    "cebolla",
    "aguacate",
    "pina",
    "piña",
    "mango",
    "banano",
    "platano",
    "plátano",
    "limon",
    "limón",
    "aji",
    "ají",
    "pimenton",
    "pimentón",
    "zukini",
    "pepino",
    "champinon",
    "champiñon"
]);

const GENERIC_VARIANT_EXCLUSIONS: Record<string, RegExp[]> = {
    tomate: [/\btomate de arbol\b/i, /\bde arbol\b/i],
    cebolla: [],
    papa: [],
    aguacate: [],
    pina: [],
    piña: [],
    mango: [],
    banano: [],
    platano: [],
    "plátano": [],
    limon: [],
    "limón": [],
    aji: [],
    "ají": [],
    pimenton: [],
    "pimentón": [],
    zukini: [],
    pepino: [],
    champinon: [],
    "champiñon": []
};

const PROCESSED_PRODUCT_HINT = /\b(zumo|jugo|pulpa|aceite|salsa|mermelada)\b/i;

function getDeliveryInfo(horaCorte?: string | null, deliveryWindow?: string | null): DeliveryInfo {
    const schedule = buildDeliverySchedule(horaCorte, new Date(), deliveryWindow);
    return {
        fullDate: schedule.fullDateLabel,
        dateOnly: schedule.dateLabel,
        window: schedule.window,
        note: schedule.note
    };
}

function getSupportWhatsapp(config?: StoreConfigLike | null) {
    return String(config?.supportWhatsapp || DEFAULT_SUPPORT_WHATSAPP).replace(/\D/g, "") || DEFAULT_SUPPORT_WHATSAPP;
}

function getSiteUrl(config?: StoreConfigLike | null) {
    return config?.siteUrl || config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || process.env.NEXT_PUBLIC_APP_URL || "https://elverdulero.com.co";
}

function getStoreName(config?: StoreConfigLike | null) {
    return config?.nombreTienda || "El Verdulero";
}

function buildSystemPrompt(basePrompt: string | null | undefined, personaMode: PersonaMode, deliveryInfo: DeliveryInfo, cutoffLabel: string) {
    const base = (basePrompt || DEFAULT_SYSTEM_PROMPT).trim();
    return `${base}

${PERSONA_PROMPTS[personaMode]}

${METHOD_GUARDRAILS}

${NON_INVENTION_RULE}

${RESPONSE_JSON_RULES}

REGLA DE ENTREGA (OBLIGATORIA):
- Corte diario: ${cutoffLabel} (hora de Bucaramanga).
- Si el pedido entra antes de la hora de corte, entrega al día siguiente.
- Si entra desde la hora de corte en adelante, entrega pasado mañana.
- FECHA ACTUAL CALCULADA: ${deliveryInfo.fullDate}.
- FRANJA DE ENTREGA: ${deliveryInfo.window}.
- Debes mencionar explícitamente la fecha de entrega en confirmaciones y resúmenes de pedido.`;
}

async function buildFullSystemPrompt(
    basePrompt: string | null | undefined,
    personaMode: PersonaMode,
    deliveryInfo: DeliveryInfo,
    config?: StoreConfigLike
) {
    const staticPrompt = buildSystemPrompt(basePrompt, personaMode, deliveryInfo, config?.horaCorte || "14:00");

    try {
        const [catalogContext, learnedRules] = await Promise.all([
            buildCatalogSystemContext(config),
            loadApprovedLearnedRules()
        ]);

        const learnedBlock = learnedRules.length > 0
            ? `

REGLAS APRENDIDAS Y APROBADAS:
${learnedRules.map((rule: string, index: number) => `${index + 1}. ${rule}`).join("\n")}`
            : "";

        return `${staticPrompt}

${catalogContext}${learnedBlock}`;
    } catch (error) {
        console.error("Prompt enrichment error:", error);
        return staticPrompt;
    }
}

function hashText(input: string) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function pickConfirmationPhrase(seedText: string, personaMode: PersonaMode) {
    const byPersona: Record<PersonaMode, string[]> = {
        chef_gourmet: ["¡Marchando, veci!", "¡Buena elección!", "Perfecto, ya va en la canasta."],
        ahorrador_inteligente: ["Anotado, veci.", "Listo, optimizado.", "Perfecto, ya quedó registrado."],
        asistente_familiar: ["¡De una, veci!", "Anotado con gusto.", "Perfecto, ya lo dejo en la canasta."],
        eficiente_express: ["Listo.", "Anotado.", "Perfecto."]
    };
    const options = byPersona[personaMode];
    const index = hashText(seedText || "ok") % options.length;
    return options[index];
}

function closingLine(personaMode: PersonaMode) {
    if (personaMode === "chef_gourmet") return "¡Listo veci! Que disfrute su comida.";
    if (personaMode === "ahorrador_inteligente") return "¡Listo! Compra optimizada, veci.";
    if (personaMode === "eficiente_express") return "Listo. Pedido en marcha.";
    return "¡Listo veci! Todo va quedando en orden.";
}

function normalizeOrderItems(raw: unknown): CartItem[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item: any) => ({
            product_id: Number(item.product_id || item.id || 0),
            name: String(item.name || "").trim(),
            quantity: Number(item.quantity || 0),
            unit: normalizeUnitCode(item.unit) || "und",
            price: Number(item.price || 0),
            image: item.image || undefined
        }))
        .filter((i) => i.name && i.quantity > 0 && i.price >= 0);
}

async function getReturningContext(phone: string): Promise<ReturningContext> {
    const customer = await prisma.customer.findUnique({ where: { phone } });
    const lastOrder = await prisma.order.findFirst({
        where: { customerPhone: phone },
        orderBy: { createdAt: "desc" }
    });

    let lastItems: CartItem[] = [];
    if (lastOrder?.items) {
        try {
            lastItems = normalizeOrderItems(JSON.parse(lastOrder.items));
        } catch {
            lastItems = [];
        }
    }

    return {
        customer: customer
            ? {
                name: customer.name,
                email: customer.email,
                lastAddress: customer.lastAddress,
                lastCity: customer.lastCity
            }
            : null,
        lastItems
    };
}

async function getReturningContextByEmail(email: string): Promise<ReturningContext> {
    const customer = await prisma.customer.findFirst({
        where: {
            email: {
                equals: email,
                mode: "insensitive"
            }
        }
    });

    if (customer) {
        return getReturningContext(customer.phone);
    }

    const recentSession = await prisma.chatSession.findFirst({
        where: {
            customerEmail: {
                equals: email,
                mode: "insensitive"
            }
        },
        orderBy: {
            updatedAt: "desc"
        },
        select: {
            customerName: true,
            customerEmail: true,
            customerAddress: true,
            customerCity: true
        }
    });

    if (!recentSession?.customerName) {
        return { customer: null, lastItems: [] };
    }

    return {
        customer: {
            name: recentSession.customerName,
            email: recentSession.customerEmail || email,
            lastAddress: recentSession.customerAddress || null,
            lastCity: recentSession.customerCity || null
        },
        lastItems: []
    };
}

async function suggestAlternativesFromInventory(requested: string, cart: CartItem[], config?: StoreConfigLike, limit = 2) {
    const suggestions: CartItem[] = [];
    const seenIds = new Set<number>();
    const normalizedRequested = normalizeForMatch(requested);
    const replacementTerms = CULINARY_REPLACEMENTS[normalizedRequested] || [];
    const fallbackTerms = replacementTerms.filter(Boolean);

    if (fallbackTerms.length === 0) {
        return [];
    }

    for (const term of fallbackTerms) {
        const products = await executeGetProducts(term, config);
        if (!Array.isArray(products) || products.length === 0) continue;
        for (const p of products) {
            if (suggestions.length >= limit) break;
            if (!p?.id || seenIds.has(p.id)) continue;
            if (!isRecommendationCandidate(p.name, term)) continue;
            if (cartHasProductTerm(cart, p.name)) continue;
            seenIds.add(p.id);
            suggestions.push({
                product_id: p.id,
                name: p.name,
                quantity: 1,
                unit: canonicalCatalogUnit(p.unit || "und", p.name),
                price: Number(p.price || 0),
                image: p.image || undefined
            });
        }
        if (suggestions.length >= limit) break;
    }

    return suggestions;
}

async function buildCrossSellSuggestions(cart: CartItem[], config?: StoreConfigLike, limit = 3) {
    const suggestions: CartItem[] = [];
    const seen = new Set<number>();
    const seedTerms = new Set<string>();

    for (const item of cart) {
        const normalizedName = normalizeForMatch(item.name);
        for (const [seed, related] of Object.entries(CROSS_SELL_ASSOCIATIONS)) {
            if (normalizedName.includes(seed)) {
                related.forEach((r) => seedTerms.add(r));
            }
        }
    }

    for (const term of Array.from(seedTerms)) {
        const products = await executeGetProducts(term, config);
        if (!Array.isArray(products) || products.length === 0) continue;
        const candidate = pickBestProduct(products, term) || products[0];
        if (!candidate?.id || seen.has(candidate.id)) continue;
        if (cartHasProductTerm(cart, candidate.name)) continue;
        seen.add(candidate.id);
        suggestions.push({
            product_id: candidate.id,
            name: candidate.name,
            quantity: 1,
            unit: canonicalCatalogUnit(candidate.unit || "und", candidate.name),
            price: Number(candidate.price || 0),
            image: candidate.image || undefined
        });
        if (suggestions.length >= limit) break;
    }

    return suggestions;
}

async function buildDayOfWeekSuggestion(phone: string | undefined, cart: CartItem[], config?: StoreConfigLike) {
    if (!phone) return null;

    const orders = await prisma.order.findMany({
        where: { customerPhone: phone },
        orderBy: { createdAt: "desc" },
        take: 20
    });

    if (orders.length === 0) return null;
    const today = new Date().getDay();
    const sameWeekday = orders.filter((o) => new Date(o.createdAt).getDay() === today);
    if (sameWeekday.length === 0) return null;

    const counts = new Map<string, number>();
    for (const order of sameWeekday) {
        let items: CartItem[] = [];
        try {
            items = normalizeOrderItems(JSON.parse(order.items || "[]"));
        } catch {
            items = [];
        }
        for (const item of items) {
            const key = normalizeForMatch(item.name);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const term = top[0];
    const products = await executeGetProducts(term, config);
    if (!Array.isArray(products) || products.length === 0) return null;
    const candidate = pickBestProduct(products, term) || products[0];
    if (!candidate || cartHasProductTerm(cart, candidate.name)) return null;

    return {
        product_id: candidate.id,
        name: candidate.name,
        quantity: 1,
        unit: canonicalCatalogUnit(candidate.unit || "und", candidate.name),
        price: Number(candidate.price || 0),
        image: candidate.image || undefined
    } as CartItem;
}

async function buildVerduleroRuleSuggestions(lastUserContent: string, cart: CartItem[], config?: StoreConfigLike) {
    const text = stripDiacritics(normalizeText(lastUserContent));
    const suggestions: CartItem[] = [];
    const seen = new Set<number>();
    const addIfValid = async (id: number, expectedTerms?: string[]) => {
        if (seen.has(id)) return;
        const product = await executeGetProductById(id, config);
        if (!product) return;
        if (expectedTerms && expectedTerms.length > 0) {
            const normalizedName = normalizeForMatch(product.name);
            const ok = expectedTerms.every((t) => normalizedName.includes(normalizeForMatch(t)));
            if (!ok) return;
        }
        if (cartHasProductTerm(cart, product.name)) return;
        seen.add(id);
        suggestions.push({
            product_id: product.id,
            name: product.name,
            quantity: 1,
            unit: canonicalCatalogUnit(product.unit || "und", product.name),
            price: Number(product.price || 0),
            image: product.image || undefined
        });
    };

    if (/\b(sancocho|para un sancocho|algo para el almuerzo)\b/.test(text)) {
        const fallback = await resolveIntents([
            { quantity: 1, product: "arracacha" },
            { quantity: 1, product: "ahuyama" },
            { quantity: 1, product: "mazorca" }
        ], cart, config);
        suggestions.push(...fallback.resolved.slice(0, 3));
        return suggestions;
    }

    if (/\b(cebolla|tomate)\b/.test(text)) {
        await addIfValid(40); // Aji dulce rojo
    }
    if (FRUIT_HINTS.test(text)) {
        const fruitResolved = await resolveIntents([
            { quantity: 1, product: "banano maduro" },
            { quantity: 1, product: "guanabana" }
        ], cart, config);
        suggestions.push(...fruitResolved.resolved.slice(0, 2).filter((i) => !seen.has(i.product_id)));
    }
    if (GREEN_HINTS.test(text)) {
        const greensResolved = await resolveIntents([
            { quantity: 1, product: "brocoli" },
            { quantity: 1, product: "acelga" }
        ], cart, config);
        suggestions.push(...greensResolved.resolved.slice(0, 2).filter((i) => !seen.has(i.product_id)));
    }

    return suggestions.slice(0, 3);
}

async function loadDraft(sessionId: string | null): Promise<DraftState> {
    if (!sessionId) return { cart: [], pending: [], pendingUnitIntents: [], pendingUnitChoice: null, pendingVariant: null, pendingQuantity: null, awaitingCheckoutConfirmation: false, pendingCheckoutAfterIntake: false, stage: "saludo" };
    const draft = await prisma.orderDraft.findUnique({ where: { sessionId } });
    if (!draft) return { cart: [], pending: [], pendingUnitIntents: [], pendingUnitChoice: null, pendingVariant: null, pendingQuantity: null, awaitingCheckoutConfirmation: false, pendingCheckoutAfterIntake: false, stage: "saludo" };
    try {
        const parsed = JSON.parse(draft.data || "{}");
        return {
            cart: Array.isArray(parsed.cart) ? parsed.cart : [],
            pending: Array.isArray(parsed.pending) ? parsed.pending : [],
            intakeCompleted: Boolean(parsed.intakeCompleted),
            pendingUnitIntents: Array.isArray(parsed.pendingUnitIntents) ? parsed.pendingUnitIntents : [],
            pendingUnitChoice: typeof parsed.pendingUnitChoice === "string" ? parsed.pendingUnitChoice : null,
            pendingFollowupIntents: Array.isArray(parsed.pendingFollowupIntents) ? parsed.pendingFollowupIntents : [],
            pendingVariant: parsed.pendingVariant && Array.isArray(parsed.pendingVariant.options)
                ? {
                    searchTerm: String(parsed.pendingVariant.searchTerm || ""),
                    quantity: typeof parsed.pendingVariant.quantity === "number" ? parsed.pendingVariant.quantity : null,
                    explicitUnit: typeof parsed.pendingVariant.explicitUnit === "string" ? parsed.pendingVariant.explicitUnit : null,
                    options: normalizeOrderItems(parsed.pendingVariant.options),
                    correctionFromProductId: Number(parsed.pendingVariant.correctionFromProductId || 0) || null,
                    correctionFromName: typeof parsed.pendingVariant.correctionFromName === "string" ? parsed.pendingVariant.correctionFromName : null,
                    followupIntents: Array.isArray(parsed.pendingVariant.followupIntents) ? parsed.pendingVariant.followupIntents : []
                }
                : null,
            pendingQuantity: parsed.pendingQuantity?.item
                ? { item: normalizeOrderItems([parsed.pendingQuantity.item])[0] }
                : null,
            awaitingCheckoutConfirmation: Boolean(parsed.awaitingCheckoutConfirmation),
            pendingCheckoutAfterIntake: Boolean(parsed.pendingCheckoutAfterIntake),
            stage: parsed.stage === "captura_datos" || parsed.stage === "toma_pedido" || parsed.stage === "confirmacion" || parsed.stage === "cerrado" ? parsed.stage : "saludo"
        };
    } catch {
        return { cart: [], pending: [], pendingUnitIntents: [], pendingUnitChoice: null, pendingVariant: null, pendingQuantity: null, awaitingCheckoutConfirmation: false, pendingCheckoutAfterIntake: false, stage: "saludo" };
    }
}

async function saveDraft(sessionId: string | null, state: DraftState) {
    if (!sessionId) return;
    await prisma.orderDraft.upsert({
        where: { sessionId },
        update: { data: JSON.stringify(state) },
        create: { sessionId, data: JSON.stringify(state) }
    });
}

async function recordLearningEvent(params: {
    sessionId: string | null;
    userMessage: string;
    assistantText: string;
    profile: CustomerProfile;
    draft: DraftState;
    contract: AssistantContract;
}) {
    if (!params.sessionId || !params.userMessage || !params.assistantText) return;

    try {
        const cartTotal = params.draft.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        await prisma.learningEvent.create({
            data: {
                id: `le_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                sessionId: params.sessionId,
                buyerName: params.profile.nombre || null,
                userMessage: redactSensitiveText(params.userMessage),
                assistantText: redactSensitiveText(params.assistantText),
                action: params.contract.intent,
                extractedEntities: JSON.stringify({
                    fields_detected: params.contract.fields_detected,
                    items: params.contract.items,
                    next_action: params.contract.next_action
                }),
                stateSnapshot: JSON.stringify({
                    stage: params.contract.stage,
                    cartCount: params.draft.cart.length,
                    cartTotal,
                    pendingCount: params.draft.pending.length,
                    pendingUnitCount: params.draft.pendingUnitIntents?.length || 0,
                    hasPendingVariant: Boolean(params.draft.pendingVariant),
                    hasPendingQuantity: Boolean(params.draft.pendingQuantity),
                    awaitingRepeatChoice: Boolean(params.draft.awaitingRepeatChoice),
                    pendingCheckoutAfterIntake: Boolean(params.draft.pendingCheckoutAfterIntake),
                    awaitingCheckoutConfirmation: Boolean(params.draft.awaitingCheckoutConfirmation),
                    profileComplete: hasCompleteProfile(params.profile)
                }),
                recommendations: JSON.stringify({
                    next_action: params.contract.next_action,
                    shouldEscalate: /error|enredo|no entiende|no puedo|no deja/i.test(params.userMessage),
                    shouldReviewNotFound: /no encontr[ée]|no tengo|no manejo|no aparece|no existe/i.test(params.assistantText)
                })
            }
        });
    } catch (error) {
        console.warn("Learning event skipped:", error);
    }
}

async function resolveIntentToCartItem(intent: ParsedIntent, cart: CartItem[], config?: StoreConfigLike): Promise<IntentResolution> {
    const normalizedProductTerm = normalizeRequestedProductTerm(intent.product);
    const products = await searchProductsByTerm(normalizedProductTerm, config);
    const filteredProducts = filterProductsForGenericFamily(normalizedProductTerm, products);

    if (filteredProducts.length > 0) {
        const exact = filteredProducts.find((product) => normalizeForMatch(product.name) === normalizeForMatch(normalizedProductTerm));
        if (exact) {
            const exactItem = {
                product_id: exact.id,
                name: exact.name,
                quantity: intent.quantity,
                unit: canonicalCatalogUnit(exact.unit || "und", exact.name),
                price: exact.price,
                image: exact.image || undefined
            };
            if (requiresUnitClarification(intent.requestedUnit, exactItem.unit, exactItem.name)) {
                return {
                    item: null,
                    unitClarification: {
                        intent,
                        item: exactItem
                    }
                };
            }
            if (!isValidQuantityForUnit(intent.quantity, exactItem.unit)) {
                return {
                    item: null,
                    quantityRestriction: {
                        intent,
                        item: exactItem
                    }
                };
            }
            return {
                item: exactItem
            };
        }

        if (shouldForceVariantChoice(normalizedProductTerm, filteredProducts)) {
            const forcedOptions = variantOptionsFromProducts(filteredProducts, normalizedProductTerm);
            if (forcedOptions.length > 0) {
                return {
                    item: null,
                    ambiguous: {
                        searchTerm: normalizedProductTerm,
                        quantity: intent.quantity,
                        options: forcedOptions
                    }
                };
            }
        }

        const variants = variantOptionsFromProducts(filteredProducts, normalizedProductTerm);
        if (variants.length > 0) {
            return {
                item: null,
                ambiguous: {
                    searchTerm: normalizedProductTerm,
                    quantity: intent.quantity,
                    options: variants
                }
            };
        }

        const strongProducts = filteredProducts.filter((product) => isStrongProductMatch(product.name, normalizedProductTerm));
        if (tokenizeForMatch(normalizedProductTerm).length > 1 && strongProducts.length === 0) {
            return { item: null };
        }
        if (strongProducts.length > 1) {
            return {
                item: null,
                ambiguous: {
                    searchTerm: normalizedProductTerm,
                    quantity: intent.quantity,
                    options: strongProducts.slice(0, 4).map((product) => ({
                        product_id: product.id,
                        name: product.name,
                        quantity: 1,
                        unit: canonicalCatalogUnit(product.unit || "und", product.name),
                        price: Number(product.price || 0),
                        image: product.image || undefined
                    }))
                }
            };
        }

        const product = pickBestProduct(strongProducts.length > 0 ? strongProducts : filteredProducts, normalizedProductTerm);
        if (product) {
            const resolvedItem = {
                product_id: product.id,
                name: product.name,
                quantity: intent.quantity,
                unit: canonicalCatalogUnit(product.unit || "und", product.name),
                price: product.price,
                image: product.image || undefined
            };
            if (requiresUnitClarification(intent.requestedUnit, resolvedItem.unit, resolvedItem.name)) {
                return {
                    item: null,
                    unitClarification: {
                        intent,
                        item: resolvedItem
                    }
                };
            }
            if (!isValidQuantityForUnit(intent.quantity, resolvedItem.unit)) {
                return {
                    item: null,
                    quantityRestriction: {
                        intent,
                        item: resolvedItem
                    }
                };
            }
            return {
                item: resolvedItem
            };
        }
    }

    const suggested = await suggestAlternativesFromInventory(normalizedProductTerm, cart, config, 1);
    if (suggested.length > 0) {
        const alt = suggested[0];
        return { item: null, substitutionNote: `No encontré "${normalizedProductTerm}" exacto, pero sí le puedo ofrecer ${alt.name} a $${alt.price}.` };
    }

    return { item: null };
}

async function resolveIntents(intents: ParsedIntent[], cart: CartItem[], config?: StoreConfigLike) {
    const resolved: CartItem[] = [];
    const notFound: string[] = [];
    const substitutionNotes: string[] = [];
    let quantityRestriction: QuantityRestriction | null = null;
    let unitClarification: IntentResolution["unitClarification"] | null = null;
    let ambiguous: IntentResolution["ambiguous"] | null = null;
    for (const intent of intents) {
        const {
            item,
            substitutionNote,
            ambiguous: currentAmbiguous,
            unitClarification: currentUnitClarification,
            quantityRestriction: currentQuantityRestriction
        } = await resolveIntentToCartItem(intent, cart, config);
        if (currentQuantityRestriction && !quantityRestriction) {
            quantityRestriction = currentQuantityRestriction;
            continue;
        }
        if (currentUnitClarification && !unitClarification) {
            unitClarification = currentUnitClarification;
            continue;
        }
        if (currentAmbiguous && !ambiguous) {
            ambiguous = currentAmbiguous;
            continue;
        }
        if (item) resolved.push(item);
        else if (!currentAmbiguous) notFound.push(intent.product);
        if (substitutionNote) substitutionNotes.push(substitutionNote);
    }
    return { resolved, notFound, substitutionNotes, ambiguous, unitClarification, quantityRestriction };
}

function armPendingVariant(
    draft: DraftState,
    ambiguous: NonNullable<IntentResolution["ambiguous"]>,
    explicitUnit: string | null = null
) {
    draft.pendingVariant = {
        searchTerm: ambiguous.searchTerm,
        quantity: ambiguous.quantity,
        explicitUnit,
        options: ambiguous.options
    };
    draft.pendingQuantity = null;
}

function intentsWithoutSearchTerm(intents: ParsedIntent[], searchTerm: string) {
    const target = normalizeForMatch(normalizeRequestedProductTerm(searchTerm));
    return intents.filter((intent) => normalizeForMatch(normalizeRequestedProductTerm(intent.product)) !== target);
}

function intentMatchesResolvedItem(intent: ParsedIntent, item: CartItem) {
    const intentTokens = tokenizeForMatch(intent.product);
    if (intentTokens.length === 0) return false;
    return hasTokenMatch(item.name, intentTokens);
}

function unresolvedFollowupIntents(
    intents: ParsedIntent[],
    resolved: CartItem[],
    ambiguousSearchTerm?: string | null
) {
    const ambiguousTarget = ambiguousSearchTerm
        ? normalizeForMatch(normalizeRequestedProductTerm(ambiguousSearchTerm))
        : null;
    const remainingResolved = [...resolved];
    const remaining: ParsedIntent[] = [];

    for (const intent of intents) {
        const normalizedIntent = normalizeForMatch(normalizeRequestedProductTerm(intent.product));
        if (ambiguousTarget && normalizedIntent === ambiguousTarget) continue;

        const resolvedIndex = remainingResolved.findIndex((item) => intentMatchesResolvedItem(intent, item));
        if (resolvedIndex >= 0) {
            remainingResolved.splice(resolvedIndex, 1);
            continue;
        }

        remaining.push(intent);
    }

    return remaining;
}

function mergePendingIntentLists(...lists: (ParsedIntent[] | undefined | null)[]) {
    const merged = new Map<string, ParsedIntent>();
    for (const list of lists) {
        for (const intent of list || []) {
            const normalizedProduct = normalizeForMatch(normalizeRequestedProductTerm(intent.product));
            const key = `${normalizedProduct}::${intent.quantity}::${intent.requestedUnit || ""}`;
            if (!merged.has(key)) {
                merged.set(key, intent);
            }
        }
    }
    return Array.from(merged.values());
}

function pendingIntentQueueText(intents: ParsedIntent[]) {
    if (intents.length === 0) return "";
    const names = Array.from(new Set(intents.map((intent) => normalizeRequestedProductTerm(intent.product)).filter(Boolean)));
    if (names.length === 0) return "";
    return `\nTambién tengo pendientes: ${names.join(", ")}. Los resolvemos apenas escoja esta opción.`;
}

function missingUnitHintForIntents(intents: ParsedIntent[]) {
    if (intents.length < 2) return "";
    if (!intents.some((intent) => !intent.requestedUnit)) return "";
    return "\nSi esas cantidades venían sin medida, dígame si son en libras o en unidades para no equivocarme.";
}

function requestedUnitForSearchTerm(intents: ParsedIntent[], searchTerm: string) {
    const normalizedTarget = normalizeForMatch(normalizeRequestedProductTerm(searchTerm));
    const matched = intents.find(
        (intent) => normalizeForMatch(normalizeRequestedProductTerm(intent.product)) === normalizedTarget
    );
    return matched?.requestedUnit || null;
}

function unresolvedAfterUnitClarification(
    intents: ParsedIntent[],
    resolved: CartItem[],
    unitClarification: NonNullable<IntentResolution["unitClarification"]>
) {
    const clarifiedTarget = normalizeForMatch(normalizeRequestedProductTerm(unitClarification.intent.product));
    return unresolvedFollowupIntents(intents, resolved).filter(
        (intent) => normalizeForMatch(normalizeRequestedProductTerm(intent.product)) !== clarifiedTarget
    );
}

function unresolvedAfterQuantityRestriction(
    intents: ParsedIntent[],
    resolved: CartItem[],
    quantityRestriction: QuantityRestriction
) {
    const blockedTarget = normalizeForMatch(normalizeRequestedProductTerm(quantityRestriction.intent.product));
    return unresolvedFollowupIntents(intents, resolved).filter(
        (intent) => normalizeForMatch(normalizeRequestedProductTerm(intent.product)) !== blockedTarget
    );
}

async function continueFollowupIntents(
    draft: DraftState,
    followups: ParsedIntent[],
    explicitUnit: string | null,
    config?: StoreConfigLike
) {
    if (followups.length === 0) return null;

    const { resolved, notFound, substitutionNotes, ambiguous, unitClarification, quantityRestriction } = await resolveIntents(followups, draft.cart, config);

    if (ambiguous) {
        const mergedResolved = mergeResolvedIntoDraft(draft, resolved, explicitUnit);
        armPendingVariant(draft, ambiguous, requestedUnitForSearchTerm(followups, ambiguous.searchTerm) || explicitUnit);
        const pendingFollowups = unresolvedFollowupIntents(followups, mergedResolved, ambiguous.searchTerm);
        draft.pendingVariant = {
            ...draft.pendingVariant!,
            followupIntents: pendingFollowups
        };
        return {
            reply: `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${variantPrompt(ambiguous.searchTerm, ambiguous.options)}${pendingIntentQueueText(pendingFollowups)}${missingUnitHintForIntents(followups)}`.trim()
        };
    }

    if (quantityRestriction) {
        const mergedResolved = mergeResolvedIntoDraft(draft, resolved, explicitUnit);
        draft.pendingQuantity = { item: quantityRestriction.item };
        draft.pendingFollowupIntents = unresolvedAfterQuantityRestriction(followups, mergedResolved, quantityRestriction);
        return {
            reply: `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${quantityRestrictionReply(quantityRestriction.intent, quantityRestriction.item)}`.trim()
        };
    }

    if (unitClarification) {
        const mergedResolved = mergeResolvedIntoDraft(draft, resolved, explicitUnit);
        draft.pendingUnitIntents = [unitClarification.intent];
        draft.pendingUnitChoice = unitClarification.intent.requestedUnit || explicitUnit || null;
        draft.pendingFollowupIntents = unresolvedAfterUnitClarification(followups, mergedResolved, unitClarification);
        return {
            reply: `${resolvedItemsSummary(mergedResolved)}${unitClarificationReply(unitClarification.intent, unitClarification.item)}`.trim()
        };
    }

    if (resolved.length > 0) {
        const mergedResolved = mergeResolvedIntoDraft(draft, resolved, explicitUnit);
        return {
            reply: `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}¿Qué más necesita?`.trim()
        };
    }

    if (notFound.length > 0) {
        return {
            reply: visibleNotFoundTerms(notFound).length > 0
                ? `No encontré: ${visibleNotFoundTerms(notFound).join(", ")}. ¿Qué más necesita?`
                : "¿Qué más necesita?"
        };
    }

    return null;
}

function lastIntentMessage(messages: ChatMessage[]) {
    const candidates = [...messages].reverse();
    for (const msg of candidates) {
        if (msg.role !== "user") continue;
        const intents = parseMultipleOrderIntents(msg.content);
        if (intents.length > 0) return { content: msg.content, intents };
    }
    return null;
}

function lastIntentMessageWithoutUnit(messages: ChatMessage[]) {
    const candidates = [...messages].reverse();
    for (const msg of candidates) {
        if (msg.role !== "user") continue;
        if (hasExplicitUnitWord(msg.content)) continue;
        const intents = parseMultipleOrderIntents(msg.content);
        if (intents.length > 0) return { content: msg.content, intents };
    }
    return null;
}

function assistantAskedToConfirmPending(messages: ChatMessage[]) {
    const lastAssistant = [...messages].reverse().find((msg) => msg.role === "assistant");
    if (!lastAssistant?.content) return false;
    const text = stripDiacritics(cleanSearchTerm(lastAssistant.content));
    return /(me confirma con si para agregar|la agrego al carrito con si|se lo agrego al carrito con si|le agrego alguno|le agrego (?:una|uno|ese|esa)|confirmado y agregado)/.test(text);
}

function assistantAskedRepeatChoice(messages: ChatMessage[]) {
    const lastAssistant = [...messages].reverse().find((msg) => msg.role === "assistant");
    if (!lastAssistant?.content) return false;
    const text = stripDiacritics(cleanSearchTerm(lastAssistant.content));
    return /(repetir tu mercado anterior|armamos uno nuevo|repetir pedido|uno nuevo)/.test(text);
}

function variantMessageMatchesOptions(message: string, pendingVariant: PendingVariantState) {
    const tokens = tokenizeForMatch(message);
    const optionTokens = pendingVariant.options.flatMap((option) => tokenizeForMatch(option.name));
    const genericTokens = tokenizeForMatch(pendingVariant.searchTerm);
    if (tokens.length === 0) return false;
    return tokens.some((token) => optionTokens.includes(token) || genericTokens.includes(token));
}

function userStartedDifferentProductWhileChoosingVariant(message: string, pendingVariant: PendingVariantState) {
    if (isPriceQuestion(message) || isAvailabilityQuestion(message) || isDoneOrderingIntent(message) || isCheckoutIntent(message)) {
        return false;
    }

    const intents = parseMultipleOrderIntents(message);
    const singleIntent = intents[0] || parseOrderIntent(message);
    if (!singleIntent?.product) return false;

    const requestedTokens = tokenizeForMatch(singleIntent.product);
    if (requestedTokens.length === 0) return false;

    const optionTokens = pendingVariant.options.flatMap((option) => tokenizeForMatch(option.name));
    const genericTokens = tokenizeForMatch(pendingVariant.searchTerm);
    return !requestedTokens.some((token) => optionTokens.includes(token) || genericTokens.includes(token));
}

function mergeCartItems(cart: CartItem[], additions: CartItem[]) {
    const merged = [...cart];
    for (const item of additions) {
        const existing = merged.find((entry) => entry.product_id === item.product_id && entry.unit === item.unit);
        if (existing) {
            existing.quantity += item.quantity;
        } else {
            merged.push(item);
        }
    }
    return merged;
}

function clearPendingOrderState(draft: DraftState) {
    draft.pending = [];
    draft.pendingUnitIntents = [];
    draft.pendingUnitChoice = null;
    draft.pendingFollowupIntents = [];
    draft.pendingVariant = null;
    draft.pendingQuantity = null;
}

function resetDraftForFreshBasket(draft: DraftState) {
    draft.cart = [];
    clearPendingOrderState(draft);
    draft.awaitingCheckoutConfirmation = false;
    draft.pendingCheckoutAfterIntake = false;
    draft.stage = "toma_pedido";
}

function mergeResolvedIntoDraft(
    draft: DraftState,
    resolved: CartItem[],
    unitOverride: string | null = null
) {
    if (resolved.length === 0) return [];
    const resolvedWithUnit = resolved.map((item) => ({
        ...item,
        unit: canonicalCatalogUnit(item.unit || unitOverride || "und", item.name)
    }));
    draft.cart = mergeCartItems(draft.cart, resolvedWithUnit);
    return resolvedWithUnit;
}

function resolvedItemsSummary(
    resolved: CartItem[],
    substitutionNotes: string[] = [],
    notFound: string[] = []
) {
    if (resolved.length === 0) return "";
    const lines = resolved.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`);
    const subtotal = resolved.reduce((acc, i) => acc + i.quantity * i.price, 0);
    const substitutionText = substitutionNotes.length > 0 ? `\nAjustes sugeridos:\n- ${substitutionNotes.join("\n- ")}` : "";
    const presentableNotFound = visibleNotFoundTerms(notFound);
    const notFoundText = presentableNotFound.length > 0 ? `\nNo encontré: ${presentableNotFound.join(", ")}.` : "";
    return `Ya te dejé listo esto:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.${substitutionText}${notFoundText}\n`;
}

async function reconstructCartFromMessages(messages: ChatMessage[], config?: StoreConfigLike) {
    const cart: CartItem[] = [];
    let pending: ParsedIntent[] = [];

    for (const msg of messages) {
        if (msg.role !== "user") continue;
        const intents = parseMultipleOrderIntents(msg.content);
        if (intents.length > 0) {
            pending = intents;
            continue;
        }

        if (pending.length > 0 && isAffirmative(msg.content)) {
            const { resolved } = await resolveIntents(pending, cart, config);
            cart.push(...resolved);
            pending = [];
            continue;
        }

        if (pending.length > 0 && isNegative(msg.content)) {
            pending = [];
        }
    }

    return cart;
}

function productCandidates(raw: string) {
    return sharedProductCandidates(raw);
}

function stripLeadingConversationFillers(raw: string) {
    return stripDiacritics(cleanSearchTerm(raw))
        .replace(/^(si|sí|claro|dale|de una|ok|bueno|listo)\s+/i, "")
        .trim();
}

function correctCommonProductTypos(raw: string) {
    return raw
        .replace(/\bsanaoria\b/g, "zanahoria")
        .replace(/\bsanahoria\b/g, "zanahoria")
        .replace(/\bperegil\b/g, "perejil")
        .replace(/\bsilantro\b/g, "cilantro")
        .replace(/\btomte\b/g, "tomate");
}

function normalizeRequestedProductTerm(raw: string) {
    const base = correctCommonProductTypos(stripLeadingConversationFillers(raw));
    const tokens = tokenizeForMatch(base).filter((token) => !["del", "al", "tien", "tiene", "tienes", "please", "give"].includes(token));
    if (tokens.length === 0) return cleanSearchTerm(base);

    return tokens
        .map((token) => singularizeSpanishToken(token))
        .join(" ")
        .trim();
}

function filterProductsForGenericFamily<T extends { name: string }>(searchTerm: string, products: T[]) {
    const normalized = normalizeForMatch(searchTerm);
    const exclusions = [...(GENERIC_VARIANT_EXCLUSIONS[normalized] || [])];
    const queryHasProcessedHint = PROCESSED_PRODUCT_HINT.test(searchTerm);
    const queryTokens = tokenizeForMatch(searchTerm);

    if (!queryHasProcessedHint && queryTokens.length <= 2 && GENERIC_VARIANT_TERMS.has(normalized)) {
        exclusions.push(PROCESSED_PRODUCT_HINT);
    }

    if (exclusions.length === 0) return products;
    return products.filter((product) => !exclusions.some((rule) => rule.test(product.name)));
}

function shouldForceVariantChoice(
    searchTerm: string,
    products: Array<{ name: string }>
) {
    const normalized = normalizeForMatch(searchTerm);
    const filtered = filterProductsForGenericFamily(searchTerm, products);
    const uniqueNames = new Set(filtered.map((product) => normalizeForMatch(product.name)));
    if (uniqueNames.size <= 1) return false;
    return GENERIC_VARIANT_TERMS.has(normalized) || tokenizeForMatch(searchTerm).length <= 1;
}

function variantOptionsFromProducts(
    products: Array<{ id: number; name: string; price: number; stock_status: string; image?: string | null; unit?: string }>,
    searchTerm: string
) {
    const filteredProducts = filterProductsForGenericFamily(searchTerm, products);
    const direct = buildVariantOptions(filteredProducts, searchTerm);
    if (direct.length > 0) return direct;

    const normalizedTerm = normalizeForMatch(searchTerm);
    const queryTokens = tokenizeForMatch(searchTerm);
    if (filteredProducts.length <= 1) return [];

    if (GENERIC_VARIANT_TERMS.has(normalizedTerm) || queryTokens.length <= 1) {
        return filteredProducts
            .slice(0, 6)
            .map((product) => ({
                product_id: product.id,
                name: product.name,
                quantity: 1,
                unit: canonicalCatalogUnit(product.unit || "und", product.name),
                price: Number(product.price || 0),
                image: product.image || undefined
            }));
    }

    return [];
}

function isPriceQuestion(message: string) {
    const text = stripDiacritics(normalizeText(message));
    return /(cu[aá]nto vale|precio de|a c[oó]mo (est[aá]|sale)|valor de)/.test(text);
}

function isAvailabilityQuestion(message: string) {
    const text = stripDiacritics(normalizeText(message));
    return /(tiene|hay|maneja|vende|cuenta con)\s+/.test(text)
        || /(hay|tiene)\s+\w+\??$/.test(text)
        || /(que\s+(frutas|verduras|productos)\s+(tienen|hay|manejan|venden|disponibles))/.test(text)
        || /(que\s+\w+\s+tienes)/.test(text)
        || /(que|cuales)\s+(otro\s*s?|otros|otras|tipos?|variedades?|opciones?)\s+(de\s+)?[\w\s]+\s+(hay|tienes|tiene|manejan|venden)\??$/.test(text)
        || /(que|cuales)\s+(hay|tienes|tiene|manejan|venden)\s+(de\s+)?[\w\s]+\??$/.test(text);
}

function extractProductFromPriceQuestion(message: string) {
    const text = stripLeadingConversationFillers(message);
    return normalizeRequestedProductTerm(text
        .replace(/(cuanto vale|precio de|a como esta|a como sale|valor de)/g, " ")
        .replace(/\b(kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos|carton|cartones|bidon|bidones|canastilla|canastillas|lt|lts|litro|litros|bja|bandeja|bandejas|atado|atados|rama|ramas|ramo|ramos|de|el|la|los|las)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim());
}

function extractProductFromAvailabilityQuestion(message: string) {
    const text = stripLeadingConversationFillers(message);
    const normalized = stripDiacritics(normalizeText(text));
    const optionsMatch = normalized.match(/(?:que|cuales)\s+(?:otro\s*s?|otros|otras|tipos?|variedades?|opciones?)\s+(?:de\s+)?(.+?)\s+(?:hay|tienes|tiene|manejan|venden)\??$/i);
    if (optionsMatch?.[1]) {
        return normalizeRequestedProductTerm(optionsMatch[1]
            .replace(/\b(de|el|la|los|las)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim());
    }

    const invertedOptionsMatch = normalized.match(/(?:que|cuales)\s+(?:hay|tienes|tiene|manejan|venden)\s+(?:de\s+)?(.+?)\??$/i);
    if (invertedOptionsMatch?.[1]) {
        return normalizeRequestedProductTerm(invertedOptionsMatch[1]
            .replace(/\b(de|el|la|los|las)\b/g, " ")
            .replace(/\s+/g, " ")
            .trim());
    }

    return normalizeRequestedProductTerm(text
        .replace(/\b(que\s+(frutas|verduras|productos)\s+(tienen|hay|manejan|venden|disponibles)|que\s+\w+\s+tienes|tienes|tiene|hay|maneja|vende|cuenta con|disponible|disponibles)\b/g, " ")
        .replace(/\b(kilo|kilos|kg|libra|libras|lb|unidad|unidades|und|botella|botellas|frasco|frascos|carton|cartones|bidon|bidones|canastilla|canastillas|lt|lts|litro|litros|bja|bandeja|bandejas|atado|atados|rama|ramas|ramo|ramos|de|el|la|los|las)\b/g, " ")
        .replace(/\b(que|cuales|cuáles)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim());
}

function extractCatalogCategoryQuestion(message: string): "frutas" | "verduras" | null {
    const text = stripDiacritics(normalizeText(message));
    if (/\b(frutas?)\b/.test(text)) return "frutas";
    if (/\b(verduras?|vegetales?)\b/.test(text)) return "verduras";
    return null;
}

async function searchProductsByTerm(productTerm: string, config?: StoreConfigLike) {
    const merged: any[] = [];
    const seenIds = new Set<number>();
    for (const candidate of productCandidates(productTerm)) {
        const searchResult = await executeGetProducts(candidate, config);
        if (Array.isArray(searchResult) && searchResult.length > 0) {
            for (const product of searchResult) {
                if (!product?.id || seenIds.has(product.id)) continue;
                seenIds.add(product.id);
                merged.push(product);
            }
        }
    }

    if (merged.length === 0) return [];

    const deduped = filterProductsForGenericFamily(productTerm, dedupeVisibleProducts(merged));
    const strongMatches = deduped
        .filter((product) => isStrongProductMatch(product.name, productTerm))
        .sort((a, b) => productMatchScore(b.name, productTerm).score - productMatchScore(a.name, productTerm).score);

    return strongMatches.length > 0 ? strongMatches : deduped;
}

async function priceReply(message: string, config?: StoreConfigLike) {
    const productTerm = extractProductFromPriceQuestion(message);
    if (!productTerm) return null;

    const resolvedProducts = await searchProductsByTerm(productTerm, config);

    if (resolvedProducts.length === 0) {
        const alternatives = await suggestAlternativesFromInventory(productTerm, [], config, 2);
        if (alternatives.length > 0) {
            const first = alternatives[0];
            return `${productTerm} no lo manejo en el catálogo ahorita, veci. Pero te puedo ofrecer ${first.name} a $${first.price}.`;
        }
        return `${productTerm} no lo manejo en el catálogo ahorita, veci.`;
    }

    const variants = variantOptionsFromProducts(resolvedProducts, productTerm);
    if (variants.length > 0) {
        return variantPrompt(productTerm, variants);
    }

    const product = pickBestProduct(resolvedProducts, productTerm);
    if (!product) {
        return `${productTerm} no lo manejo en el catálogo ahorita, veci.`;
    }
    return `Sí, claro. ${product.name}: $${product.price} por ${unitShortLabel(product.unit, product.name)}. ${unitQuantityQuestion(product.unit, product.name)}`;
}

async function availabilityReply(message: string, config?: StoreConfigLike) {
    const categoryQuestion = extractCatalogCategoryQuestion(message);
    if (categoryQuestion) {
        const snapshot = await fetchCatalogSnapshot(config || undefined);
        const categoryHints = categoryQuestion === "frutas"
            ? ["aguacate", "banano", "mango", "limon", "naranja", "piña", "pina", "uchuva", "agraz", "arandano", "sandia", "melon", "papaya", "guanabana"]
            : ["cebolla", "tomate", "zanahoria", "papa", "pepino", "brocoli", "repollo", "pimenton", "cilantro", "ajo", "ahuyama", "zukini", "champiñon", "champinon"];
        const products = dedupeVisibleProducts(
            snapshot.filter((product) => {
                return categoryHints.some((hint) => hasTokenMatch(product.name, [hint]));
            })
        ).slice(0, 8);

        if (products.length > 0) {
            const names = products.map((product) => product.name).join(", ");
            return `Sí, claro. Ahorita tengo estas ${categoryQuestion} en catálogo: ${names}. ¿Cuál te anoto?`;
        }
    }

    const productTerm = extractProductFromAvailabilityQuestion(message);
    if (!productTerm) return null;

    const resolvedProducts = await searchProductsByTerm(productTerm, config);

    if (resolvedProducts.length === 0) {
        const alternatives = await suggestAlternativesFromInventory(productTerm, [], config, 2);
        if (alternatives.length > 0) {
            const first = alternatives[0];
            return `${productTerm} no lo manejo en el catálogo ahorita, veci. Pero te puedo ofrecer ${first.name} a $${first.price}.`;
        }
        return `${productTerm} no lo manejo en el catálogo ahorita, veci.`;
    }

    const variants = variantOptionsFromProducts(resolvedProducts, productTerm);
    if (variants.length > 0) {
        return variantPrompt(productTerm, variants);
    }

    const product = pickBestProduct(resolvedProducts, productTerm);
    if (!product) {
        return `${productTerm} no lo manejo en el catálogo ahorita, veci.`;
    }
    return `Sí, claro, sí hay ${product.name}. ${unitQuantityQuestion(product.unit, product.name)}`;
}

async function fallbackReply(lastUserMessage: string, config?: StoreConfigLike) {
    if (isGreetingMessage(lastUserMessage)) {
        return "¡Qué tal, veci! Cuénteme qué productos quiere y yo se los voy anotando de una.";
    }
    const intent = parseOrderIntent(lastUserMessage);
    if (!intent) {
        return "Claro, veci. Dígame producto y cantidad, por ejemplo: `2 kilos de papa`.";
    }

    const resolvedProducts = await searchProductsByTerm(intent.product, config);

    if (resolvedProducts.length === 0) {
        const alternatives = await suggestAlternativesFromInventory(intent.product, [], config, 2);
        if (alternatives.length > 0) {
            const lines = alternatives.map((a) => `- ${a.name} ($${a.price})`).join("\n");
            return `${intent.product} no lo manejo en el catálogo ahorita, veci. Pero le puedo ofrecer estos reemplazos reales:\n${lines}\n¿Le sirve alguno?`;
        }
        return `${intent.product} no lo manejo en el catálogo ahorita, veci.`;
    }

    const product = pickBestProduct(resolvedProducts, intent.product);
    if (!product) {
        const alternatives = await suggestAlternativesFromInventory(intent.product, [], config, 2);
        if (alternatives.length > 0) {
            const lines = alternatives.map((a) => `- ${a.name} ($${a.price})`).join("\n");
            return `${intent.product} no lo manejo en el catálogo ahorita, veci. Pero le puedo ofrecer estos reemplazos reales:\n${lines}\n¿Le sirve alguno?`;
        }
        return `${intent.product} no lo manejo en el catálogo ahorita, veci.`;
    }
    if (!intent.quantity) {
        const variants = variantOptionsFromProducts(resolvedProducts, intent.product);
        if (variants.length > 0) {
            return variantPrompt(intent.product, variants);
        }
        return `Sí hay ${product.name}. Vale $${product.price} por ${unitShortLabel(product.unit, product.name)}. ${unitQuantityQuestion(product.unit, product.name)}`;
    }

    const subtotal = intent.quantity * product.price;
    return `¡Listo, veci! Le anoto ${intent.quantity} ${formatLineUnit(product.unit, product.name, intent.quantity)} de ${product.name}. Subtotal: $${subtotal}. ¿Qué más le pongo a la canasta?`;
}

async function executeCreateOrder(customerData: any, items: any[], total: number) {
    const config = await prisma.storeConfig.findFirst() as StoreConfigLike | null;
    syncRuntimeCityRules(config);
    const subtotal = merchandiseTotal(items);
    const shipping = shippingCost(items, customerData.ciudad, config);
    const orderTotal = subtotal + shipping;

    const order = await prisma.order.create({
        data: {
            customerName: customerData.nombre,
            customerEmail: customerData.correo || null,
            customerPhone: customerData.telefono,
            customerAddress: customerData.direccion,
            customerCity: customerData.ciudad,
            items: JSON.stringify(items),
            subtotal,
            shipping,
            total: orderTotal,
            status: "Pendiente"
        }
    });

    // Generate PDF tirilla
    const doc = new jsPDF({ unit: "mm", format: [80, 200] });
    doc.setFontSize(12);
    doc.text("EL VERDULERO", 40, 10, { align: "center" });
    doc.setFontSize(8);
    doc.text("Frescura en su puerta", 40, 15, { align: "center" });
    doc.text("--------------------------------", 40, 20, { align: "center" });
    doc.text(`PEDIDO: #${order.id}`, 10, 25);
    doc.text(`FECHA: ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}`, 10, 30);
    doc.text("--------------------------------", 40, 35, { align: "center" });
    doc.text(`CLIENTE: ${customerData.nombre}`, 10, 40);
    doc.text(`TEL: ${customerData.telefono}`, 10, 45);
    doc.text(`DIR: ${customerData.direccion}, ${customerData.ciudad}`, 10, 50, { maxWidth: 60 });
    doc.text("--------------------------------", 40, 60, { align: "center" });
    doc.text("CANT  PRODUCTO         SUBT", 10, 65);

    let y = 70;
    items.forEach((item: any) => {
        doc.text(`${item.quantity}  ${item.name}`, 10, y, { maxWidth: 45 });
        doc.text(`$${item.price * item.quantity}`, 65, y);
        y += 5;
    });

    doc.text("--------------------------------", 40, y + 5, { align: "center" });
    doc.text(`TOTAL A PAGAR: $${orderTotal}`, 10, y + 10);
    doc.text("PAGO: CONTRA ENTREGA", 10, y + 15);
    doc.text("--------------------------------", 40, y + 20, { align: "center" });
    doc.text("¡Gracias por preferirnos!", 40, y + 25, { align: "center" });

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    let adminEmailSent = false;
    let customerEmailSent = false;
    let emailErrorCode: string | null = null;
    let emailErrorMessage: string | null = null;

    try {
        const deliveryInfo = getDeliveryInfo(config?.horaCorte, config?.deliveryWindow);
        const siteUrl = getSiteUrl(config);
        const supportWhatsapp = getSupportWhatsapp(config);
        const storeName = getStoreName(config);
        const emailData = {
            orderId: order.id,
            customer: customerData,
            items,
            subtotal,
            shipping,
            total: orderTotal,
            deliveryFullDate: deliveryInfo.fullDate,
            deliveryWindow: deliveryInfo.window,
            supportWhatsapp,
            supportWhatsappLabel: supportWhatsapp,
            siteUrl,
            logoUrl: config?.logoUrl || undefined,
            storeName
        };
        if (!process.env.EMAIL_HOST || !process.env.EMAIL_PORT || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn("Email config missing: skipping order email send.");
            return { success: true, orderId: order.id, adminEmailSent, customerEmailSent };
        }

        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: Number(process.env.EMAIL_PORT),
            secure: Number(process.env.EMAIL_PORT) === 465,
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });
        await transporter.sendMail({
            from: `"${storeName}" <${process.env.EMAIL_USER}>`,
            to: config?.emailAdmin || "ventas@elverdulero.com.co",
            cc: config?.emailsCopia || "",
            subject: `🍎 NUEVO PEDIDO #${order.id} - ${customerData.nombre} - ${formatCop(orderTotal)}`,
            text: buildOrderEmailText({ ...emailData, adminView: true }),
            html: buildOrderEmailHtml({ ...emailData, adminView: true }),
            attachments: [{ filename: `pedido-${order.id}.pdf`, content: pdfBuffer }]
        });
        adminEmailSent = true;

        if (customerData?.correo) {
            await transporter.sendMail({
                from: `"${storeName}" <${process.env.EMAIL_USER}>`,
                to: customerData.correo,
                subject: `✅ Confirmación de pedido #${order.id} - El Verdulero`,
                text: buildOrderEmailText(emailData),
                html: buildOrderEmailHtml(emailData),
                attachments: [{ filename: `pedido-${order.id}.pdf`, content: pdfBuffer }]
            });
            customerEmailSent = true;
        }
    } catch (emailError) {
        console.error("Email error (pedido guardado):", emailError);
        emailErrorCode = typeof emailError === "object" && emailError && "code" in emailError ? String((emailError as any).code) : null;
        emailErrorMessage = typeof emailError === "object" && emailError && "message" in emailError ? String((emailError as any).message) : "Error desconocido enviando correo";
    }

    return { success: true, orderId: order.id, adminEmailSent, customerEmailSent, emailErrorCode, emailErrorMessage };
}

async function finalizeOrderFromCheckoutProfile(params: {
    draft: DraftState;
    profile: CustomerProfile;
    sessionId: string | null;
    config?: StoreConfigLike | null;
    deliveryInfo: DeliveryInfo;
}) {
    const { draft, profile, sessionId, config, deliveryInfo } = params;
    const total = merchandiseTotal(draft.cart) + shippingCost(draft.cart, profile.ciudad, config);
    const result = await executeCreateOrder({
        nombre: profile.nombre,
        telefono: profile.telefono,
        correo: profile.correo,
        direccion: profile.direccion,
        ciudad: profile.ciudad
    }, draft.cart, total);

    if (!(result as any)?.success) return null;

    draft.cart = [];
    draft.pending = [];
    draft.pendingUnitIntents = [];
    draft.awaitingCheckoutConfirmation = false;
    draft.pendingCheckoutAfterIntake = false;
    draft.stage = "cerrado";
    await saveDraft(sessionId, draft);

    const customerMailLine = (result as any)?.customerEmailSent && profile.correo
        ? `Te envié la tirilla al correo ${profile.correo}.`
        : profile.correo
            ? `Tu pedido quedó confirmado, pero el correo no salió en este intento. Si quieres, escríbenos al WhatsApp ${getSupportWhatsapp(config)} y te ayudamos de una.`
            : `Tu pedido quedó confirmado. Si quieres la tirilla por correo, escríbenos al WhatsApp ${getSupportWhatsapp(config)}.`;

    return `¡Pedido confirmado, veci! Su orden es #${(result as any).orderId}.\nTOTAL: $${total}\n${deliveryInfo.note}\n${customerMailLine}\nSi necesita cualquier cosa, nos puede escribir al WhatsApp ${getSupportWhatsapp(config)}.\n¡Gracias por comprar con ${getStoreName(config)}!`;
}

export async function POST(req: Request) {
    try {
        const rate = checkRateLimit(req, "chat", 45, 60_000);
        if (!rate.ok) {
            return NextResponse.json(
                { error: "Demasiados mensajes seguidos. Espera un momento y vuelve a intentar." },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
        }

        const { messages: rawMessages, sessionId: providedSessionId, customerName, bootstrapProfile, checkoutProfile } = await req.json() as {
            messages?: ChatMessage[];
            sessionId?: string | null;
            customerName?: string;
            bootstrapProfile?: BootstrapProfileInput;
            checkoutProfile?: CheckoutProfileInput;
        };
        let messages = normalizeMessages(rawMessages);
        const hasBootstrapProfile = Boolean(bootstrapProfile && (bootstrapProfile.correo || bootstrapProfile.nombre || bootstrapProfile.ciudad));
        if (messages.length === 0 && !hasBootstrapProfile) {
            return NextResponse.json(
                { error: "No se recibió un mensaje válido del cliente" },
                { status: 400 }
            );
        }

        // 1. Config & Manual Intervention check
        const config = await prisma.storeConfig.findFirst() as any;
        syncRuntimeCityRules(config);
        if (config?.intervencionManual) {
            return NextResponse.json({
                content: "Ay, veci, en este momento estoy atendiendo a unos clientes aquí en el puesto. Un compañero humano le va a responder en un momentico, ¡téngame paciencia!",
                role: "assistant",
                isPaused: true
            });
        }

        // 2. Ensure session exists
        const sessionId: string | null = providedSessionId ?? null;
        if (sessionId) {
            await prisma.chatSession.upsert({
                where: { id: sessionId },
                update: { updatedAt: new Date(), customerName: customerName || undefined },
                create: { id: sessionId, customerName: customerName || "Cliente Web", isActive: true }
            });
        }

        if (hasBootstrapProfile && sessionId) {
            invalidateCatalogSnapshot(config || undefined);
            clearProductSearchCache(config || undefined);
            await fetchCatalogSnapshot(config || undefined, true);

            const email = extractEmail(bootstrapProfile?.correo || "") || undefined;
            if (!email) {
                return NextResponse.json(
                    { error: "Falta un correo válido para arrancar el pedido." },
                    { status: 400 }
                );
            }

            const returningByEmail = await getReturningContextByEmail(email);
            const knownCustomer = returningByEmail.customer;
            const selectedCity = bootstrapProfile?.ciudad ? sanitizeCity(bootstrapProfile.ciudad) || undefined : undefined;
            const resolvedCity = selectedCity || (knownCustomer?.lastCity ? sanitizeCity(knownCustomer.lastCity) || undefined : undefined);
            const bootProfile: CustomerProfile = {
                correo: email,
                nombre: knownCustomer?.name ? sanitizeBootstrapName(knownCustomer.name) || undefined : (bootstrapProfile?.nombre ? sanitizeBootstrapName(bootstrapProfile.nombre) || undefined : undefined),
                ciudad: resolvedCity,
                direccion: knownCustomer?.lastAddress || undefined,
                telefono: undefined
            };

            if (!bootProfile.ciudad) {
                return NextResponse.json(
                    { error: "Necesito una ciudad válida de cobertura para arrancar." },
                    { status: 400 }
                );
            }

            if (!knownCustomer && !bootProfile.nombre) {
                return NextResponse.json(
                    { error: "Para clientes nuevos necesito nombre y ciudad para arrancar." },
                    { status: 400 }
                );
            }

            await persistCustomerProfile(sessionId, bootProfile);

            const draft = await loadDraft(sessionId);
            draft.intakeCompleted = true;
            draft.stage = "toma_pedido";
            draft.awaitingRepeatChoice = Boolean(knownCustomer && returningByEmail.lastItems.length > 0);
            await saveDraft(sessionId, draft);

            const firstName = firstNameOf(bootProfile.nombre) || "veci";
            const reply = draft.awaitingRepeatChoice
                ? `¡Qué bueno verte de nuevo, ${firstName}! Ya te reconocí por tu correo. ¿Quieres repetir tu mercado anterior o armamos uno nuevo?`
                : `¡Listo, ${firstName}! Ya guardé tu correo y que te entregamos en ${cityLabel(bootProfile.ciudad)}. Ahora sí, ¿qué te anoto en tu pedido de hoy?`;

            await prisma.message.create({
                data: { sessionId, role: "assistant", content: reply }
            });

            const contract = buildAssistantContract({
                userText: "__bootstrap__",
                reply,
                profile: bootProfile,
                draft
            });
            await recordLearningEvent({
                sessionId,
                userMessage: "__bootstrap__",
                assistantText: reply,
                profile: bootProfile,
                draft,
                contract
            });

            return NextResponse.json({ content: reply, role: "assistant", contract });
        }

        // 3. Save user message
        const lastUserMessage = messages[messages.length - 1];
        if (sessionId && lastUserMessage.role === "user") {
            await prisma.message.create({
                data: { sessionId, role: "user", content: lastUserMessage.content }
            });
        }

        // 3.5 Use persisted session history as source of truth for context
        if (sessionId) {
            const persisted = await prisma.message.findMany({
                where: { sessionId },
                orderBy: { createdAt: "desc" },
                take: 60
            });
            const persistedMessages: ChatMessage[] = persisted
                .reverse()
                .map((m): ChatMessage => ({
                    role: m.role === "assistant" ? "assistant" : "user",
                    content: m.content
                }))
                .filter((m) => m.content?.trim().length > 0);
            if (persistedMessages.length > 0) {
                messages = persistedMessages;
            }
        }

        // 4. Build Anthropic messages (simple text history)
        const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content as string
        }));

        const personaMode = normalizePersonaMode(config?.perfilConversacional);
        const deliveryInfo = getDeliveryInfo(config?.horaCorte, config?.deliveryWindow);
        const systemPrompt = await buildFullSystemPrompt(config?.personalidad, personaMode, deliveryInfo, config);
        const lastUserContent = messages[messages.length - 1]?.content || "";

        // 4.5 Mandatory client-intake flow before order taking
        const profile = extractProfileFromMessages(messages);
        const profileBeforeLast = extractProfileFromMessages(messages.slice(0, -1));
        if (!profile.nombre && profileBeforeLast.nombre) profile.nombre = profileBeforeLast.nombre;
        if (!profile.correo && profileBeforeLast.correo) profile.correo = profileBeforeLast.correo;
        if (!profile.direccion && profileBeforeLast.direccion) profile.direccion = profileBeforeLast.direccion;
        if (!profile.ciudad && profileBeforeLast.ciudad) profile.ciudad = profileBeforeLast.ciudad;
        const sessionSnapshot = sessionId
            ? await prisma.chatSession.findUnique({
                where: { id: sessionId },
                select: { customerName: true, phoneNumber: true, customerEmail: true, customerCity: true, customerAddress: true }
            })
            : null;
        if (!profile.nombre && sessionSnapshot?.customerName) {
            const snapshotName = sanitizeName(sessionSnapshot.customerName);
            if (snapshotName) profile.nombre = snapshotName;
        }
        if (!profile.correo && sessionSnapshot?.customerEmail) {
            profile.correo = sessionSnapshot.customerEmail;
        }
        if (!profile.telefono && sessionSnapshot?.phoneNumber) {
            profile.telefono = sessionSnapshot.phoneNumber;
        }
        if (!profile.ciudad && sessionSnapshot?.customerCity) {
            const snapshotCity = sanitizeCity(sessionSnapshot.customerCity);
            if (snapshotCity) profile.ciudad = snapshotCity;
        }
        if (!profile.direccion && sessionSnapshot?.customerAddress) {
            profile.direccion = sessionSnapshot.customerAddress;
        }

        if (checkoutProfile && sessionId) {
            const checkoutPatch: CustomerProfile = {
                telefono: checkoutProfile.telefono ? extractPhone(checkoutProfile.telefono) || undefined : profile.telefono,
                ciudad: checkoutProfile.ciudad ? sanitizeCity(checkoutProfile.ciudad) || undefined : profile.ciudad,
                direccion: checkoutProfile.direccion ? extractAddressFromText(checkoutProfile.direccion) || checkoutProfile.direccion.trim() || undefined : profile.direccion,
                correo: profile.correo,
                nombre: profile.nombre
            };
            Object.assign(profile, checkoutPatch);
            await persistCustomerProfile(sessionId, profile);
        }
        const newCapturedFields = getNewCapturedFields(profileBeforeLast, profile);
        const directCapturedFields: Array<keyof CustomerProfile> = (["telefono", "direccion", "ciudad"] as Array<keyof CustomerProfile>)
            .filter((f) => Boolean(extractFieldValue(f, lastUserContent)));
        const draft = await loadDraft(sessionId);
        draft.stage = deriveSalesStage(profile, draft);
        const assistantJson = async (replyText: string) => {
            const contract = buildAssistantContract({
                userText: lastUserContent,
                reply: replyText,
                profile,
                draft
            });
            draft.stage = contract.stage;
            await recordLearningEvent({
                sessionId,
                userMessage: lastUserContent,
                assistantText: replyText,
                profile,
                draft,
                contract
            });
            return NextResponse.json({ content: replyText, role: "assistant", contract });
        };
        let returningContext: ReturningContext | null = null;

        if (profile.telefono) {
            const returning = await getReturningContext(profile.telefono);
            if (returning.customer) {
                returningContext = returning;
                const trustedReturningName = sanitizeName(returning.customer.name || "");
                if (!profile.nombre && trustedReturningName) profile.nombre = trustedReturningName;
                if (!profile.correo && returning.customer.email) profile.correo = returning.customer.email;
                if (!profile.direccion && returning.customer.lastAddress) profile.direccion = returning.customer.lastAddress;
                if (!profile.ciudad && returning.customer.lastCity) {
                    const trustedCity = sanitizeCity(returning.customer.lastCity);
                    if (trustedCity) profile.ciudad = trustedCity;
                }
                await persistCustomerProfile(sessionId, profile);
            }
        }

        if (newCapturedFields.length > 0) {
            await persistCustomerProfile(sessionId, profile);
        }

        if (checkoutProfile) {
            if (draft.cart.length === 0) {
                const reply = "Veci, su carrito está vacío todavía. Dígame qué le anoto y cerramos el pedido de una.";
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const missingForCheckout = firstMissingField(profile);
            if (missingForCheckout) {
                const reply = `${fieldQuestion(missingForCheckout)}\nNecesito ese dato para confirmar su pedido.`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const reply = await finalizeOrderFromCheckoutProfile({ draft, profile, sessionId, config, deliveryInfo });
            if (reply) {
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        const shouldBypassIntake = Boolean(draft.intakeCompleted || (returningContext?.customer && hasInitialProfile(profile)));
        const missingBefore = firstMissingInitialField(profile);
        const capturedPhoneNow = directCapturedFields.includes("telefono");
        if (missingBefore && !shouldBypassIntake) {
            if (isGratitudeOnly(lastUserContent)) {
                const reply = `Con gusto, veci. ${fieldQuestion(missingBefore)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            if (isFrustrationMessage(lastUserContent) && !messageCarriesOwnProductIntent(lastUserContent)) {
                const reply = `Tiene toda la razón, veci. Perdón por enredarla. ${fieldQuestion(missingBefore)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const earlyIntents = parseMultipleOrderIntents(lastUserContent);
            if (earlyIntents.length > 0 && (draft.pendingUnitIntents || []).length === 0) {
                draft.pendingUnitIntents = earlyIntents;
                draft.pendingUnitChoice = extractUnitChoice(lastUserContent);
                await saveDraft(sessionId, draft);
            }

            if (isPriceQuestion(lastUserContent)) {
                const quote = await priceReply(lastUserContent, config);
                const reply = `${quote || "Claro veci, ya le reviso precio."} ${intakeNudge(missingBefore)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (isAvailabilityQuestion(lastUserContent)) {
                const availability = await availabilityReply(lastUserContent, config);
                const reply = `${availability || "Déjeme revisar inventario."} ${intakeNudge(missingBefore)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            if (missingBefore === "ciudad") {
                const unsupportedCity = extractUnsupportedCityCandidate(lastUserContent);
                if (unsupportedCity) {
                    const reply = `Veci, por ahora ${buildCoverageLabel(runtimeCityRules).toLowerCase()}. Escoge una de esas en el modal de entrada para poder seguir.`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }

            const reply = fieldQuestion(missingBefore);
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (draft.pendingCheckoutAfterIntake && parseMultipleOrderIntents(lastUserContent).length > 0) {
            draft.pendingCheckoutAfterIntake = false;
            draft.awaitingCheckoutConfirmation = false;
            await saveDraft(sessionId, draft);
        }

        if (draft.pendingCheckoutAfterIntake) {
            const checkoutMissing = firstMissingCheckoutField(profile);
            if (checkoutMissing) {
                const capturedCheckoutValue = extractFieldValue(checkoutMissing, lastUserContent);
                if (capturedCheckoutValue) {
                    profile[checkoutMissing] = capturedCheckoutValue;
                    await persistCustomerProfile(sessionId, profile);
                }

                const stillMissingCheckout = firstMissingCheckoutField(profile);
                if (stillMissingCheckout) {
                    const subtotal = merchandiseTotal(draft.cart);
                    const shipping = shippingCost(draft.cart, profile.ciudad, config);
                    const total = subtotal + shipping;
                    const shippingText = shipping === 0 ? "El envío le queda gratis." : `El envío vale $${shipping}.`;
                    const minimumText = minimumOrderStatusText(subtotal, config);
                    const reply = `Perfecto, veci. Su mercado va en $${subtotal}. ${shippingText}${minimumText ? ` ${minimumText}` : ""} Total hasta ahora: $${total}.\n${checkoutSummary(draft.cart, deliveryInfo, profile.ciudad, config)}\n${fieldQuestion(stillMissingCheckout)}`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }

            draft.pendingCheckoutAfterIntake = false;
            draft.awaitingCheckoutConfirmation = false;
            await saveDraft(sessionId, draft);
            const reply = `Perfecto, veci. Ya tengo todo para despacho:\n${checkoutSummary(draft.cart, deliveryInfo, profile.ciudad, config)}\nPara cerrar, usa el botón "Finalizar pedido" y acepta el tratamiento de datos según Habeas Data.`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (!draft.awaitingRepeatChoice && assistantAskedRepeatChoice(messages.slice(0, -1))) {
            draft.awaitingRepeatChoice = true;
            await saveDraft(sessionId, draft);
        }

        if (draft.awaitingRepeatChoice) {
            if (isNewBasketChoice(lastUserContent)) {
                draft.awaitingRepeatChoice = false;
                resetDraftForFreshBasket(draft);
                await saveDraft(sessionId, draft);
                const reply = "De una, veci. Armamos un mercado nuevo. ¿Qué te anoto primero?";
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            if (isRepeatOrderRequest(lastUserContent) || isAffirmative(lastUserContent)) {
                draft.awaitingRepeatChoice = false;

                const returning = profile.correo
                    ? await getReturningContextByEmail(profile.correo)
                    : profile.telefono
                        ? await getReturningContext(profile.telefono)
                        : { customer: null, lastItems: [] };

                if (returning.lastItems.length > 0) {
                    draft.pending = returning.lastItems;
                    await saveDraft(sessionId, draft);
                    const subtotal = returning.lastItems.reduce((acc, i) => acc + i.quantity * i.price, 0);
                    const reply = `De una, veci. Te propongo repetir: ${compactItems(returning.lastItems)}. Subtotal: $${subtotal}. ¿Me confirmas con "sí" para agregarlo al carrito?`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }

                await saveDraft(sessionId, draft);
                const noHistoryReply = "No veo una compra anterior para repetir. Armemos un mercado nuevo de una. ¿Qué te anoto?";
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: noHistoryReply } });
                }
                return assistantJson(noHistoryReply);
            }

            const reply = 'Te sigo en una de estas dos, veci: "repetir pedido" o "uno nuevo".';
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (
            isGreetingMessage(lastUserContent) &&
            !hasConcreteOrderDetail(lastUserContent) &&
            !draft.pendingVariant &&
            !draft.pendingQuantity &&
            !(draft.pendingUnitIntents || []).length &&
            !draft.awaitingCheckoutConfirmation &&
            !draft.pendingCheckoutAfterIntake
        ) {
            const reply = "¡Qué tal, veci! Ahora sí, ¿qué te anoto en tu pedido de hoy?";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isStartOrderIntent(lastUserContent)) {
            let resetForNewBasket = false;
            if (isNewBasketChoice(lastUserContent)) {
                resetDraftForFreshBasket(draft);
                resetForNewBasket = true;
            }
            if ((draft.pending || []).length > 0) {
                draft.pending = [];
                await saveDraft(sessionId, draft);
            } else if (resetForNewBasket) {
                await saveDraft(sessionId, draft);
            }
            const missing = firstMissingInitialField(profile);
            const reply = missing
                ? fieldQuestion(missing)
                : "¡De una, veci! Ya mismo le tomo el pedido. Dígame producto y cantidad, por ejemplo: `2 libras de papa y 3 limones`.";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (
            isNewBasketChoice(lastUserContent) &&
            !hasConcreteOrderDetail(lastUserContent) &&
            !draft.pendingVariant &&
            !draft.pendingQuantity &&
            !draft.awaitingCheckoutConfirmation &&
            !draft.pendingCheckoutAfterIntake
        ) {
            resetDraftForFreshBasket(draft);
            draft.awaitingRepeatChoice = false;
            draft.stage = "toma_pedido";
            await saveDraft(sessionId, draft);
            const reply = "De una, veci. Armamos un mercado nuevo. ¿Qué te anoto primero?";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const missingNow = firstMissingInitialField(profile);
        if (missingNow) {
            if (missingNow === "ciudad") {
                const unsupportedCity = extractUnsupportedCityCandidate(lastUserContent);
                if (unsupportedCity) {
                    const reply = `Veci, por ahora ${buildCoverageLabel(runtimeCityRules).toLowerCase()}. Escoge una de esas en el modal de entrada para poder seguir.`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }
            const reply = `${fieldQuestion(missingNow)}\nNecesito que arranquemos por ese modal para seguir con el pedido.`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (draft.pendingVariant) {
            const pendingVariant = draft.pendingVariant;
            if (isAvailabilityQuestion(lastUserContent) || isPriceQuestion(lastUserContent)) {
                const reply = isAvailabilityQuestion(lastUserContent)
                    ? (await availabilityReply(lastUserContent, config)) || variantPrompt(pendingVariant.searchTerm, pendingVariant.options)
                    : (await priceReply(lastUserContent, config)) || variantPrompt(pendingVariant.searchTerm, pendingVariant.options);
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            if (isDoneOrderingIntent(lastUserContent) || isCheckoutIntent(lastUserContent)) {
                const reply = `${variantPrompt(pendingVariant.searchTerm, pendingVariant.options)}\nAntes de cerrar, me falta escoger cuál ${pendingVariant.searchTerm} le anoto.`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            const eachVariantQuantity = extractEachVariantQuantity(lastUserContent);
            if (eachVariantQuantity && pendingVariant.options.length > 1) {
                const items = pendingVariant.options.map((option) => ({
                    ...option,
                    quantity: eachVariantQuantity,
                    unit: pendingVariant.explicitUnit || option.unit
                }));
                const followupIntents = pendingVariant.followupIntents?.length
                    ? pendingVariant.followupIntents
                    : (draft.pendingFollowupIntents || []);
                draft.pendingVariant = null;
                draft.pendingQuantity = null;
                draft.awaitingCheckoutConfirmation = false;
                draft.cart = mergeCartItems(draft.cart, items);
                draft.pendingFollowupIntents = [];
                const followupReply = followupIntents.length > 0
                    ? await continueFollowupIntents(draft, followupIntents, pendingVariant.explicitUnit || null, config)
                    : null;
                await saveDraft(sessionId, draft);

                const lines = items.map((item) => `- ${item.quantity} ${formatLineUnit(item.unit, item.name, item.quantity)} de ${item.name} @ $${item.price} = $${item.quantity * item.price}`);
                const subtotal = items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
                const reply = followupReply?.reply
                    ? `Listo, veci. Le agregué ${eachVariantQuantity} de cada uno:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.\n${followupReply.reply}`
                    : `Listo, veci. Le agregué ${eachVariantQuantity} de cada uno:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.\n¿Qué más necesita?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            let chosen: CartItem | null = null;
            if (userStartedDifferentProductWhileChoosingVariant(lastUserContent, pendingVariant)) {
                draft.pendingVariant = null;
                await saveDraft(sessionId, draft);
            } else {
                chosen = findVariantChoice(lastUserContent, pendingVariant.options, pendingVariant.searchTerm);
            }
            if (!chosen) {
                if (!variantMessageMatchesOptions(lastUserContent, pendingVariant) && draft.pendingVariant) {
                    const reply = `${variantPrompt(pendingVariant.searchTerm, pendingVariant.options)}\nNecesito que me diga cuál de esas opciones quiere.`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }

            if (!chosen && draft.pendingVariant) {
                const reply = `${variantPrompt(pendingVariant.searchTerm, pendingVariant.options)}\nNecesito que me diga cuál de esas opciones quiere.`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            if (!chosen) {
                // The client changed to a different product mid-choice; continue below with normal parsing.
            } else {
                const followupIntents = pendingVariant.followupIntents?.length
                    ? pendingVariant.followupIntents
                    : (draft.pendingFollowupIntents || []);
                clearPendingOrderState(draft);

                if (pendingVariant.correctionFromProductId) {
                    const index = draft.cart.findIndex((item) => item.product_id === pendingVariant.correctionFromProductId);
                    if (index >= 0) {
                        const previous = draft.cart[index];
                        if (previous.unit !== chosen.unit) {
                            draft.cart.splice(index, 1);
                            draft.pendingVariant = null;
                            draft.pendingQuantity = {
                                item: {
                                    ...chosen,
                                    quantity: 1
                                }
                            };
                            await saveDraft(sessionId, draft);
                            const reply = `Le cambié ${previous.name} por ${chosen.name}, veci. Ojo: ese se maneja en ${unitShortLabel(chosen.unit, chosen.name).toLowerCase()}, no en ${unitShortLabel(previous.unit, previous.name).toLowerCase()}. ${unitQuantityQuestion(chosen.unit, chosen.name)}`;
                            if (sessionId) {
                                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                            }
                            return assistantJson(reply);
                        }
                        const replaced = {
                            ...chosen,
                            quantity: previous.quantity,
                            unit: previous.unit
                        };
                        draft.cart.splice(index, 1, replaced);
                        await saveDraft(sessionId, draft);
                        const reply = `Listo, veci. Le cambié ${previous.name} por ${replaced.name} con ${replaced.quantity} ${formatLineUnit(replaced.unit, replaced.name, replaced.quantity)}. ¿Qué más necesita?`;
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                }

                const embeddedIntent = parseOrderIntent(lastUserContent);
                const effectiveQuantity = embeddedIntent?.quantity ?? pendingVariant.quantity;
                const effectiveRequestedUnit = embeddedIntent?.requestedUnit || pendingVariant.explicitUnit || null;
                if (effectiveQuantity) {
                    const item = {
                        ...chosen,
                        quantity: effectiveQuantity,
                        unit: chosen.unit
                    };
                    if (requiresUnitClarification(effectiveRequestedUnit, item.unit, item.name)) {
                        draft.pendingQuantity = null;
                        draft.pendingVariant = {
                            ...pendingVariant,
                            quantity: effectiveQuantity,
                            explicitUnit: effectiveRequestedUnit
                        };
                        await saveDraft(sessionId, draft);
                        const reply = unitClarificationReply(
                            { quantity: effectiveQuantity, product: chosen.name, requestedUnit: effectiveRequestedUnit },
                            item
                        );
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                    if (!isValidQuantityForUnit(effectiveQuantity, item.unit)) {
                        draft.pendingQuantity = { item };
                        draft.pendingVariant = {
                            ...pendingVariant,
                            quantity: effectiveQuantity,
                            explicitUnit: effectiveRequestedUnit
                        };
                        await saveDraft(sessionId, draft);
                        const reply = quantityRestrictionReply(
                            { quantity: effectiveQuantity, product: chosen.name, requestedUnit: effectiveRequestedUnit },
                            item
                        );
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }

                    draft.cart = mergeCartItems(draft.cart, [item]);
                    draft.awaitingCheckoutConfirmation = false;
                    const followupReply = followupIntents.length > 0
                        ? await continueFollowupIntents(draft, followupIntents, null, config)
                        : null;
                    await saveDraft(sessionId, draft);
                    const subtotal = item.quantity * item.price;
                    const reply = followupReply?.reply
                        ? `Listo, veci. Le agregué ${item.quantity} ${formatLineUnit(item.unit, item.name, item.quantity)} de ${item.name} @ $${item.price} = $${subtotal}.\n${followupReply.reply}`
                        : `Listo, veci. Le agregué ${item.quantity} ${formatLineUnit(item.unit, item.name, item.quantity)} de ${item.name} @ $${item.price} = $${subtotal}.\n¿Qué más necesita?`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }

                draft.pendingQuantity = {
                    item: {
                        ...chosen,
                        quantity: 1
                    }
                };
                await saveDraft(sessionId, draft);
                const reply = `De una, veci. Entonces va ${chosen.name} a $${chosen.price} por ${unitShortLabel(chosen.unit, chosen.name)}. ${unitQuantityQuestion(chosen.unit, chosen.name)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        if (draft.pendingQuantity?.item) {
            const quantity = extractLooseQuantity(lastUserContent);
            if (!quantity) {
                if (refersToDifferentProduct(lastUserContent, draft.pendingQuantity.item.name)) {
                    draft.pendingQuantity = null;
                    await saveDraft(sessionId, draft);
                } else {
                    const reply = `${unitQuantityQuestion(draft.pendingQuantity.item.unit, draft.pendingQuantity.item.name)}\nEse producto se maneja en ${unitShortLabel(draft.pendingQuantity.item.unit, draft.pendingQuantity.item.name)}.`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }

            if (!draft.pendingQuantity?.item) {
                // The client changed product mid-turn; continue below with normal intent parsing.
            } else {
                const resolvedQuantity = quantity as number;
                const item = {
                    ...draft.pendingQuantity.item,
                    quantity: resolvedQuantity
                };
                draft.pendingQuantity = null;
                draft.cart = mergeCartItems(draft.cart, [item]);
                draft.awaitingCheckoutConfirmation = false;
                await saveDraft(sessionId, draft);

                const subtotal = item.quantity * item.price;
                const reply = `Listo, veci. Le agregué ${item.quantity} ${formatLineUnit(item.unit, item.name, item.quantity)} de ${item.name} @ $${item.price} = $${subtotal}.\n¿Qué más necesita?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        const lastUserIntents = parseMultipleOrderIntents(lastUserContent);
        const listedProducts = parseProductListMessage(lastUserContent);
        const singleIntent = parseOrderIntent(lastUserContent);
        if (
            directCapturedFields.length > 0 &&
            lastUserIntents.length === 0 &&
            !singleIntent &&
            !draft.pendingVariant &&
            !draft.pendingQuantity &&
            !draft.pendingCheckoutAfterIntake &&
            !isPriceQuestion(lastUserContent) &&
            !isAvailabilityQuestion(lastUserContent) &&
            !isRepeatOrderRequest(lastUserContent) &&
            !isDoneOrderingIntent(lastUserContent) &&
            !isCheckoutIntent(lastUserContent) &&
            !isAffirmative(lastUserContent) &&
            !isNegative(lastUserContent) &&
            !isGratitudeOnly(lastUserContent) &&
            !isFrustrationMessage(lastUserContent)
        ) {
            const missing = firstMissingInitialField(profile);
            const latest = directCapturedFields[directCapturedFields.length - 1];
            const ack = `¡Listo, veci! Ya guardé tu ${fieldLabel(latest)}.`;
            const reply = missing
                ? `${ack} ${fieldQuestion(missing)}`
                : `${ack} Ahora sí, ¿qué te anoto en tu pedido?`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isResumePreviousRequestIntent(lastUserContent) && (draft.pendingUnitIntents || []).length > 0) {
            const { resolved, notFound, ambiguous } = await resolveIntents(draft.pendingUnitIntents || [], draft.cart, config);
            if (ambiguous) {
                const pendingUnitChoice = draft.pendingUnitChoice || null;
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, pendingUnitChoice);
                draft.pendingUnitIntents = [];
                draft.pendingUnitChoice = null;
                armPendingVariant(draft, ambiguous, pendingUnitChoice);
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, [], notFound)}${variantPrompt(ambiguous.searchTerm, ambiguous.options)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            const resolvedWithUnit = resolved.map((item) => ({ ...item, unit: canonicalCatalogUnit(item.unit || "und", item.name) }));
            draft.cart = [...draft.cart, ...resolvedWithUnit];
            draft.pendingUnitIntents = [];
            draft.pendingUnitChoice = null;
            await saveDraft(sessionId, draft);
            const lines = resolvedWithUnit.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`);
            const subtotal = resolvedWithUnit.reduce((acc, i) => acc + i.quantity * i.price, 0);
            const presentableNotFound = visibleNotFoundTerms(notFound);
            const notFoundText = presentableNotFound.length > 0 ? `\nNo encontré: ${presentableNotFound.join(", ")}.` : "";
            const reply = `Listo, veci. Retomé su pedido:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.${notFoundText}\n¿Qué más necesita?`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const correction = parseCorrectionMessage(lastUserContent);
        if (correction) {
            const fromTokens = tokenizeForMatch(correction.from);
            const index = draft.cart.findIndex((i) => hasTokenMatch(i.name, fromTokens));
            if (index >= 0) {
                const [removed] = draft.cart.splice(index, 1);
                const correctionProducts = await searchProductsByTerm(correction.to, config);
                const correctionVariants = variantOptionsFromProducts(correctionProducts, correction.to);
                if (correctionVariants.length > 0) {
                    draft.cart.push(removed);
                    draft.pendingVariant = {
                        searchTerm: correction.to,
                        quantity: removed.quantity,
                        explicitUnit: removed.unit,
                        options: correctionVariants,
                        correctionFromProductId: removed.product_id,
                        correctionFromName: removed.name
                    };
                    await saveDraft(sessionId, draft);
                    const reply = `${variantPrompt(correction.to, correctionVariants)}\nLe estoy corrigiendo ${removed.name}, veci.`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                const { resolved, ambiguous } = await resolveIntents([{ quantity: removed.quantity, product: correction.to }], draft.cart, config);
                if (ambiguous) {
                    draft.cart.push(removed);
                    armPendingVariant(draft, ambiguous, removed.unit);
                    draft.pendingVariant = {
                        ...draft.pendingVariant!,
                        correctionFromProductId: removed.product_id,
                        correctionFromName: removed.name
                    };
                    await saveDraft(sessionId, draft);
                    const reply = `${variantPrompt(ambiguous.searchTerm, ambiguous.options)}\nLe estoy corrigiendo ${removed.name}, veci.`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                if (resolved.length > 0) {
                    const replacement = resolved[0];
                    if (replacement.unit !== removed.unit) {
                        draft.pendingQuantity = {
                            item: {
                                ...replacement,
                                quantity: 1
                            }
                        };
                        await saveDraft(sessionId, draft);
                        const reply = `Le cambié ${removed.name} por ${replacement.name}, veci. Ojo: ese se maneja en ${unitShortLabel(replacement.unit, replacement.name).toLowerCase()}, no en ${unitShortLabel(removed.unit, removed.name).toLowerCase()}. ${unitQuantityQuestion(replacement.unit, replacement.name)}`;
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                    const replaced = { ...replacement, unit: removed.unit };
                    draft.cart.push(replaced);
                    await saveDraft(sessionId, draft);
                    const reply = `Listo, veci. Le cambié ${removed.name} por ${replaced.name} con ${replaced.quantity} ${formatLineUnit(replaced.unit, replaced.name, replaced.quantity)}. ¿Qué más necesita?`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                draft.cart.push(removed);
                await saveDraft(sessionId, draft);
                const reply = `Entendido, veci. No encontré "${correction.to}" para hacer el cambio. ¿Me lo dice con otro nombre del inventario?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        if (draft.awaitingCheckoutConfirmation) {
            const revisionIntents = parseMultipleOrderIntents(lastUserContent);
            if (revisionIntents.length > 0) {
                draft.awaitingCheckoutConfirmation = false;
                draft.pendingCheckoutAfterIntake = false;
                const { resolved, notFound, substitutionNotes, ambiguous, unitClarification, quantityRestriction } = await resolveIntents(revisionIntents, draft.cart, config);
                if (ambiguous) {
                    const mergedResolved = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                    armPendingVariant(draft, ambiguous, extractUnitChoice(lastUserContent));
                    const pendingFollowups = unresolvedFollowupIntents(revisionIntents, mergedResolved, ambiguous.searchTerm);
                    draft.pendingVariant = {
                        ...draft.pendingVariant!,
                        followupIntents: pendingFollowups
                    };
                    await saveDraft(sessionId, draft);
                    const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${variantPrompt(ambiguous.searchTerm, ambiguous.options)}${pendingIntentQueueText(pendingFollowups)}${missingUnitHintForIntents(revisionIntents)}`.trim();
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                if (quantityRestriction) {
                    const mergedResolved = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                    draft.pendingQuantity = { item: quantityRestriction.item };
                    draft.pendingFollowupIntents = unresolvedAfterQuantityRestriction(revisionIntents, mergedResolved, quantityRestriction);
                    await saveDraft(sessionId, draft);
                    const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${quantityRestrictionReply(quantityRestriction.intent, quantityRestriction.item)}`.trim();
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                if (unitClarification) {
                    const mergedResolved = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                    draft.pendingUnitIntents = [unitClarification.intent];
                    draft.pendingUnitChoice = unitClarification.intent.requestedUnit || null;
                    draft.pendingFollowupIntents = unresolvedAfterUnitClarification(revisionIntents, mergedResolved, unitClarification);
                    await saveDraft(sessionId, draft);
                    const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${unitClarificationReply(unitClarification.intent, unitClarification.item)}`.trim();
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                if (resolved.length > 0) {
                    const resolvedWithUnit = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                    await saveDraft(sessionId, draft);
                    const subtotal = resolvedWithUnit.reduce((acc, item) => acc + (item.quantity * item.price), 0);
                    const presentableNotFound = visibleNotFoundTerms(notFound);
                    const notFoundText = presentableNotFound.length > 0 ? `\nNo encontré: ${presentableNotFound.join(", ")}.` : "";
                    const reply = `Listo, veci. Reabrí el pedido y agregué esto:\n${resolvedWithUnit.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`).join("\n")}\nSubtotal de esta tanda: $${subtotal}.${notFoundText}\n¿Qué más necesita?`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }

            if (isAffirmative(lastUserContent)) {
                const reply = `Para confirmar el pedido, usa el botón "Finalizar pedido" y acepta el tratamiento de datos según la Ley de Habeas Data de Colombia. Por seguridad ya no cierro pedidos solo con "sí" en el chat.`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            if (isNegative(lastUserContent)) {
                draft.awaitingCheckoutConfirmation = false;
                await saveDraft(sessionId, draft);
                const reply = "Listo, veci. Seguimos comprando. ¿Qué más le anoto?";
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const reply = `Para enviar su pedido, use el botón "Finalizar pedido" y acepte el tratamiento de datos según Habeas Data.\n${deliveryInfo.note}`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isGratitudeOnly(lastUserContent)) {
            const justConfirmed = wasOrderJustConfirmed(messages.slice(0, -1));
            const reply = justConfirmed
                ? "Con gusto, veci. Pedido listo y confirmado. ¡Gracias por comprar con El Verdulero! 🙌"
                : "Con mucho gusto, veci. Aquí estoy para cuando quiera volver a mercar. 🙌";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isFrustrationMessage(lastUserContent) && !messageCarriesOwnProductIntent(lastUserContent)) {
            const reply = "Tiene toda la razón, veci. Perdón por enredarla. Arranquemos limpio: dígame producto y cantidad con la medida exacta del catálogo (ej: `1 libra de cilantro` o `2 kilos de tomate`) y se lo anoto bien de una.";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isPriceQuestion(lastUserContent)) {
            const quote = await priceReply(lastUserContent, config);
            if (quote) {
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: quote } });
                }
                return assistantJson(quote);
            }
        }

        if (isAvailabilityQuestion(lastUserContent)) {
            const availability = await availabilityReply(lastUserContent, config);
            if (availability) {
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: availability } });
                }
                return assistantJson(availability);
            }
        }

        if (isLastItemRemoveRequest(lastUserContent)) {
            if (draft.cart.length > 0) {
                const removed = draft.cart.pop()!;
                draft.awaitingCheckoutConfirmation = false;
                await saveDraft(sessionId, draft);
                const reply = `Listo, veci. Quité ${removed.name} de la canasta. ¿Qué más necesita?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            const reply = "La canasta está vacía todavía, veci. Dígame qué le anoto y arrancamos.";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const removeRequest = parseRemoveItemMessage(lastUserContent);
        if (removeRequest) {
            const removeTokens = tokenizeForMatch(removeRequest.product);
            const index = draft.cart.findIndex((item) => hasTokenMatch(item.name, removeTokens));
            if (index >= 0) {
                const [removed] = draft.cart.splice(index, 1);
                draft.awaitingCheckoutConfirmation = false;
                await saveDraft(sessionId, draft);
                const reply = `Listo, veci. Quité ${removed.name} de la canasta. ¿Qué más necesita?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const reply = `No veo ${removeRequest.product} en la canasta, veci. ${draft.cart.length > 0 ? `Esto es lo que lleva:\n${cartSummary(draft.cart)}` : "La canasta está vacía todavía."}`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const ambiguousProduct = detectAmbiguousQuantityProduct(lastUserContent);
        if (ambiguousProduct) {
            const reply = `De una, veci. Cuando dice "${ambiguousProduct}", ¿le anoto 250 gramos o 500 gramos?`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isRepeatOrderRequest(lastUserContent) && (profile.correo || profile.telefono)) {
            const returning = profile.correo
                ? await getReturningContextByEmail(profile.correo)
                : await getReturningContext(profile.telefono as string);
            if (returning.lastItems.length > 0) {
                draft.pending = returning.lastItems;
                draft.awaitingRepeatChoice = false;
                await saveDraft(sessionId, draft);
                const subtotal = returning.lastItems.reduce((acc, i) => acc + i.quantity * i.price, 0);
                const reply = `De una, veci. Te propongo repetir: ${compactItems(returning.lastItems)}. Subtotal: $${subtotal}. ¿Me confirmas con "sí" para agregarlo al carrito?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            const noHistoryReply = "No veo una compra anterior para repetir. Dígame qué le anoto hoy y se la armamos de una.";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: noHistoryReply } });
            }
            return assistantJson(noHistoryReply);
        }

        if (draft.pending.length > 0) {
            const pendingCanBeConfirmed = assistantAskedToConfirmPending(messages.slice(0, -1));
            if (!pendingCanBeConfirmed) {
                draft.pending = [];
                await saveDraft(sessionId, draft);
            }

            if (isAffirmative(lastUserContent)) {
                if (!pendingCanBeConfirmed) {
                    const missing = firstMissingField(profile);
                    const reply = missing
                        ? `${fieldQuestion(missing)}\nNecesito ese dato para continuar con el pedido.`
                        : "Listo, veci. Sigamos con su pedido: dígame producto y cantidad y lo voy sumando.";
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                draft.cart = [...draft.cart, ...draft.pending];
                draft.pending = [];
                draft.pendingUnitIntents = [];
                await saveDraft(sessionId, draft);
                const crossSell = await buildCrossSellSuggestions(draft.cart, config, 3);
                const verduleroRules = await buildVerduleroRuleSuggestions(lastUserContent, draft.cart, config);
                const historySuggestion = await buildDayOfWeekSuggestion(profile.telefono, draft.cart, config);
                const allRecs = [...verduleroRules, ...crossSell];
                const recLines = allRecs.map((i) => `- ${i.name} ($${i.price})`);
                if (historySuggestion && !recLines.some((r) => r.includes(historySuggestion.name))) {
                    recLines.unshift(`- ${historySuggestion.name} ($${historySuggestion.price})`);
                }
                const recText = recLines.length > 0
                    ? `\nLe recomiendo para completar:\n${recLines.slice(0, 3).join("\n")}\n¿Le agrego alguno?`
                    : "";
                const ack = pickConfirmationPhrase(lastUserContent, personaMode);
                const reply = `${ack} Ya lo agregué al carrito.\n${cartSummary(draft.cart)}${recText}\n${closingLine(personaMode)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (isNegative(lastUserContent)) {
                draft.pending = [];
                draft.pendingUnitIntents = [];
                await saveDraft(sessionId, draft);
                const reply = "Listo, veci. No agrego esos productos. Mándeme de nuevo el pedido como quiera que lo anote.";
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        // NOTE: explicit affirmative handling only occurs on known pending/checkout states.

        if (/^(ver carrito|carrito|que llevo|qué llevo|cuanto llevo|cuánto llevo|cuanto va|cuánto va|resumen)$/i.test(cleanSearchTerm(lastUserContent))) {
            let effectiveCart = draft.cart;
            if (effectiveCart.length === 0) {
                effectiveCart = await reconstructCartFromMessages(messages, config);
                if (effectiveCart.length > 0) {
                    draft.cart = effectiveCart;
                    await saveDraft(sessionId, draft);
                }
            }
            const reply = `Claro, veci. Este es su carrito:\n${cartSummary(effectiveCart)}`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const inlineCheckoutIntents = parseMultipleOrderIntents(lastUserContent);
        if ((isDoneOrderingIntent(lastUserContent) || isCheckoutIntent(lastUserContent)) && inlineCheckoutIntents.length === 0) {
            if (draft.cart.length === 0) {
                const reply = "Veci, su carrito está vacío todavía. Dígame qué le anoto y cerramos el pedido de una.";
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const missing = firstMissingCheckoutField(profile);
            if (missing) {
                draft.pendingCheckoutAfterIntake = true;
                await saveDraft(sessionId, draft);
                const subtotal = merchandiseTotal(draft.cart);
                const shipping = shippingCost(draft.cart, profile.ciudad, config);
                const total = subtotal + shipping;
                const shippingText = shipping === 0 ? "El envío le queda gratis." : `El envío vale $${shipping}.`;
                const minimumText = minimumOrderStatusText(subtotal, config);
                const reply = `Perfecto, veci. Su mercado va en $${subtotal}. ${shippingText}${minimumText ? ` ${minimumText}` : ""} Total hasta ahora: $${total}.\n${checkoutSummary(draft.cart, deliveryInfo, profile.ciudad, config)}\n${fieldQuestion(missing)}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            draft.awaitingCheckoutConfirmation = false;
            draft.pendingCheckoutAfterIntake = false;
            await saveDraft(sessionId, draft);
            const reply = `Perfecto, veci. Este es el resumen final:\n${checkoutSummary(draft.cart, deliveryInfo, profile.ciudad, config)}\nPara cerrar, usa el botón "Finalizar pedido" y acepta el tratamiento de datos según Habeas Data.`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (isSancochoRequest(lastUserContent)) {
            const sancochoSuggestions = await buildVerduleroRuleSuggestions(lastUserContent, draft.cart, config);
            if (sancochoSuggestions.length > 0) {
                draft.pending = sancochoSuggestions;
                await saveDraft(sessionId, draft);
                const lines = sancochoSuggestions.map((i) => `- ${i.name} ($${i.price})`);
                const reply = `¡De una, veci! Para sancocho le recomiendo esto:\n${lines.join("\n")}\n¿Se lo agrego al carrito con "sí"? 🌽`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        const unitChoice = extractUnitChoice(lastUserContent);
        const currentMessageHasOwnProductIntent = messageCarriesOwnProductIntent(lastUserContent);
        if (unitChoice && !currentMessageHasOwnProductIntent) {
            const inferredPending = lastIntentMessageWithoutUnit(messages.slice(0, -1))?.intents || [];
            const pendingIntents = ((draft.pendingUnitIntents || []).length > 0
                ? (draft.pendingUnitIntents || [])
                : inferredPending);

            if (pendingIntents.length === 0) {
                const qtyOnly = extractQuantityUnitOnly(lastUserContent);
                if (qtyOnly && draft.cart.length > 0) {
                    const last = draft.cart[draft.cart.length - 1];
                    if (requiresUnitClarification(qtyOnly.unit, last.unit, last.name)) {
                        const reply = `Ojo, veci: ${last.name} se maneja en ${unitShortLabel(last.unit, last.name).toLowerCase()}, no en ${unitShortLabel(qtyOnly.unit).toLowerCase()}. Mándemelo en ${unitAskLabel(last.unit, last.name)}, por ejemplo: \`${qtyOnly.quantity} ${unitAskLabel(last.unit, last.name)} de ${last.name}\`.`;
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                    if (!isValidQuantityForUnit(qtyOnly.quantity, last.unit)) {
                        const reply = quantityRestrictionReply(
                            { quantity: qtyOnly.quantity, product: last.name, requestedUnit: qtyOnly.unit },
                            last
                        );
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                    last.quantity = qtyOnly.quantity;
                    draft.awaitingCheckoutConfirmation = false;
                    await saveDraft(sessionId, draft);
                    const reply = `Listo, veci. Ajusté ${last.name} a ${last.quantity} ${formatLineUnit(last.unit, last.name, last.quantity)}. ¿Qué más necesita?`;
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                // If this message already contains its own product, let the normal
                // parsing path below handle it instead of contaminating it with an
                // older unitless request.
            } else {
                if (pendingIntents.length === 1) {
                    const variants = variantOptionsFromProducts(
                        await searchProductsByTerm(pendingIntents[0].product, config),
                        pendingIntents[0].product
                    );
                    if (variants.length > 0) {
                        draft.pendingVariant = {
                            searchTerm: pendingIntents[0].product,
                            quantity: pendingIntents[0].quantity,
                            explicitUnit: unitChoice,
                            options: variants
                        };
                        draft.pendingQuantity = null;
                        await saveDraft(sessionId, draft);
                        const reply = variantPrompt(pendingIntents[0].product, variants);
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                }
                const { resolved, notFound, substitutionNotes, ambiguous, unitClarification, quantityRestriction } = await resolveIntents(pendingIntents, draft.cart, config);
                if (ambiguous) {
                    const mergedResolved = mergeResolvedIntoDraft(draft, resolved, unitChoice);
                    draft.pendingUnitIntents = [];
                    draft.pendingUnitChoice = null;
                    armPendingVariant(draft, ambiguous, unitChoice);
                    const pendingFollowups = mergePendingIntentLists(
                        draft.pendingFollowupIntents,
                        unresolvedFollowupIntents(pendingIntents, mergedResolved, ambiguous.searchTerm)
                    );
                    draft.pendingVariant = {
                        ...draft.pendingVariant!,
                        followupIntents: pendingFollowups
                    };
                    await saveDraft(sessionId, draft);
                    const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${variantPrompt(ambiguous.searchTerm, ambiguous.options)}${pendingIntentQueueText(pendingFollowups)}${missingUnitHintForIntents(pendingIntents)}`.trim();
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                if (quantityRestriction) {
                    const mergedResolved = mergeResolvedIntoDraft(draft, resolved, unitChoice);
                    draft.pendingQuantity = { item: quantityRestriction.item };
                    draft.pendingFollowupIntents = mergePendingIntentLists(
                        draft.pendingFollowupIntents,
                        unresolvedAfterQuantityRestriction(pendingIntents, mergedResolved, quantityRestriction)
                    );
                    await saveDraft(sessionId, draft);
                    const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${quantityRestrictionReply(quantityRestriction.intent, quantityRestriction.item)}`.trim();
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                if (unitClarification) {
                    const mergedResolved = mergeResolvedIntoDraft(draft, resolved, unitChoice);
                    draft.pendingUnitIntents = [unitClarification.intent];
                    draft.pendingUnitChoice = unitClarification.intent.requestedUnit || null;
                    draft.pendingFollowupIntents = mergePendingIntentLists(
                        draft.pendingFollowupIntents,
                        unresolvedAfterUnitClarification(pendingIntents, mergedResolved, unitClarification)
                    );
                    await saveDraft(sessionId, draft);
                    const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${unitClarificationReply(unitClarification.intent, unitClarification.item)}`.trim();
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
                const resolvedWithUnit = resolved.map((item) => ({ ...item, unit: canonicalCatalogUnit(item.unit || unitChoice || "und", item.name) }));
                draft.cart = mergeCartItems(draft.cart, resolvedWithUnit);
                draft.pendingUnitIntents = [];
                draft.pendingUnitChoice = null;
                draft.awaitingCheckoutConfirmation = false;
                await saveDraft(sessionId, draft);

                if (resolvedWithUnit.length === 0) {
                    const presentableNotFound = visibleNotFoundTerms(notFound);
                    const reply = presentableNotFound.length > 0
                        ? `Ay, veci, no encontré esos productos (${presentableNotFound.join(", ")}). ¿Me los manda de nuevo con otro nombre?`
                        : "Ay, veci, no encontré ese producto. ¿Me lo manda de nuevo con otro nombre?";
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }

                const lines = resolvedWithUnit.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`);
                const subtotal = resolvedWithUnit.reduce((acc, i) => acc + i.quantity * i.price, 0);
                const substitutionText = substitutionNotes.length > 0 ? `\nAjustes sugeridos:\n- ${substitutionNotes.join("\n- ")}` : "";
                const reply = `Perfecto, veci. Ya te agregué esto:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.${substitutionText}\n¿Qué más te anoto?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        if ((draft.pendingUnitIntents || []).length > 0) {
            const currentPendingUnitIntents = draft.pendingUnitIntents || [];
            const pendingIntentOverride =
                currentPendingUnitIntents.length === 1
                    ? messageResolvesPendingUnitIntent(lastUserContent, currentPendingUnitIntents[0])
                    : null;
            const effectivePendingUnitIntents = pendingIntentOverride ? [pendingIntentOverride] : currentPendingUnitIntents;
            const effectivePendingUnitChoice = pendingIntentOverride
                ? (pendingIntentOverride.requestedUnit || extractUnitChoice(lastUserContent) || null)
                : (draft.pendingUnitChoice || null);

            if (effectivePendingUnitIntents.length === 1) {
                const pendingIntent = effectivePendingUnitIntents[0];
                const variants = variantOptionsFromProducts(
                    await searchProductsByTerm(pendingIntent.product, config),
                    pendingIntent.product
                );
                if (variants.length > 0) {
                    draft.pendingVariant = {
                        searchTerm: pendingIntent.product,
                        quantity: pendingIntent.quantity,
                        explicitUnit: effectivePendingUnitChoice,
                        options: variants
                    };
                    draft.pendingQuantity = null;
                    draft.pendingUnitIntents = pendingIntentOverride ? [pendingIntentOverride] : draft.pendingUnitIntents;
                    draft.pendingUnitChoice = effectivePendingUnitChoice;
                    await saveDraft(sessionId, draft);
                    const reply = variantPrompt(pendingIntent.product, variants);
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }
            const { resolved, notFound, ambiguous, unitClarification, quantityRestriction } = await resolveIntents(effectivePendingUnitIntents, draft.cart, config);
            if (ambiguous) {
                const pendingFollowups = effectivePendingUnitIntents;
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, effectivePendingUnitChoice);
                draft.pendingUnitIntents = [];
                draft.pendingUnitChoice = null;
                armPendingVariant(draft, ambiguous, effectivePendingUnitChoice);
                const unresolvedPendingFollowups = mergePendingIntentLists(
                    draft.pendingFollowupIntents,
                    unresolvedFollowupIntents(pendingFollowups, mergedResolved, ambiguous.searchTerm)
                );
                draft.pendingVariant = {
                    ...draft.pendingVariant!,
                    followupIntents: unresolvedPendingFollowups
                };
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, [], notFound)}${variantPrompt(ambiguous.searchTerm, ambiguous.options)}${pendingIntentQueueText(unresolvedPendingFollowups)}${missingUnitHintForIntents(pendingFollowups)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (quantityRestriction) {
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, effectivePendingUnitChoice);
                draft.pendingQuantity = { item: quantityRestriction.item };
                draft.pendingFollowupIntents = mergePendingIntentLists(
                    draft.pendingFollowupIntents,
                    unresolvedAfterQuantityRestriction(effectivePendingUnitIntents, mergedResolved, quantityRestriction)
                );
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, [], notFound)}${quantityRestrictionReply(quantityRestriction.intent, quantityRestriction.item)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (unitClarification) {
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, effectivePendingUnitChoice);
                draft.pendingUnitIntents = [unitClarification.intent];
                draft.pendingUnitChoice = unitClarification.intent.requestedUnit || null;
                draft.pendingFollowupIntents = mergePendingIntentLists(
                    draft.pendingFollowupIntents,
                    unresolvedAfterUnitClarification(effectivePendingUnitIntents, mergedResolved, unitClarification)
                );
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, [], notFound)}${unitClarificationReply(unitClarification.intent, unitClarification.item)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (resolved.length > 0) {
                const resolvedWithUnit = resolved.map((item) => ({ ...item, unit: canonicalCatalogUnit(item.unit || "und", item.name) }));
                draft.cart = mergeCartItems(draft.cart, resolvedWithUnit);
                draft.pendingUnitIntents = [];
                draft.pendingUnitChoice = null;
                const pendingFollowups = draft.pendingFollowupIntents || [];
                draft.pendingFollowupIntents = [];
                const followupReply = pendingFollowups.length > 0
                    ? await continueFollowupIntents(draft, pendingFollowups, null, config)
                    : null;
                await saveDraft(sessionId, draft);
                const lines = resolvedWithUnit.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`);
                const subtotal = resolvedWithUnit.reduce((acc, i) => acc + i.quantity * i.price, 0);
                const presentableNotFound = visibleNotFoundTerms(notFound);
                const notFoundText = presentableNotFound.length > 0 ? `\nNo encontré: ${presentableNotFound.join(", ")}.` : "";
                const reply = followupReply?.reply
                    ? `Listo, veci. Ya retomé lo pendiente:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.${notFoundText}\n${followupReply.reply}`
                    : `Listo, veci. Ya retomé lo pendiente:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.${notFoundText}\n¿Qué más le anoto?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            draft.pendingUnitIntents = [];
            draft.pendingUnitChoice = null;
            await saveDraft(sessionId, draft);
            const reply = "Se me perdió ese pendiente, veci. Mándemelo otra vez y se lo anoto bien.";
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const mealIntent = detectMealIntent(lastUserContent);
        if (mealIntent) {
            const semanticIntents: ParsedIntent[] = mealIntent.items.map((item) => ({ quantity: 1, product: item }));
            const { resolved } = await resolveIntents(semanticIntents, draft.cart, config);
            if (resolved.length > 0) {
                draft.pending = resolved;
                await saveDraft(sessionId, draft);
                const proposal = resolved.map((i) => `- 1 x ${i.name} ($${i.price})`).join("\n");
                const reply = `De una, veci. Para ${mealIntent.title} le propongo esta base:\n${proposal}\n¿La agrego al carrito con "sí"?`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        if (listedProducts.length > 1) {
            const foundLines: string[] = [];
            const missingTerms: string[] = [];

            for (const term of listedProducts.slice(0, 8)) {
                const products = await searchProductsByTerm(term, config);
                const best = pickBestProduct(products, term);
                if (best) {
                    foundLines.push(`- ${best.name}: $${best.price} por ${unitShortLabel(best.unit, best.name)}`);
                } else {
                    missingTerms.push(term);
                }
            }

            if (foundLines.length > 0) {
                const missingText = missingTerms.length > 0
                    ? `\nNo encontré con ese nombre: ${missingTerms.join(", ")}.`
                    : "";
                const reply = `De una, veci. Le entendí esta lista:\n${foundLines.join("\n")}${missingText}\nAhora mándeme la cantidad de cada uno, por ejemplo: \`5 libras de cebolla cabezona blanca, 2 libras de ajo\`.`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
        }

        if (singleIntent && singleIntent.quantity === null && lastUserIntents.length === 0) {
            const alreadyInCart = itemAlreadyInCartReply(singleIntent.product, draft.cart);
            if (alreadyInCart) {
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: alreadyInCart } });
                }
                return assistantJson(alreadyInCart);
            }
            const products = await searchProductsByTerm(singleIntent.product, config);
            const variants = variantOptionsFromProducts(products, singleIntent.product);
            if (variants.length > 0) {
                draft.pendingVariant = {
                    searchTerm: singleIntent.product,
                    quantity: null,
                    explicitUnit: null,
                    options: variants
                };
                draft.pendingQuantity = null;
                await saveDraft(sessionId, draft);
                const reply = variantPrompt(singleIntent.product, variants);
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            const product = pickBestProduct(products, singleIntent.product);
            if (!product) {
                const alternatives = await suggestAlternativesFromInventory(singleIntent.product, draft.cart, config, 2);
                const altText = alternatives.length > 0
                    ? ` Sí tengo estas opciones reales:\n${alternatives.map((a) => `- ${a.name} ($${a.price})`).join("\n")}\n¿Le sirve alguna?`
                    : " ¿Le ofrezco otra opción?";
                const reply = `No tengo ${singleIntent.product} en este momento.${altText}`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            draft.pendingQuantity = {
                item: {
                    product_id: product.id,
                    name: product.name,
                    quantity: 1,
                    unit: canonicalCatalogUnit(product.unit || "und", product.name),
                    price: product.price,
                    image: product.image || undefined
                }
            };
            await saveDraft(sessionId, draft);
            const reply = `Sí, claro, sí hay ${product.name} a $${product.price} por ${unitShortLabel(product.unit, product.name)}. ${unitQuantityQuestion(product.unit, product.name)}`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        const intents = parseMultipleOrderIntents(lastUserContent);
        if (intents.length > 0) {
            const wantsToCloseAfterThisAdd = isDoneOrderingIntent(lastUserContent) || isCheckoutIntent(lastUserContent);
            if (intents.length === 1) {
                const variants = variantOptionsFromProducts(await searchProductsByTerm(intents[0].product, config), intents[0].product);
                if (variants.length > 0) {
                    const defaultVariant = defaultVariantForIntent(intents[0], variants);
                    if (defaultVariant) {
                        const item = {
                            ...defaultVariant,
                            quantity: intents[0].quantity
                        };
                        if (requiresUnitClarification(intents[0].requestedUnit, item.unit, item.name)) {
                            draft.pendingUnitIntents = [intents[0]];
                            draft.pendingUnitChoice = intents[0].requestedUnit || null;
                            await saveDraft(sessionId, draft);
                            const reply = unitClarificationReply(intents[0], item);
                            if (sessionId) {
                                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                            }
                            return assistantJson(reply);
                        }
                        draft.cart = mergeCartItems(draft.cart, [item]);
                        draft.awaitingCheckoutConfirmation = false;
                        await saveDraft(sessionId, draft);
                        const subtotal = item.quantity * item.price;
                        const reply = `Listo, veci. Le agregué ${item.quantity} ${formatLineUnit(item.unit, item.name, item.quantity)} de ${item.name} @ $${item.price} = $${subtotal}.\nSubtotal de esta tanda: $${subtotal}.\n¿Qué más necesita?`;
                        if (sessionId) {
                            await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                        }
                        return assistantJson(reply);
                    }
                    draft.pendingVariant = {
                        searchTerm: intents[0].product,
                        quantity: intents[0].quantity,
                        explicitUnit: extractUnitChoice(lastUserContent),
                        options: variants
                    };
                    draft.pendingQuantity = null;
                    await saveDraft(sessionId, draft);
                    const reply = variantPrompt(intents[0].product, variants);
                    if (sessionId) {
                        await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                    }
                    return assistantJson(reply);
                }
            }

            const { resolved, notFound, substitutionNotes, ambiguous, unitClarification, quantityRestriction } = await resolveIntents(intents, draft.cart, config);
            if (ambiguous) {
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                clearPendingOrderState(draft);
                armPendingVariant(draft, ambiguous, extractUnitChoice(lastUserContent));
                const pendingFollowups = mergePendingIntentLists(
                    unresolvedFollowupIntents(intents, mergedResolved, ambiguous.searchTerm)
                );
                draft.pendingVariant = {
                    ...draft.pendingVariant!,
                    followupIntents: pendingFollowups
                };
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${variantPrompt(ambiguous.searchTerm, ambiguous.options)}${pendingIntentQueueText(pendingFollowups)}${missingUnitHintForIntents(intents)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (quantityRestriction) {
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                draft.pendingQuantity = { item: quantityRestriction.item };
                draft.pendingFollowupIntents = mergePendingIntentLists(
                    draft.pendingFollowupIntents,
                    unresolvedAfterQuantityRestriction(intents, mergedResolved, quantityRestriction)
                );
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${quantityRestrictionReply(quantityRestriction.intent, quantityRestriction.item)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            if (unitClarification) {
                const mergedResolved = mergeResolvedIntoDraft(draft, resolved, extractUnitChoice(lastUserContent));
                draft.pendingUnitIntents = [unitClarification.intent];
                draft.pendingUnitChoice = unitClarification.intent.requestedUnit || null;
                draft.pendingFollowupIntents = mergePendingIntentLists(
                    draft.pendingFollowupIntents,
                    unresolvedAfterUnitClarification(intents, mergedResolved, unitClarification)
                );
                await saveDraft(sessionId, draft);
                const reply = `${resolvedItemsSummary(mergedResolved, substitutionNotes, notFound)}${unitClarificationReply(unitClarification.intent, unitClarification.item)}`.trim();
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }
            draft.pendingUnitIntents = [];
            const resolvedWithUnit = resolved.map((item) => ({
                ...item,
                unit: canonicalCatalogUnit(item.unit || extractUnitChoice(lastUserContent) || "und", item.name)
            }));

            if (resolvedWithUnit.length === 0) {
                const presentableNotFound = visibleNotFoundTerms(notFound);
                let reply = presentableNotFound.length > 0
                    ? `Ay, veci, no encontré esos productos (${presentableNotFound.join(", ")}).`
                    : "Ay, veci, no encontré ese producto.";
                const alternatives = await suggestAlternativesFromInventory(notFound[0] || "", draft.cart, config, 2);
                if (alternatives.length > 0) {
                    const lines = alternatives.map((a) => `- ${a.name} ($${a.price})`).join("\n");
                    reply += `\nPero sí tengo estas opciones:\n${lines}\n¿Le sirve alguna?`;
                } else {
                    reply += " ¿Me los manda de nuevo con otro nombre?";
                }
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            draft.cart = mergeCartItems(draft.cart, resolvedWithUnit);
            draft.awaitingCheckoutConfirmation = false;
            await saveDraft(sessionId, draft);

            if (wantsToCloseAfterThisAdd) {
                const subtotal = merchandiseTotal(draft.cart);
                const shipping = shippingCost(draft.cart, profile.ciudad, config);
                const total = subtotal + shipping;
                const shippingText = shipping === 0 ? "El envío te queda gratis." : `El envío vale $${shipping}.`;
                const minimumText = minimumOrderStatusText(subtotal, config);
                const reply = `Listo, veci. Ya quedó anotado lo último.\nSubtotal mercado: $${subtotal}\n${shippingText}${minimumText ? `\n${minimumText}` : ""}\nTOTAL A PAGAR: $${total}\nUsa el botón "Confirmar pedido" para completar tus datos de entrega y cerrar de una.`;
                if (sessionId) {
                    await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
                }
                return assistantJson(reply);
            }

            const lines = resolvedWithUnit.map((i) => `- ${i.quantity} ${formatLineUnit(i.unit, i.name, i.quantity)} de ${i.name} @ $${i.price} = $${i.quantity * i.price}`);
            const subtotal = resolvedWithUnit.reduce((acc, i) => acc + i.quantity * i.price, 0);
            const presentableNotFound = visibleNotFoundTerms(notFound);
            const notFoundText = presentableNotFound.length > 0 ? `\nNo encontré: ${presentableNotFound.join(", ")}.` : "";
            const substitutionText = substitutionNotes.length > 0 ? `\nAjustes sugeridos:\n- ${substitutionNotes.join("\n- ")}` : "";
            const verduleroRules = await buildVerduleroRuleSuggestions(lastUserContent, draft.cart, config);
            const ruleText = verduleroRules.length > 0
                ? `\nDe paso le recomiendo:\n${verduleroRules.map((r) => `- ${r.name} ($${r.price})`).join("\n")}`
                : "";
            const reply = `Veci, le agregué esto al carrito:\n${lines.join("\n")}\nSubtotal de esta tanda: $${subtotal}.${notFoundText}${substitutionText}${ruleText}\n¿Qué más necesita?`;
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            return assistantJson(reply);
        }

        if (!process.env.ANTHROPIC_API_KEY) {
            const reply = await fallbackReply(lastUserContent, config);
            if (sessionId) {
                await prisma.message.create({ data: { sessionId, role: "assistant", content: reply } });
            }
            const contract = buildAssistantContract({
                userText: lastUserContent,
                reply,
                profile,
                draft
            });
            await recordLearningEvent({
                sessionId,
                userMessage: lastUserContent,
                assistantText: reply,
                profile,
                draft,
                contract
            });
            return NextResponse.json({ content: reply, role: "assistant", contract });
        }

        // 5. Agentic tool-use loop
        let responseText = "";
        while (true) {
            let response;
            try {
                response = await client.messages.create({
                    model: ANTHROPIC_MODEL,
                    max_tokens: 4096,
                    system: systemPrompt,
                    tools: TOOLS,
                    messages: anthropicMessages
                });
            } catch (modelError) {
                console.error("Anthropic error, using fallback:", modelError);
                responseText = await fallbackReply(lastUserContent, config);
                break;
            }

            // Extract any text from this response
            const chunkText = extractText(response.content);
            if (chunkText) responseText = chunkText;

            if (response.stop_reason === "end_turn") {
                break;
            }

            if (response.stop_reason === "tool_use") {
                // Add Claude's response (including tool_use blocks) to messages
                anthropicMessages.push({ role: "assistant", content: response.content });

                // Execute all tool calls and collect results
                const toolResults: Anthropic.ToolResultBlockParam[] = [];
                for (const block of response.content) {
                    if (block.type !== "tool_use") continue;

                    let result: any;
                    if (block.name === "get_products") {
                        result = await executeGetProducts((block.input as any).search_term, config);
                    } else {
                        result = { error: "Función desconocida" };
                    }

                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: JSON.stringify(result)
                    });
                }

                anthropicMessages.push({ role: "user", content: toolResults });
            } else {
                // pause_turn or unexpected — break to avoid infinite loop
                break;
            }
        }

        // 6. Save assistant response
        if (!responseText) {
            responseText = "¡Claro, veci! Cuénteme qué productos quiere y yo se los voy anotando uno por uno.";
        }

        const modelContract = parseModelContract(responseText);
        const safeReply = modelContract?.reply && typeof modelContract.reply === "string"
            ? modelContract.reply.trim()
            : responseText;
        const computedContract = buildAssistantContract({
            userText: lastUserContent,
            reply: safeReply,
            profile,
            draft
        });
        const contract: AssistantContract = {
            ...computedContract,
            ...modelContract,
            reply: safeReply,
            stage: computedContract.stage
        };

        if (sessionId && safeReply) {
            await prisma.message.create({
                data: { sessionId, role: "assistant", content: safeReply }
            });
        }
        await recordLearningEvent({
            sessionId,
            userMessage: lastUserContent,
            assistantText: safeReply,
            profile,
            draft,
            contract
        });

        return NextResponse.json({ content: safeReply, role: "assistant", contract });

    } catch (error) {
        console.error("Chat error:", error);
        return NextResponse.json({ error: "Ocurrió un error en el chat" }, { status: 500 });
    }
}
