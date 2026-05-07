import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { fetchCatalogSnapshot, type CatalogProduct } from "@/lib/catalog";

type CartItem = {
    product_id: number;
    name: string;
    quantity: number;
    unit: string;
    price: number;
    image?: string;
};

type DraftState = {
    cart: CartItem[];
    pending: CartItem[];
    [key: string]: unknown;
};

function emptyState(): DraftState {
    return { cart: [], pending: [] };
}

async function loadState(sessionId: string): Promise<DraftState> {
    const draft = await prisma.orderDraft.findUnique({ where: { sessionId } });
    if (!draft) return emptyState();
    try {
        const parsed = JSON.parse(draft.data || "{}");
        return {
            ...parsed,
            cart: Array.isArray(parsed.cart) ? parsed.cart : [],
            pending: Array.isArray(parsed.pending) ? parsed.pending : []
        };
    } catch {
        return emptyState();
    }
}

async function saveState(sessionId: string, state: DraftState) {
    await prisma.orderDraft.upsert({
        where: { sessionId },
        update: { data: JSON.stringify(state) },
        create: { sessionId, data: JSON.stringify(state) }
    });
}

function normalizeCartItem(input: any): CartItem | null {
    const productId = Number(input?.product_id || input?.productId || 0);
    const quantity = Number(input?.quantity || 0);
    const price = Number(input?.price || 0);
    const name = String(input?.name || "").trim();
    const unit = String(input?.unit || "und").trim() || "und";
    const image = typeof input?.image === "string" ? input.image : undefined;

    if (!productId || !name || quantity <= 0 || price < 0) return null;

    return {
        product_id: productId,
        name,
        quantity,
        unit,
        price,
        image
    };
}

function total(items: CartItem[]) {
    return items.reduce((acc, item) => acc + item.quantity * item.price, 0);
}

function refreshItemsFromCatalog(items: CartItem[], catalogById: Map<number, CatalogProduct>) {
    let changed = false;
    const refreshed = items.map((item) => {
        const liveProduct = catalogById.get(Number(item.product_id));
        if (!liveProduct) return item;

        const nextItem = {
            ...item,
            name: liveProduct.name || item.name,
            price: Number(liveProduct.price || 0),
            unit: liveProduct.unit || item.unit,
            image: liveProduct.image || item.image
        };

        if (
            nextItem.name !== item.name ||
            nextItem.price !== item.price ||
            nextItem.unit !== item.unit ||
            nextItem.image !== item.image
        ) {
            changed = true;
        }

        return nextItem;
    });

    return { items: refreshed, changed };
}

async function refreshStateFromCatalog(state: DraftState, forceRefresh: boolean) {
    if (state.cart.length === 0 && state.pending.length === 0) return false;

    const config = await prisma.storeConfig.findFirst();
    const snapshot = await fetchCatalogSnapshot(config || undefined, forceRefresh);
    const catalogById = new Map(snapshot.map((product) => [Number(product.id), product]));
    const cart = refreshItemsFromCatalog(state.cart, catalogById);
    const pending = refreshItemsFromCatalog(state.pending, catalogById);

    state.cart = cart.items;
    state.pending = pending.items;

    return cart.changed || pending.changed;
}

function buildWooClient(config?: { wcUrl?: string | null; wcConsumerKey?: string | null; wcConsumerSecret?: string | null }) {
    return new WooCommerceRestApi({
        url: config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co",
        consumerKey: config?.wcConsumerKey || process.env.WC_CONSUMER_KEY || "",
        consumerSecret: config?.wcConsumerSecret || process.env.WC_CONSUMER_SECRET || "",
        version: "wc/v3"
    });
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const forceRefresh = searchParams.get("forceRefresh") === "1";
    if (!sessionId) {
        return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const state = await loadState(sessionId);
    let didRefreshCatalog = false;
    try {
        didRefreshCatalog = await refreshStateFromCatalog(state, forceRefresh);
    } catch (error) {
        console.error("Cart catalog refresh error:", error);
    }

    const needsImage = state.cart.filter((i) => !i.image);
    if (needsImage.length > 0) {
        try {
            const config = await prisma.storeConfig.findFirst();
            const wc = buildWooClient(config || undefined);
            const updates = await Promise.all(
                needsImage.map(async (item) => {
                    try {
                        const response = await wc.get(`products/${item.product_id}`);
                        const image = response.data?.images?.[0]?.src;
                        return { product_id: item.product_id, image };
                    } catch {
                        return { product_id: item.product_id, image: undefined };
                    }
                })
            );

            const imageMap = new Map(updates.map((u) => [u.product_id, u.image]));
            state.cart = state.cart.map((item) => ({
                ...item,
                image: item.image || imageMap.get(item.product_id)
            }));
            didRefreshCatalog = true;
        } catch {
            // Ignore image enrichment failures.
        }
    }

    if (didRefreshCatalog) {
        await saveState(sessionId, state);
    }

    return NextResponse.json({
        items: state.cart,
        pending: state.pending,
        total: total(state.cart)
    });
}

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { sessionId, productId, delta } = body || {};
        if (!sessionId || !productId || !delta) {
            return NextResponse.json({ error: "sessionId, productId and delta are required" }, { status: 400 });
        }

        const state = await loadState(sessionId);
        state.cart = state.cart
            .map((item) => {
                if (item.product_id !== Number(productId)) return item;
                return { ...item, quantity: item.quantity + Number(delta) };
            })
            .filter((item) => item.quantity > 0);

        await saveState(sessionId, state);
        return NextResponse.json({
            items: state.cart,
            pending: state.pending,
            total: total(state.cart)
        });
    } catch (error) {
        return NextResponse.json({ error: "Failed to update cart" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { sessionId, item, quantity } = body || {};
        if (!sessionId || !item) {
            return NextResponse.json({ error: "sessionId and item are required" }, { status: 400 });
        }

        const parsedItem = normalizeCartItem({
            ...item,
            quantity: Number(quantity || item?.quantity || 1)
        });

        if (!parsedItem) {
            return NextResponse.json({ error: "Invalid cart item" }, { status: 400 });
        }

        const state = await loadState(sessionId);
        const index = state.cart.findIndex((cartItem) => cartItem.product_id === parsedItem.product_id);

        if (index >= 0) {
            state.cart[index] = {
                ...state.cart[index],
                quantity: state.cart[index].quantity + parsedItem.quantity,
                image: state.cart[index].image || parsedItem.image
            };
        } else {
            state.cart.push(parsedItem);
        }

        await saveState(sessionId, state);
        return NextResponse.json({
            items: state.cart,
            pending: state.pending,
            total: total(state.cart)
        });
    } catch {
        return NextResponse.json({ error: "Failed to add cart item" }, { status: 500 });
    }
}
