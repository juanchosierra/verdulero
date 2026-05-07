"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, PackageCheck, ShoppingBasket, TrendingUp } from "lucide-react";

type ProductRow = {
  name: string;
  unit: string;
  image: string | null;
  qtyToday?: number;
  qty7d?: number;
  qty30d?: number;
  revenueToday?: number;
  revenue7d?: number;
  revenue30d?: number;
  avg7?: number;
  sameWeekdayAvg?: number;
  trendPct?: number;
  forecastQty?: number;
  forecast3d?: number;
  forecast7d?: number;
  forecast14d?: number;
  suggestedBuy?: number;
  suggestedBuy3d?: number;
  suggestedBuy7d?: number;
  suggestedBuy14d?: number;
  safetyStock?: number;
  projectedRevenue7d?: number;
  projectedRevenue14d?: number;
  peakHour?: number | null;
  confidence?: number;
  urgency?: "alta" | "media" | "normal";
  coverageDays?: number;
  coverageDate?: string | null;
};

type CustomerRow = {
  customerName: string;
  customerCity: string;
  orders30d: number;
  total30d: number;
  favoriteProducts: string[];
};

type InventorySnapshot = {
  summary: {
    validOrders: number;
    excludedOrders: number;
    productsSoldToday: number;
    qtySoldToday: number;
    qtySold7d: number;
    qtySold30d: number;
    forecastProducts: number;
    totalSuggestedBuy: number;
    totalSuggestedBuy7d: number;
    totalSuggestedBuy14d: number;
    projectedRevenue7d: number;
    projectedRevenue14d: number;
  };
  todayProducts: ProductRow[];
  weeklyProducts: ProductRow[];
  monthlyProducts: ProductRow[];
  forecasts: ProductRow[];
  customers: CustomerRow[];
  dailySeries: { dateKey: string; qty: number; revenue: number; orders: number }[];
  generatedAt: string;
};

function formatCop(value: number) {
  return `$${Number(value || 0).toLocaleString("es-CO")}`;
}

function formatQty(value: number) {
  return Number(value || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

function urgencyClass(urgency?: ProductRow["urgency"]) {
  if (urgency === "alta") return "bg-rose-50 text-rose-700 border-rose-100";
  if (urgency === "media") return "bg-amber-50 text-amber-700 border-amber-100";
  return "bg-emerald-50 text-emerald-700 border-emerald-100";
}

function MetricCard({ label, value, helper, icon }: { label: string; value: string; helper: string; icon: ReactNode }) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-black text-slate-900">{value}</p>
          <p className="mt-2 text-xs font-semibold text-slate-500">{helper}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">{icon}</div>
      </div>
    </div>
  );
}

