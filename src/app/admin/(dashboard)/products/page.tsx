"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  Eye,
  Loader2,
  PackageSearch,
  RefreshCw,
  Save,
  Search,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

type ProductRow = {
  id: number;
  name: string;
  regular_price: number;
  status: string;
  stock_status: string;
  image: string | null;
  sku: string;
  unit: string;
  updatedAt: string | null;
};

function formatCop(value: number) {
  return `$${Number(value || 0).toLocaleString("es-CO")}`;
}

export default function AdminProductsPage() {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [form, setForm] = useState<any>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  const fetchProducts = async (nextPage = page, nextSearch = search) => {
    setLoading(true);
    setErrorText("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        perPage: "30"
      });
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      const res = await fetch(`/api/admin/products?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron leer los productos");
      setItems(data.items || []);
      setTotalPages(Number(data.totalPages || 1));
      setSource(data.source || "");
    } catch (error: any) {
      setErrorText(error?.message || "No se pudieron leer los productos");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts(1, search);
    setPage(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalLabel = useMemo(() => `${items.length} producto(s) visibles`, [items]);

  const openEditor = (item: ProductRow) => {
    setSelected(item);
    setForm({
      id: item.id,
      name: item.name,
      regular_price: item.regular_price,
      status: item.status,
      stock_status: item.stock_status,
      unit: item.unit
    });
    setStatus("idle");
  };

  const saveProduct = async () => {
    if (!form?.id) return;
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      setStatus("ok");
      setSelected(data.item);
      setForm({
        id: data.item.id,
        name: data.item.name,
        regular_price: data.item.regular_price,
        status: data.item.status,
        stock_status: data.item.stock_status,
        unit: data.item.unit
      });
      await fetchProducts(page, search);
    } catch (error: any) {
      setStatus("error");
      setErrorText(error?.message || "No se pudo guardar el producto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 h-screen overflow-hidden bg-slate-50/50 flex flex-col font-sans animate-in fade-in duration-500">
      <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
            <Boxes size={18} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Catálogo en vivo</h1>
            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
              <PackageSearch size={10} /> {totalLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(1);
                  fetchProducts(1, search);
                }
              }}
              className="bg-slate-100 border-none rounded-lg py-2 pl-9 pr-4 text-[11px] font-bold outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white w-56 transition-all"
            />
          </div>
          <button
            onClick={() => fetchProducts(page, search)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700"
          >
            <RefreshCw size={14} />
            Recargar Woo
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6 md:p-8 max-w-7xl mx-auto w-full">
        <div className="grid h-full min-h-0 grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Fuente viva</p>
                <p className="mt-1 text-sm font-bold text-slate-700">{source || "WooCommerce"}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const prev = Math.max(page - 1, 1);
                    setPage(prev);
                    fetchProducts(prev, search);
                  }}
                  disabled={page <= 1 || loading}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40"
                >
                  Anterior
                </button>
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600">
                  Página {page} / {totalPages}
                </div>
                <button
                  onClick={() => {
                    const next = Math.min(page + 1, totalPages);
                    setPage(next);
                    fetchProducts(next, search);
                  }}
                  disabled={page >= totalPages || loading}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>

            <div className="h-full overflow-y-auto">
              {loading ? (
                <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Leyendo Woo en vivo...</p>
                </div>
              ) : errorText ? (
                <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
                  {errorText}
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-6 py-4">Producto</th>
                      <th className="px-6 py-4">Precio</th>
                      <th className="px-6 py-4">Unidad</th>
                      <th className="px-6 py-4">Estado</th>
                      <th className="px-6 py-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {item.image ? (
                              <img src={item.image} alt={item.name} className="h-12 w-12 rounded-2xl border border-slate-200 object-cover bg-slate-50" />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-300">
                                <Boxes size={16} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                              <div className="mt-1 text-[11px] font-semibold text-slate-400">#{item.id} {item.sku ? `· SKU ${item.sku}` : ""}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-black text-slate-900">{formatCop(item.regular_price)}</td>
                        <td className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-500">{item.unit}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest",
                            item.status === "publish" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                          )}>
                            {item.status === "publish" ? "Publicado" : item.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => openEditor(item)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700 hover:border-emerald-200 hover:text-emerald-700"
                          >
                            <Eye size={14} />
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Control de producto</p>
              <p className="mt-1 text-sm font-bold text-slate-700">Woo es la fuente real. Si cambias aquí, se sube a Woo. Si cambias en Woo, al recargar baja actualizado.</p>
            </div>

            <div className="h-full overflow-y-auto p-6">
              {!selected || !form ? (
                <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-300">
                    <PackageSearch size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase tracking-widest text-slate-500">Elige un producto</p>
                    <p className="mt-2 text-sm font-semibold text-slate-400">Aquí vamos a editarlo en vivo y guardarlo directo en WooCommerce.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-600">Producto seleccionado</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">{selected.name}</h2>
                      <p className="mt-2 text-xs font-semibold text-slate-500">ID #{selected.id}</p>
                    </div>
                    <button
                      onClick={() => {
                        setSelected(null);
                        setForm(null);
                        setStatus("idle");
                        setErrorText("");
                      }}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {selected.image && (
                    <img src={selected.image} alt={selected.name} className="h-40 w-full rounded-3xl border border-slate-200 object-cover bg-slate-50" />
                  )}

                  <div className="space-y-4">
                    <Field label="Nombre">
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:bg-white"
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Precio regular">
                        <input
                          type="number"
                          value={form.regular_price}
                          onChange={(e) => setForm({ ...form, regular_price: Number(e.target.value || 0) })}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:bg-white"
                        />
                      </Field>
                      <Field label="Unidad">
                        <select
                          value={form.unit}
                          onChange={(e) => setForm({ ...form, unit: e.target.value })}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:bg-white"
                        >
                          {["lb", "kg", "und", "atado", "bja", "lts", "carton", "bidon", "canastilla"].map((unit) => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Estado de publicación">
                        <select
                          value={form.status}
                          onChange={(e) => setForm({ ...form, status: e.target.value })}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:bg-white"
                        >
                          <option value="publish">Publicado</option>
                          <option value="draft">Borrador</option>
                          <option value="private">Privado</option>
                        </select>
                      </Field>
                      <Field label="Stock lógico">
                        <select
                          value={form.stock_status}
                          onChange={(e) => setForm({ ...form, stock_status: e.target.value })}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:bg-white"
                        >
                          <option value="instock">Instock</option>
                          <option value="outofstock">Outofstock</option>
                          <option value="onbackorder">Onbackorder</option>
                        </select>
                      </Field>
                    </div>
                  </div>

                  {status === "ok" && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                      Producto actualizado en Woo correctamente.
                    </div>
                  )}
                  {status === "error" && errorText && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                      {errorText}
                    </div>
                  )}

                  <button
                    onClick={saveProduct}
                    disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {saving ? "Guardando..." : "Guardar en Woo"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      {children}
    </div>
  );
}
