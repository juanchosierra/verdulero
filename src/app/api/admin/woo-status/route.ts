import { NextResponse } from "next/server";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { fetchCatalogSnapshot, invalidateCatalogSnapshot } from "@/lib/catalog";

function buildWooClient(config?: { wcUrl?: string | null; wcConsumerKey?: string | null; wcConsumerSecret?: string | null }) {
  return new WooCommerceRestApi({
    url: config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co",
    consumerKey: config?.wcConsumerKey || process.env.WC_CONSUMER_KEY || "",
    consumerSecret: config?.wcConsumerSecret || process.env.WC_CONSUMER_SECRET || "",
    version: "wc/v3"
  });
}

export async function GET(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const config = await prisma.storeConfig.findFirst();
    const wcUrl = config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co";
    const hasRestCredentials = Boolean(config?.wcConsumerKey && config?.wcConsumerSecret);

    invalidateCatalogSnapshot(config || undefined);

    const storeStartedAt = Date.now();
    const snapshot = await fetchCatalogSnapshot(config || undefined, true);
    const storeLatencyMs = Date.now() - storeStartedAt;

    const storeApi = {
      ok: true,
      source: "Store API pública",
      latencyMs: storeLatencyMs,
      productsRead: snapshot.length,
      sample: snapshot.slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        unit: product.unit,
        stock: product.stock_status
      }))
    };

    if (!hasRestCredentials) {
      return NextResponse.json({
        ok: storeApi.ok,
        checkedAt: new Date().toISOString(),
        wcUrl,
        masked: true,
        storeApi,
        restApi: {
          ok: false,
          configured: false,
          message: "Faltan Consumer Key y Consumer Secret guardados en el servidor."
        }
      });
    }

    const restStartedAt = Date.now();
    const wc = buildWooClient(config || undefined);
    const response = await wc.get("products", {
      per_page: 5,
      page: 1,
      orderby: "date",
      order: "desc",
      status: "publish"
    });
    const restLatencyMs = Date.now() - restStartedAt;
    const products = Array.isArray(response.data) ? response.data : [];

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      wcUrl,
      masked: true,
      storeApi,
      restApi: {
        ok: true,
        configured: true,
        source: "Woo REST API autenticada",
        latencyMs: restLatencyMs,
        productsRead: products.length,
        sample: products.slice(0, 5).map((product: any) => ({
          id: product.id,
          name: product.name,
          price: Number(product.regular_price || product.price || 0),
          status: product.status,
          stock: product.stock_status
        }))
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error?.message || "No se pudo verificar Woo en vivo"
      },
      { status: 500 }
    );
  }
}
