import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';

const VALID_STATUSES = ["Pendiente", "En Camino", "Completado", "Cancelado"];

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const orders = await prisma.order.findMany({
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(orders);
    } catch {
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { id, status } = await req.json();

        if (!id || !status) {
            return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
        }
        if (!VALID_STATUSES.includes(status)) {
            return NextResponse.json({ error: `Estado inválido. Valores permitidos: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
        }

        const order = await prisma.order.update({
            where: { id: Number(id) },
            data: { status }
        });
        return NextResponse.json(order);
    } catch {
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'Falta el ID del pedido' }, { status: 400 });
        }

        await prisma.order.delete({
            where: { id: Number(id) }
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to delete order' }, { status: 500 });
    }
}
