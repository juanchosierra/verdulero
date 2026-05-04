"use client";

import { useState, useEffect } from 'react';
import {
    ShoppingBasket,
    Phone,
    MapPin,
    Printer,
    Eye,
    Search,
    Calendar,
    Package,
    Loader2,
    Truck,
    Check,
    Mail,
    X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from "framer-motion";

function formatCop(value: number) {
    return `$${Number(value || 0).toLocaleString('es-CO')}`;
}

function unitLabel(unit?: string) {
    const normalized = String(unit || '').toLowerCase();
    if (normalized === 'lb') return 'lb';
    if (normalized === 'kg') return 'kg';
    if (normalized === 'und') return 'und';
    if (normalized === 'atado') return 'atado';
    if (normalized === 'bja') return 'bja';
    if (normalized === 'lts') return 'lts';
    if (normalized === 'carton') return 'cartón';
    if (normalized === 'bidon') return 'bidón';
    if (normalized === 'canastilla') return 'canastilla';
    return normalized || 'und';
}

function bogotaDateKey(value: string | Date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(value));
}

export default function OrdersPage() {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('Todos');
    const [scope, setScope] = useState<'Hoy' | 'Historial'>('Hoy');
    const [search, setSearch] = useState('');
    const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

    const fetchOrders = async () => {
        try {
            const res = await fetch('/api/admin/orders');
            const data = await res.json();
            if (!data.error) {
                const parsedData = data.map((o: any) => ({
                    ...(() => {
                        const items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items;
                        const computedSubtotal = items.reduce((acc: number, item: any) => acc + (Number(item.quantity || 0) * Number(item.price || 0)), 0);
                        const subtotal = Number.isFinite(Number(o.subtotal)) && Number(o.subtotal) > 0 ? Number(o.subtotal) : computedSubtotal;
                        const shipping = Number.isFinite(Number(o.shipping))
                            ? Number(o.shipping)
                            : Math.max(Number(o.total || 0) - subtotal, 0);

                        return {
                            ...o,
                            items,
                            shipping,
                            subtotal
                        };
                    })()
                }));
                setOrders(parsedData);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, []);

    const updateStatus = async (id: number, status: string) => {
        try {
            const res = await fetch('/api/admin/orders', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status })
            });
            if (res.ok) {
                fetchOrders(); // Refresh
            }
        } catch (e) {
            console.error(e);
        }
    };

    const printTicket = (order: any) => {
        const printWindow = window.open("", "_blank", "width=420,height=740");
        if (!printWindow) return;
        const itemsRows = (order.items || [])
            .map((it: any) => `
                <tr>
                    <td style="padding:2px 0;">${it.quantity} ${unitLabel(it.unit)}</td>
                    <td style="padding:2px 6px;">${it.name}</td>
                    <td style="text-align:right;padding:2px 0;">${formatCop(it.price * it.quantity)}</td>
                </tr>
            `)
            .join("");
        const shipping = Number(order.shipping || 0);
        const subtotal = Number(order.subtotal || 0);
        const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tirilla Pedido #${order.id}</title>
  <style>
    body { font-family: monospace; margin: 12px; }
    .ticket { width: 78mm; margin: 0 auto; }
    h1,h2,p { margin: 0; text-align:center; }
    h1 { font-size: 14px; }
    p { font-size: 11px; }
    .line { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    td { padding: 2px 0; vertical-align: top; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="ticket">
    <h1>EL VERDULERO</h1>
    <p>Frescura en su puerta</p>
    <div class="line"></div>
    <p>PEDIDO #${order.id}</p>
    <p>${new Date(order.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</p>
    <div class="line"></div>
    <p><b>${order.customerName}</b></p>
    <p>${order.customerPhone}</p>
    <p>${order.customerEmail || ''}</p>
    <p>${order.customerAddress}, ${order.customerCity}</p>
    <div class="line"></div>
    <table style="width:100%;">
      <thead>
        <tr>
          <td><b>Cant</b></td>
          <td><b>Producto</b></td>
          <td style="text-align:right;"><b>Subt</b></td>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>
    <div class="line"></div>
    <table style="width:100%; font-size:11px;">
      <tr><td>Subtotal</td><td style="text-align:right;">${formatCop(subtotal)}</td></tr>
      <tr><td>Envío</td><td style="text-align:right;">${shipping === 0 ? 'Gratis' : formatCop(shipping)}</td></tr>
      <tr><td><b>TOTAL A PAGAR</b></td><td style="text-align:right;"><b>${formatCop(Number(order.total || 0))}</b></td></tr>
    </table>
    <p>PAGO: CONTRA ENTREGA</p>
    <div class="line"></div>
    <p>¡Gracias por preferirnos!</p>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
    };

    const todayKey = bogotaDateKey(new Date());
    const ordersToday = orders.filter((o) => bogotaDateKey(o.createdAt) === todayKey);
    const baseOrders = scope === 'Hoy' ? ordersToday : orders;

    const filteredOrders = baseOrders.filter(o => {
        const matchesFilter = filter === 'Todos' || o.status === filter;
        const matchesSearch = o.customerName.toLowerCase().includes(search.toLowerCase()) ||
            o.id.toString().includes(search);
        return matchesFilter && matchesSearch;
    });

    return (
        <div className="flex-1 h-screen overflow-hidden bg-slate-50/50 flex flex-col font-sans animate-in fade-in duration-500">

            {/* 🟢 Header de Ventas - Compacto */}
            <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
                        <ShoppingBasket size={18} />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Gestión de Ventas</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
                            <Package size={10} /> {ordersToday.length} pedidos hoy
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Buscar pedido..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="bg-slate-100 border-none rounded-lg py-2 pl-9 pr-4 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white w-48 transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                        {(['Hoy', 'Historial'] as const).map((option) => (
                            <button
                                key={option}
                                onClick={() => setScope(option)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-tighter transition-all",
                                    scope === option ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                {option}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg border border-slate-200">
                        {['Todos', 'Pendiente', 'En Camino', 'Completado'].map(t => (
                            <button
                                key={t}
                                onClick={() => setFilter(t)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[9px] font-black uppercase tracking-tighter transition-all",
                                    filter === t ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-6 md:p-8 max-w-7xl mx-auto w-full">
                {loading ? (
                    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cargando despacho...</p>
                    </div>
                ) : filteredOrders.length === 0 ? (
                    <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-20 text-center space-y-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                            <Package size={32} />
                        </div>
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest leading-none">
                            {scope === 'Hoy' ? 'No hay pedidos para hoy' : 'No se encontraron pedidos en el historial'}
                        </p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-b-4 border-b-emerald-600/10">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left order-collapse font-sans">
                                <thead>
                                    <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                        <th className="px-6 py-4">Ref & ID</th>
                                        <th className="px-6 py-4">Cliente & Destino</th>
                                        <th className="px-6 py-4">Productos</th>
                                        <th className="px-6 py-4">Total</th>
                                        <th className="px-6 py-4 text-right">Acciones de Flujo</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 bg-white">
                                    <AnimatePresence mode='popLayout'>
                                        {filteredOrders.map((order) => (
                                            <motion.tr
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                key={order.id}
                                                className="group hover:bg-slate-50/50 transition-all duration-300"
                                            >
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-col gap-1.5">
                                                        <span className="text-sm font-black text-slate-900 tracking-tight">#{order.id}</span>
                                                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400 bg-slate-100 w-fit px-2 py-0.5 rounded border border-slate-200">
                                                            <Calendar size={10} /> {new Date(order.createdAt).toLocaleDateString('es-CO')}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-col gap-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-black text-slate-800 tracking-tight leading-none uppercase">{order.customerName}</span>
                                                            <a href={`https://wa.me/${order.customerPhone}`} target="_blank" className="p-1 hover:bg-emerald-50 rounded transition-colors group/wa">
                                                                <Phone size={10} className="text-emerald-500 group-hover/wa:scale-110" />
                                                            </a>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 italic max-w-[200px] truncate">
                                                            <MapPin size={10} className="text-rose-400 flex-shrink-0" />
                                                            {order.customerAddress}, {order.customerCity}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex flex-wrap gap-1.5 max-w-[220px]">
                                                        {order.items.slice(0, 3).map((it: any, i: number) => (
                                                            <button
                                                                key={i}
                                                                onClick={() => setSelectedOrder(order)}
                                                                className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[9px] font-black text-slate-600 shadow-sm hover:border-emerald-300 hover:text-emerald-700 transition-colors"
                                                                title={`${it.quantity} ${unitLabel(it.unit)} de ${it.name}`}
                                                            >
                                                                {it.quantity} {it.name}
                                                            </button>
                                                        ))}
                                                        {order.items.length > 3 && (
                                                            <button
                                                                onClick={() => setSelectedOrder(order)}
                                                                className="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[9px] font-black text-emerald-700"
                                                            >
                                                                +{order.items.length - 3} más
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-5 font-black text-slate-950 text-base italic tracking-tighter">
                                                    ${order.total.toLocaleString()}
                                                </td>
                                                <td className="px-6 py-5">
                                                    <div className="flex items-center justify-end gap-3">
                                                        <div className={cn(
                                                            "px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-widest border shadow-sm",
                                                            order.status === 'Pendiente' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                                                order.status === 'En Camino' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                                    'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                        )}>
                                                            {order.status}
                                                        </div>
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => setSelectedOrder(order)}
                                                                className="p-1.5 bg-slate-100 text-slate-500 rounded hover:bg-slate-200 transition-all border border-slate-200"
                                                                title="Ver pedido"
                                                            >
                                                                <Eye size={12} />
                                                            </button>
                                                            {order.status === 'Pendiente' && (
                                                                <button
                                                                    onClick={() => updateStatus(order.id, 'En Camino')}
                                                                    className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/10"
                                                                    title="Despachar"
                                                                >
                                                                    <Truck size={12} />
                                                                </button>
                                                            )}
                                                            {order.status === 'En Camino' && (
                                                                <button
                                                                    onClick={() => updateStatus(order.id, 'Completado')}
                                                                    className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/10"
                                                                    title="Finalizar"
                                                                >
                                                                    <Check size={12} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => printTicket(order)}
                                                                className="p-1.5 bg-slate-100 text-slate-400 rounded hover:bg-slate-200 transition-all border border-slate-200"
                                                                title="Imprimir tirilla"
                                                            >
                                                                <Printer size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </motion.tr>
                                        ))}
                                    </AnimatePresence>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>

            <AnimatePresence>
                {selectedOrder && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[80] bg-slate-950/40 backdrop-blur-sm p-4 md:p-8"
                        onClick={() => setSelectedOrder(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 18, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.98 }}
                            transition={{ duration: 0.18 }}
                            className="ml-auto h-full w-full max-w-2xl overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-2xl flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-600">Pedido #{selectedOrder.id}</div>
                                    <h2 className="mt-2 text-2xl font-black text-slate-900">{selectedOrder.customerName}</h2>
                                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                                        <span className="inline-flex items-center gap-1.5"><Calendar size={14} />{new Date(selectedOrder.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</span>
                                        <span className={cn(
                                            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                                            selectedOrder.status === 'Pendiente' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                                selectedOrder.status === 'En Camino' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                    'bg-emerald-50 text-emerald-700 border-emerald-100'
                                        )}>
                                            {selectedOrder.status}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedOrder(null)}
                                    className="w-10 h-10 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                                <section className="grid md:grid-cols-2 gap-4">
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Cliente y entrega</div>
                                        <div className="text-base font-black text-slate-900">{selectedOrder.customerName}</div>
                                        <div className="text-sm text-slate-600 inline-flex items-center gap-2"><Phone size={14} className="text-emerald-500" />{selectedOrder.customerPhone}</div>
                                        <div className="text-sm text-slate-600 inline-flex items-center gap-2"><Mail size={14} className="text-emerald-500" />{selectedOrder.customerEmail || 'Sin correo registrado'}</div>
                                        <div className="text-sm text-slate-600 inline-flex items-start gap-2"><MapPin size={14} className="text-rose-400 mt-0.5" />{selectedOrder.customerAddress}, {selectedOrder.customerCity}</div>
                                    </div>
                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Resumen de cobro</div>
                                        <div className="flex items-center justify-between text-sm text-slate-700"><span>Subtotal mercado</span><strong>{formatCop(selectedOrder.subtotal)}</strong></div>
                                        <div className="flex items-center justify-between text-sm text-slate-700"><span>Envío</span><strong>{selectedOrder.shipping === 0 ? 'Gratis' : formatCop(selectedOrder.shipping)}</strong></div>
                                        <div className="pt-2 border-t border-emerald-200 flex items-center justify-between">
                                            <span className="text-base font-black text-slate-900">Total</span>
                                            <span className="text-2xl font-black text-emerald-700">{formatCop(selectedOrder.total)}</span>
                                        </div>
                                        <div className="text-xs font-bold text-emerald-800">Pago contra entrega</div>
                                    </div>
                                </section>

                                <section className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Productos del pedido</div>
                                        <button
                                            onClick={() => printTicket(selectedOrder)}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800"
                                        >
                                            <Printer size={14} /> Imprimir tirilla
                                        </button>
                                    </div>
                                    <div className="space-y-3">
                                        {selectedOrder.items.map((item: any, index: number) => (
                                            <div key={`${selectedOrder.id}-${index}`} className="rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
                                                {item.image ? (
                                                    <img src={item.image} alt={item.name} className="w-16 h-16 rounded-2xl object-cover border border-emerald-100 bg-slate-50" />
                                                ) : (
                                                    <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                                                        <Package size={20} />
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-base font-black text-slate-900 leading-tight">{item.name}</div>
                                                    <div className="mt-1 text-sm text-slate-500">
                                                        {item.quantity} {unitLabel(item.unit)} · {formatCop(item.price)} c/u
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Subtotal</div>
                                                    <div className="text-lg font-black text-emerald-700">{formatCop(item.quantity * item.price)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