function ProductTable({ title, subtitle, rows, quantityKey, revenueKey }: { title: string; subtitle: string; rows: ProductRow[]; quantityKey: keyof ProductRow; revenueKey: keyof ProductRow; }) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">{title}</h2>
        <p className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</p>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
              <th className="px-6 py-3">Producto</th>
              <th className="px-6 py-3">Unidad</th>
              <th className="px-6 py-3 text-right">Cantidad</th>
              <th className="px-6 py-3 text-right">Venta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-sm font-semibold text-slate-400">No hay datos en este rango todavía.</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={`${title}-${row.name}`}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    {row.image ? <img src={row.image} alt={row.name} className="h-10 w-10 rounded-xl border border-slate-200 object-cover" /> : <div className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50" />}
                    <span className="text-sm font-black text-slate-900">{row.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-bold text-slate-500">{row.unit}</td>
                <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{Number(row[quantityKey] || 0).toLocaleString("es-CO")}</td>
                <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatCop(Number(row[revenueKey] || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function InventoryPage() {
  const [data, setData] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/inventory", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!json.error) setData(json);
      })
      .finally(() => setLoading(false));
  }, []);

  const maxSeriesQty = useMemo(() => Math.max(...(data?.dailySeries || []).map((item) => item.qty), 1), [data]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
        <p className="text-sm font-black uppercase tracking-widest text-slate-400">Calculando inventario predictivo...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-screen bg-[#F8FAFC]/50 font-sans">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-slate-900 p-2.5 text-white"><Boxes size={18} /></div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-widest text-slate-900">Proyección de compras</h1>
            <p className="mt-1 text-[10px] font-bold uppercase italic tracking-tighter text-slate-400">Demanda prevista + plan de compra para surtir bodega</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase text-emerald-700">
          Generado {data?.generatedAt ? new Date(data.generatedAt).toLocaleString("es-CO") : "ahora"}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 md:p-8">
        <section className="rounded-[2rem] border border-emerald-200 bg-emerald-50 px-6 py-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Modo validado</p>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-emerald-900">
            La proyección usa pedidos válidos, rotación reciente, día de semana, tendencia y hora de compra. Se excluyen pedidos anómalos para no inflar la bodega con datos dañados.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Venta proyectada 7d" value={formatCop(data?.summary.projectedRevenue7d || 0)} helper={`${data?.summary.forecastProducts || 0} productos con demanda prevista`} icon={<TrendingUp size={20} />} />
          <MetricCard label="Comprar 7 días" value={formatQty(data?.summary.totalSuggestedBuy7d || 0)} helper="Unidades/kilos/libras sugeridas por producto" icon={<Boxes size={20} />} />
          <MetricCard label="Comprar 14 días" value={formatQty(data?.summary.totalSuggestedBuy14d || 0)} helper="Plan extendido para bodega" icon={<PackageCheck size={20} />} />
          <MetricCard label="Pedidos válidos" value={`${data?.summary.validOrders || 0}`} helper={`${data?.summary.excludedOrders || 0} pedido(s) anómalos excluidos`} icon={<ShoppingBasket size={20} />} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm xl:col-span-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Pulso de ventas por día</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">Últimos 14 días, basado en cantidades vendidas</p>
              </div>
            </div>
            <div className="flex h-64 items-end justify-between gap-3">
              {(data?.dailySeries || []).map((item) => {
                const height = Math.max((item.qty / maxSeriesQty) * 100, item.qty > 0 ? 6 : 2);
                return (
                  <div key={item.dateKey} className="flex h-full flex-1 flex-col items-center justify-end gap-3">
                    <div className="relative flex h-full w-full flex-col justify-end">
                      <div className="absolute -top-10 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[9px] font-black text-white shadow-xl group-hover/bar:block" />
                      <div style={{ height: `${height}%` }} className="w-full rounded-t-xl bg-gradient-to-t from-emerald-600 to-emerald-400" />
                    </div>
                    <span className="text-[10px] font-black uppercase text-slate-400">{new Date(`${item.dateKey}T12:00:00-05:00`).toLocaleDateString("es-CO", { weekday: "short" })}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm xl:col-span-4 overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Clientes frecuentes</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">Últimos 30 días y productos más repetidos</p>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {(data?.customers || []).length === 0 ? (
                <div className="p-8 text-center text-sm font-semibold text-slate-400">Todavía no hay suficientes pedidos para este análisis.</div>
              ) : (data?.customers || []).map((customer) => (
                <div key={`${customer.customerName}-${customer.customerCity}`} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{customer.customerName}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{customer.customerCity}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pedidos</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{customer.orders30d}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-600">Favoritos: {customer.favoriteProducts.join(", ") || "Sin patrón todavía"}</p>
                  <p className="mt-1 text-xs font-black text-emerald-700">{formatCop(customer.total30d)}</p>
                </div>
              ))}
            </div>
          </section>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ProductTable title="Lo vendido hoy" subtitle="Productos con movimiento real hoy" rows={data?.todayProducts || []} quantityKey="qtyToday" revenueKey="revenueToday" />
          <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Plan de compra recomendado</h2>
              <p className="mt-1 text-xs font-semibold text-slate-500">Qué comprar para mantener surtido mañana, 7 días y 14 días</p>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <th className="px-6 py-3">Producto</th>
                    <th className="px-6 py-3 text-right">Mañana</th>
                    <th className="px-6 py-3 text-right">Comprar 7d</th>
                    <th className="px-6 py-3 text-right">Comprar 14d</th>
                    <th className="px-6 py-3 text-right">Confianza</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.forecasts || []).map((row) => (
                    <tr key={`forecast-${row.name}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {row.image ? <img src={row.image} alt={row.name} className="h-10 w-10 rounded-xl border border-slate-200 object-cover" /> : <div className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-50" />}
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-black text-slate-900">{row.name}</p>
                              <span className={`rounded-md border px-2 py-0.5 text-[9px] font-black uppercase ${urgencyClass(row.urgency)}`}>
                                {row.urgency || "normal"}
                              </span>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-slate-500">
                              {row.unit} · prom. 7d {formatQty(row.avg7 || 0)} · tendencia {row.trendPct}% · pico {row.peakHour !== null && row.peakHour !== undefined ? `${row.peakHour}:00` : "-"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-black text-emerald-700">{formatQty(row.suggestedBuy || 0)} {row.unit}</td>
                      <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatQty(row.suggestedBuy7d || 0)} {row.unit}</td>
                      <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatQty(row.suggestedBuy14d || 0)} {row.unit}</td>
                      <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{row.confidence || 0}%</td>
                    </tr>
                  ))}
                  {(data?.forecasts || []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-sm font-semibold text-slate-400">Todavía no hay suficientes pedidos válidos para proyectar compras.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ProductTable title="Últimos 7 días" subtitle="Qué rota más en la semana" rows={data?.weeklyProducts || []} quantityKey="qty7d" revenueKey="revenue7d" />
          <ProductTable title="Últimos 30 días" subtitle="Qué más se está vendiendo en el mes" rows={data?.monthlyProducts || []} quantityKey="qty30d" revenueKey="revenue30d" />
        </section>
      </main>
    </div>
  );
}
