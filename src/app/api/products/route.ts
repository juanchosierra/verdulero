import { NextResponse } from 'next/server';
import { wcApi } from '@/lib/woocommerce';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    if (!search) {
        return NextResponse.json({ error: 'Search term is required' }, { status: 400 });
    }

    try {
        const response = await wcApi.get("products", {
            search: search,
            status: "publish",
            per_page: 10
        });

        const products = response.data.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: parseFloat(p.price),
            stock_status: p.stock_status,
            images: p.images.map((img: any) => img.src)
        }));

        return NextResponse.json(products);
    } catch (error) {
        console.error('WooCommerce API error:', error);
        return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
    }
}
