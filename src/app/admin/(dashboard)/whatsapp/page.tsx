"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Clipboard,
  Loader2,
  MessageCircleMore,
  Plus,
  Save,
  Search,
  ShoppingBasket,
  Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";

type QuickReply = {
  id: string;
  title: string;
  text: string;
};

type ProductRow = {
  id: number;
  name: string;
  regular_price: number;
  status: string;
  stock_status: string;
  image: string | null;
  sku: string;
  unit: string;
};

type CityRule = {
  value: string;
  label: string;
  enabled: boolean;
  shipping: number;
};

type CartItem = ProductRow & {
  quantity: number;
};

function formatCop(value: number) {
  return `$${Number(value || 0).toLocaleString("es-CO")}`;
}

function productCopyText(item: ProductRow, quantity = 1) {
  return `${quantity} ${item.unit} de ${item.name} · ${formatCop(item.regular_price)} por ${item.unit}`;
}

export default function AdminWhatsappPage() {
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [cities, setCities] = useState<CityRule[]>([]);
  const [search, setSearch] = useState("");
  const [productsLoading, setProductsLoading] = useState(true);
  const [savingReplies, setSavingReplies] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [freeShippingFrom, setFreeShippingFrom] = useState(69900);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [customer, setCustomer] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    customerCity: "",
    customerEmail: ""
  });

  const activeCities = useMemo(() => cities.filter((city) => city.enabled), [cities]);
  const selectedCityRule = activeCities.find((city) => city.value === customer.customerCity) || null;
  const subtotal = cart.reduce((acc, item) => acc + item.quantity * item.regular_price, 0);
  const shipping = subtotal >= freeShippingFrom ? 0 : Number(selectedCityRule?.shipping || 0);
  const total = subtotal + shipping;

  const loadBootstrap = async () => {
    const [whatsappRes, productsRes] = await Promise.all([
      fetch("/api/admin/whatsapp", { cache: "no-store" }),
      fetch("/api/admin/products?page=1&perPage=40", { cache: "no-store" })
    ]);

    const whatsappData = await whatsappRes.json();
    const productsData = await productsRes.json();

    setQuickReplies(Array.isArray(whatsappData.quickReplies) ? whatsappData.quickReplies : []);
    setCities(Array.isArray(whatsappData.cities) ? whatsappData.cities : []);
    setFreeShippingFrom(Number(whatsappData.envioGratisDesde || 69900));
    setProducts(Array.isArray(productsData.items) ? productsData.items : []);
    setProductsLoading(false);
  };

  useEffect(() => {
    loadBootstrap().catch(() => {
      setProductsLoading(false);
      setStatus("No se pudo cargar la operación de WhatsApp.");
    });
  }, []);

  const searchProducts = async () => {
    setProductsLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", perPage: "40" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/admin/products?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      setProducts(Array.isArray(data.items) ? data.items : []);
    } finally {
      setProductsLoading(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copiado al portapapeles.");
      setTimeout(() => setStatus(""), 1800);
    } catch {
      setStatus("No se pudo copiar automáticamente.");
    }
  };

  const updateReply = (index: number, patch: Partial<QuickReply>) => {
    setQuickReplies((prev) => prev.map((reply, replyIndex) => (replyIndex === index ? { ...reply, ...patch } : reply)));
  };

  const addReply = () => {
    setQuickReplies((prev) => [...prev, { id: `reply-${Date.now()}`, title: "Nueva respuesta", text: "" }]);
  };

  const removeReply = (index: number) => {
    setQuickReplies((prev) => prev.filter((_, replyIndex) => replyIndex !== index));
  };

  const saveReplies = async () => {
    setSavingReplies(true);
    try {
      const res = await fetch("/api/admin/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quickReplies })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron guardar");
      setQuickReplies(data.quickReplies || []);
      setStatus("Respuestas rápidas guardadas.");
      setTimeout(() => setStatus(""), 2000);
    } catch (error: any) {
      setStatus(error?.message || "No se pudieron guardar las respuestas.");
    } finally {
      setSavingReplies(false);
    }
  };

  const addToCart = (product: ProductRow) => {
    setCart((prev) => {
      const current = prev.find((item) => item.id === product.id);
      if (current) {
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === productId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const createManualOrder = async () => {
    if (!customer.customerName || !customer.customerPhone || !customer.customerAddress || !customer.customerCity || cart.length === 0) {
      setStatus("Faltan datos del cliente o productos en la canasta.");
      return;
    }

    setSubmittingOrder(true);
    try {
      const res = await fetch("/api/admin/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...customer,
          items: cart.map((item) => ({
            product_id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            price: item.regular_price,
            image: item.image
          }))
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear el pedido manual");

      setStatus(`Pedido manual #${data.order.id} creado. Total ${formatCop(data.order.total)}.`);
      setCart([]);
      setShowCheckoutModal(false);
      setCustomer({
        customerName: "",
        customerPhone: "",
        customerAddress: "",
        customerCity: "",
        customerEmail: ""
      });
    } catch (error: any) {
      setStatus(error?.message || "No se pudo crear el pedido manual.");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const openCheckoutModal = () => {
    if (cart.length === 0) {
      setStatus("Primero agrega productos a la canasta.");
      return;
    }
    setShowCheckoutModal(true);
  };

  return (
    <div className="flex-1 h-screen overflow-hidden bg-slate-50/50 flex flex-col font-sans animate-in fade-in duration-500">
      <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-emerald-600 rounded-lg text-white">
            <MessageCircleMore size={18} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Atención WhatsApp</h1>
            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic">Respuestas rápidas + pedido manual</p>
          </div>
        </div>
        {status && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] font-black text-emerald-700">
            {status}
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden p-6 md:p-8 max-w-7xl mx-auto w-full">
        <div className="grid h-full min-h-0 grid-cols-1 gap-6 xl:grid-cols-[0.92fr_1.55fr]">
          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Respuestas rápidas</p>
                <p className="mt-1 text-sm font-bold text-slate-700">Para copiar y pegar en la ventana externa de WhatsApp.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={addReply} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700">
                  <Plus size={14} /> Agregar
                </button>
                <button onClick={saveReplies} disabled={savingReplies} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white disabled:opacity-60">
                  {savingReplies ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {quickReplies.map((reply, index) => (
                <div key={reply.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <input
                    value={reply.title}
                    onChange={(e) => updateReply(index, { title: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none"
                  />
                  <textarea
                    rows={4}
                    value={reply.text}
                    onChange={(e) => updateReply(index, { text: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={() => copyText(reply.text)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700"
                    >
                      <Clipboard size={14} /> Copiar
                    </button>
                    <button
                      onClick={() => removeReply(index)}
                      className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-rose-700"
                    >
                      <Trash2 size={14} /> Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="min-h-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm flex flex-col">
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Catálogo + canasta manual</p>
                  <p className="mt-1 text-sm font-bold text-slate-700">Cada producto te deja copiar texto o sumarlo a la canasta para crear el pedido a mano.</p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") searchProducts();
                    }}
                    placeholder="Buscar producto..."
                    className="w-60 rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-4 text-sm font-bold text-slate-800 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-6 space-y-3">
                {productsLoading ? (
                  <div className="flex min-h-[30vh] flex-col items-center justify-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cargando productos...</p>
                  </div>
                ) : (
                  products.map((product) => (
                    <div key={product.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-center gap-4">
                        {product.image ? (
                          <img src={product.image} alt={product.name} className="h-16 w-16 rounded-2xl border border-slate-200 object-cover bg-white" />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-300">
                            <ShoppingBasket size={18} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-black text-slate-900">{product.name}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">{formatCop(product.regular_price)} · {product.unit}</div>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <button
                          onClick={() => copyText(productCopyText(product))}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-700"
                        >
                          <Clipboard size={14} /> Copiar
                        </button>
                        <button
                          onClick={() => addToCart(product)}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-white"
                        >
                          <Plus size={14} /> Agregar
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="min-h-0 overflow-y-auto p-6">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Canasta manual</p>
                    <p className="text-sm font-black text-slate-900">{cart.length} item(s)</p>
                  </div>
                  <div className="mt-4 space-y-3">
                    {cart.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-semibold text-slate-400">
                        Todavía no has agregado productos.
                      </div>
                    ) : (
                      cart.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                              <div className="mt-1 text-xs font-semibold text-slate-500">{formatCop(item.regular_price)} · {item.unit}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => updateQuantity(item.id, -1)} className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-700">-</button>
                              <div className="min-w-10 text-center text-sm font-black text-slate-900">{item.quantity}</div>
                              <button onClick={() => updateQuantity(item.id, 1)} className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-700">+</button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-5 space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-700"><span>Subtotal</span><strong>{formatCop(subtotal)}</strong></div>
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-700"><span>Domicilio</span><strong>{shipping === 0 ? "Gratis" : formatCop(shipping)}</strong></div>
                    <div className="flex items-center justify-between border-t border-emerald-200 pt-2 text-base font-black text-slate-900"><span>Total</span><strong>{formatCop(total)}</strong></div>
                  </div>

                  <button
                    onClick={openCheckoutModal}
                    disabled={submittingOrder || cart.length === 0}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black uppercase tracking-widest text-white disabled:opacity-60"
                  >
                    {submittingOrder ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {submittingOrder ? "Creando..." : "Finalizar pedido"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {showCheckoutModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Finalizar pedido manual</p>
                <h3 className="mt-1 text-lg font-black text-slate-900">Datos del cliente</h3>
              </div>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-700"
              >
                Cerrar
              </button>
            </div>

            <div className="max-h-[calc(90vh-76px)] overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-3">
                <input value={customer.customerName} onChange={(e) => setCustomer({ ...customer, customerName: e.target.value })} placeholder="Nombre del cliente" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none" />
                <input value={customer.customerPhone} onChange={(e) => setCustomer({ ...customer, customerPhone: e.target.value })} placeholder="Teléfono" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none" />
                <input value={customer.customerAddress} onChange={(e) => setCustomer({ ...customer, customerAddress: e.target.value })} placeholder="Dirección" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none" />
                <select value={customer.customerCity} onChange={(e) => setCustomer({ ...customer, customerCity: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none">
                  <option value="">Seleccione ciudad</option>
                  {activeCities.map((city) => (
                    <option key={city.value} value={city.value}>{city.label}</option>
                  ))}
                </select>
                <input value={customer.customerEmail} onChange={(e) => setCustomer({ ...customer, customerEmail: e.target.value })} placeholder="Correo (opcional)" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none" />
              </div>

              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm font-semibold text-slate-700"><span>Subtotal</span><strong>{formatCop(subtotal)}</strong></div>
                <div className="flex items-center justify-between text-sm font-semibold text-slate-700"><span>Domicilio</span><strong>{shipping === 0 ? "Gratis" : formatCop(shipping)}</strong></div>
                <div className="flex items-center justify-between border-t border-emerald-200 pt-2 text-base font-black text-slate-900"><span>Total</span><strong>{formatCop(total)}</strong></div>
              </div>

              <button
                onClick={createManualOrder}
                disabled={submittingOrder}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black uppercase tracking-widest text-white disabled:opacity-60"
              >
                {submittingOrder ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {submittingOrder ? "Creando..." : "Crear pedido manual"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
