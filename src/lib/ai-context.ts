import {
    fetchCatalogSnapshot,
    getCatalogMeasureProfile,
    type CatalogProduct,
    type StoreConfigLike
} from "@/lib/catalog";

const CATEGORY_RULES: Array<[string, RegExp]> = [
    ["Frutas", /uchuva|aguacate|mango|banano|banana|naranja|lim[oó]n|mandarina|pi[ñn]a|fresa|mora|papaya|maracuy[aá]|lulo|guayaba|mel[oó]n|sand[ií]a|uva|durazno|ciruela|pera|manzana|agraz|ar[aá]ndano|tomate de arbol/i],
    ["Verduras", /tomate|papa|cebolla|zanahoria|pepino|lechuga|acelga|espinaca|br[oó]coli|coliflor|r[aá]bano|apio|piment[oó]n|aji|aj[ií]|calabaza|ahuyama|yuca|pl[aá]tano|ma[ií]z|habichuela|arveja|fr[ií]jol|remolacha|nabo|r[uú]gula|esparrago|cogollo|brotes|raiz china|repollo|zukini/i],
    ["Hierbas", /cilantro|perejil|tomillo|hierbabuena|albahaca|romero|laurel|ceboll[ií]n/i],
    ["Hongos", /champi[ñn]on|orellana|shiitake|portobello/i],
    ["Bebidas", /zumo|jugo|limonada|colemon/i],
    ["Promociones", /promo|combo|canasta/i]
];

function formatPrice(value: number) {
    return Number(value || 0).toLocaleString("es-CO");
}

function groupByCategory(products: CatalogProduct[]) {
    const grouped = new Map<string, CatalogProduct[]>();
    for (const [category] of CATEGORY_RULES) grouped.set(category, []);
    grouped.set("Otros", []);

    for (const product of products) {
        const category = CATEGORY_RULES.find(([, regex]) => regex.test(product.name))?.[0] || "Otros";
        grouped.get(category)!.push(product);
    }

    return grouped;
}

function formatProduct(product: CatalogProduct) {
    const measure = getCatalogMeasureProfile(product.unit);
    const quantityRule = measure.wholeOnly ? "solo enteros" : "permite medios";
    return `- ${product.name} — $${formatPrice(product.price)} por ${measure.unitLabel} (${quantityRule})`;
}

export async function buildCatalogSystemContext(config?: StoreConfigLike, forceRefresh = false) {
    const products = await fetchCatalogSnapshot(config, forceRefresh);
    const available = products.filter((product) => product.stock_status === "instock");
    const grouped = groupByCategory(available);

    const catalogText = Array.from(grouped.entries())
        .filter(([, items]) => items.length > 0)
        .map(([category, items]) => `### ${category}\n${items.map(formatProduct).join("\n")}`)
        .join("\n\n");

    return `
CONTEXTO DINÁMICO DEL CATÁLOGO:
- Este catálogo fue sincronizado desde WooCommerce antes de responder.
- Solo puedes vender y sugerir productos que existan aquí.
- Usa siempre el nombre exacto, el precio exacto y la unidad exacta del catálogo.
- Respeta la medida del producto: si el catálogo lo maneja solo en enteros, no aceptes medios ni fracciones.
- Si el cliente pide algo que no aparece aquí, solo ofrece un sustituto si está mapeado por las reglas del sistema.

CATÁLOGO DISPONIBLE AHORA:
${catalogText}`.trim();
}
