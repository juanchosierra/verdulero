import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCatalogSnapshot, searchCatalogProducts } from "@/lib/catalog";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const limit = Math.min(Number(searchParams.get("limit") || 16), 40);
    const forceRefresh = searchParams.get("forceRefresh") === "1";

    try {
        const config = await prisma.storeConfig.findFirst();
        const snapshot = await fetchCatalogSnapshot(config || undefined, forceRefresh);
        const products = searchCatalogProducts(snapshot, search, limit).map((product) => ({
            id: product.id,
            name: product.name,
            price: product.price,
            stock_status: product.stock_status,
            image: product.image || null,
            unit: product.unit
        }));

        return NextResponse.json(products);
    } catch (error) {
        console.error("Catalog snapshot error:", error);
        return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
    }
}
