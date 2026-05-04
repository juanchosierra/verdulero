import { NextResponse } from "next/server";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { normalizeUnitCode } from "@/lib/catalog";

function buildWooClient(config?: { wcUrl?: string | null; wcConsumerKey?: string | null; wcConsumerSecret?: string | null }) {
  return new WooCommerceRestApi({
    url: config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co",
    consumerKey: config?.wcConsumerKey || process.env.WC_CONSUMER_KEY || "",
    consumerSecret: config?.wcConsumerSecret || process.env.WC_CONSUMER_SECRET || "",
    version: "wc/v3"
  });
}

function extractUnitFromRestProduct(product: any): string {
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
    const key = String(entry?.key || "").toLowerCase();
    if (!supportedMetaKeys.has(key)) continue;
    const normalized = normalizeUnitCode(entry?.value);
    if (normalized) return normalized;
  }

  const attributes = Array.isArray(product?.attributes) ? product.attributes : [];
  for (const attr of attributes) {
    const name = String(attr?.name || "").toLowerCase();
    if (!/(unidad|medida|presentacion|presentación|peso|venta)/.test(name)) continue;
    const options = Array.isArray(attr?.options) ? attr.options : [];
    for (const option of options) {
      const normalized = normalizeUnitCode(option);
      if (normalized) return normalized;
    }
  }

  return "und";
}

function mapProduct(product: any) {
  return {
    id: product.id,
    name: product.name,
    regular_price: Number(product.regular_price || product.price || 0),
    status: product.status,
    stock_status: product.stock_status || "instock",
    image: product.images?.[0]?.src || null,
    sku: product.sku || "",
    unit: extractUnitFromRestProduct(product),
    updatedAt: product.date_modified || product.date_created || null
  };
}

export async function GET(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const search = (searchParams.get("search") || "").trim();
    const page = Math.max(Number(searchParams.get("page") || 1), 1);
    const perPage = Math.min(Math.max(Number(searchParams.get("perPage") || 30), 1), 100);

    const config = await prisma.storeConfig.findFirst();
    const wc = buildWooClient(config || undefined);
    const response = await wc.get("products", {
      per_page: perPage,
      page,
      search: search || undefined,
      orderby: "date",
      order: "desc",
      status: "publish"
    });

    const total = Number(response.headers["x-wp-total"] || response.headers["X-WP-Total"] || 0);
    const totalPages = Number(response.headers["x-wp-totalpages"] || response.headers["X-WP-TotalPages"] || 1);

    return NextResponse.json({
      items: Array.isArray(response.data) ? response.data.map(mapProduct) : [],
      total,
      totalPages,
      page,
      perPage,
      source: config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co"
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.response?.data?.message || error?.message || "No se pudieron leer los productos desde Woo" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!id) {
      return NextResponse.json({ error: "Falta el id del producto" }, { status: 400 });
    }

    const name = String(body?.name || "").trim();
    const regularPrice = Number(body?.regular_price || 0);
    const status = String(body?.status || "publish").trim() || "publish";
    const stockStatus = String(body?.stock_status || "instock").trim() || "instock";
    const unit = normalizeUnitCode(body?.unit) || "und";

    const config = await prisma.storeConfig.findFirst();
    const wc = buildWooClient(config || undefined);

    const current = await wc.get(`products/${id}`);
    const currentMeta = Array.isArray(current.data?.meta_data) ? current.data.meta_data : [];
    let updatedUnit = false;
    const nextMeta = currentMeta.map((entry: any) => {
      const key = String(entry?.key || "").toLowerCase();
      if (["_unit_measure", "unit_measure", "_unit", "unit", "_product_unit", "product_unit", "_tipo_unidad", "tipo_unidad", "_medida", "medida", "_unidad", "unidad"].includes(key)) {
        updatedUnit = true;
        return { ...entry, value: unit };
      }
      return entry;
    });
    if (!updatedUnit) {
      nextMeta.push({ key: "_unidad", value: unit });
    }

    const payload = {
      name,
      regular_price: String(regularPrice),
      status,
      stock_status: stockStatus,
      meta_data: nextMeta
    };

    const response = await wc.put(`products/${id}`, payload);
    return NextResponse.json({ ok: true, item: mapProduct(response.data) });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.response?.data?.message || error?.message || "No se pudo actualizar el producto en Woo" },
      { status: 500 }
    );
  }
}
