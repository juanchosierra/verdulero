"use client";

import { useState, useEffect } from "react";
import {
    Save,
    Loader2,
    Globe,
    Key,
    Database,
    History,
    CheckCircle2,
    AlertCircle,
    Clock,
    Settings,
    ShieldCheck,
    Bot,
    Check,
    X,
    RefreshCw,
    DatabaseZap,
    Shield
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { DEFAULT_CITY_RULES, type CityRule } from "@/lib/store-rules";

export default function SettingsPage() {
    const [config, setConfig] = useState<any>({
        nombreTienda: "El Verdulero",
        siteUrl: "https://elverdulero.com.co",
        logoUrl: "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png",
        supportWhatsapp: "573176778089",
        wcUrl: "",
        wcConsumerKey: "",
        wcConsumerSecret: "",
        geminiApiKey: "",
        personalidad: "",
        perfilConversacional: "asistente_familiar",
        mensajeBienvenida: "¡Qué tal! Bienvenido a El Verdulero.",
        horaCorte: "14:00",
        deliveryWindow: "10:00 AM a 5:00 PM",
        emailAdmin: "ventas@elverdulero.com.co",
        emailsCopia: "",
        pedidoMinimo: 0,
        envioGratisDesde: 69900,
        ciudadesOperacion: DEFAULT_CITY_RULES,
        intervencionManual: false
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
    const [wooChecking, setWooChecking] = useState(false);
    const [wooStatus, setWooStatus] = useState<any>(null);

    const liveWooHelp = wooStatus?.ok
        ? `Store API: ${wooStatus.storeApi?.productsRead ?? 0} producto(s) · REST: ${wooStatus.restApi?.ok ? "OK" : wooStatus.restApi?.configured === false ? "sin llaves" : "falló"}`
        : wooStatus?.error || (config.wcUrl ? `Tienda: ${config.wcUrl}` : "Falta URL o credenciales de WooCommerce");

    const statusItems = [
        {
            label: "WooCommerce en vivo",
            ok: Boolean(wooStatus?.ok || (config.wcUrl && config.wcConsumerKey && config.wcConsumerSecret)),
            help: liveWooHelp
        },
        {
            label: "Prompt del bot configurado",
            ok: Boolean(config.personalidad?.trim()),
            help: config.personalidad?.trim() ? "El sistema tiene instrucciones activas para el bot." : "Falta el prompt maestro del bot"
        },
        {
            label: "Saludo inicial listo",
            ok: Boolean(config.mensajeBienvenida?.trim()),
            help: config.mensajeBienvenida?.trim() ? config.mensajeBienvenida : "Falta mensaje de saludo"
        },
        {
            label: "Soporte WhatsApp",
            ok: Boolean(config.supportWhatsapp?.trim()),
            help: config.supportWhatsapp?.trim() || "Falta el WhatsApp de soporte"
        },
        {
            label: "Horario operativo definido",
            ok: Boolean(config.horaCorte),
            help: config.horaCorte ? `Hora de corte: ${config.horaCorte}` : "Falta hora de corte"
        },
        {
            label: "Ciudades activas",
            ok: Array.isArray(config.ciudadesOperacion) && config.ciudadesOperacion.some((city: CityRule) => city.enabled),
            help: Array.isArray(config.ciudadesOperacion)
                ? `${config.ciudadesOperacion.filter((city: CityRule) => city.enabled).length} ciudad(es) habilitada(s)`
                : "Falta configurar ciudades de operación"
        },
        {
            label: "Correo administrativo",
            ok: Boolean(config.emailAdmin?.trim()),
            help: config.emailAdmin?.trim() || "Falta correo principal para notificaciones"
        }
    ];

    useEffect(() => {
        fetch("/api/admin/config")
            .then(res => res.json())
            .then(data => {
                if (data && !data.error) {
                    setConfig((prev: any) => ({ ...prev, ...data }));
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const runWooCheck = async () => {
        setWooChecking(true);
        try {
            const res = await fetch("/api/admin/woo-status", { cache: "no-store" });
            const data = await res.json();
            setWooStatus(data);
        } catch {
            setWooStatus({
                ok: false,
                checkedAt: new Date().toISOString(),
                error: "No se pudo comprobar la conexión en vivo."
            });
        } finally {
            setWooChecking(false);
        }
    };

    useEffect(() => {
        if (!loading && config.wcUrl) {
            runWooCheck();
        }
    }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setStatus("idle");

        try {
            const res = await fetch("/api/admin/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });

            if (res.ok) {
                setStatus("success");
                runWooCheck();
            } else {
                setStatus("error");
            }
        } catch (error) {
            setStatus("error");
        } finally {
            setSaving(false);
            setTimeout(() => setStatus("idle"), 3000);
        }
    };

    const updateCityRule = (index: number, patch: Partial<CityRule>) => {
        setConfig((prev: any) => ({
            ...prev,
            ciudadesOperacion: (prev.ciudadesOperacion || []).map((city: CityRule, cityIndex: number) =>
                cityIndex === index ? { ...city, ...patch } : city
            )
        }));
    };

    const addCityRule = () => {
        setConfig((prev: any) => ({
            ...prev,
            ciudadesOperacion: [
                ...(prev.ciudadesOperacion || []),
                { value: "", label: "", enabled: true, shipping: 10000 }
            ]
        }));
    };

    const removeCityRule = (index: number) => {
        setConfig((prev: any) => ({
            ...prev,
            ciudadesOperacion: (prev.ciudadesOperacion || []).filter((_: CityRule, cityIndex: number) => cityIndex !== index)
        }));
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sincronizando con base de datos...</p>
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-screen bg-[#F8FAFC]/50 flex flex-col font-sans mb-20 animate-in fade-in duration-500">

            {/* 🔴 Header de Ajustes */}
            <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-slate-900 rounded-lg text-white">
                        <Settings size={18} />
                    </div>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-black text-slate-900 uppercase tracking-widest leading-none">Configuración del Sistema</h1>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter italic flex items-center gap-1.5">
                            <Database size={10} /> Base de Datos Conectada
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <AnimatePresence>
                        {status === "success" && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-lg"
                            >
                                <CheckCircle2 size={16} className="text-emerald-600" />
                                <span className="text-[11px] font-black text-emerald-700 uppercase">Cambios guardados</span>
                            </motion.div>
                        )}
                        {status === "error" && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex items-center gap-2 px-4 py-2 bg-rose-50 border border-rose-100 rounded-lg"
                            >
                                <AlertCircle size={16} className="text-rose-600" />
                                <span className="text-[11px] font-black text-rose-700 uppercase">Error al procesar</span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="h-10 px-8 bg-emerald-600 text-white text-[11px] font-black uppercase tracking-widest rounded-lg shadow-lg shadow-emerald-200 hover:bg-emerald-700 hover:scale-[1.02] active:scale-95 transition-all flex items-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {saving ? "Guardando..." : "Guardar en Servidor"}
                    </button>
                </div>
            </header>

            <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
                <div className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 px-6 py-5">
                    <p className="text-sm font-black text-amber-900 uppercase tracking-wider">Panel útil, no decorativo</p>
                    <p className="mt-2 text-sm font-semibold text-amber-800 leading-relaxed">
                        Aquí dejamos solo controles que sí afectan el sistema. Si algo aparece como configurado, es porque realmente lo estamos leyendo o guardando.
                    </p>
                </div>

                <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    <SectionCard title="Sincronización WooCommerce" icon={<Globe className="text-blue-500" />} color="blue">
                        <div className="space-y-5">
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                                <div>
                                    <Label>Nombre del negocio</Label>
                                    <Input
                                        value={config.nombreTienda || ""}
                                        placeholder="El Verdulero"
                                        onChange={(v: string) => setConfig({ ...config, nombreTienda: v })}
                                    />
                                </div>
                                <div>
                                    <Label>WhatsApp de soporte</Label>
                                    <Input
                                        value={config.supportWhatsapp || ""}
                                        placeholder="573176778089"
                                        onChange={(v: string) => setConfig({ ...config, supportWhatsapp: v.replace(/[^\d+]/g, "") })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                                <div>
                                    <Label>URL pública de la tienda</Label>
                                    <Input
                                        value={config.siteUrl || ""}
                                        placeholder="https://elverdulero.com.co"
                                        onChange={(v: string) => setConfig({ ...config, siteUrl: v })}
                                    />
                                </div>
                                <div>
                                    <Label>URL del logo</Label>
                                    <Input
                                        value={config.logoUrl || ""}
                                        placeholder="https://..."
                                        onChange={(v: string) => setConfig({ ...config, logoUrl: v })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>Endpoint de tu Tienda</Label>
                                <Input
                                    value={config.wcUrl}
                                    placeholder="https://elverdulero.com.co"
                                    onChange={(v: string) => setConfig({ ...config, wcUrl: v })}
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-5">
                                <div>
                                    <Label>Consumer Key (CK)</Label>
                                    <Input
                                        type="password"
                                        value={config.wcConsumerKey}
                                        onChange={(v: string) => setConfig({ ...config, wcConsumerKey: v })}
                                    />
                                </div>
                                <div>
                                    <Label>Consumer Secret (CS)</Label>
                                    <Input
                                        type="password"
                                        value={config.wcConsumerSecret}
                                        onChange={(v: string) => setConfig({ ...config, wcConsumerSecret: v })}
                                    />
                                </div>
                            </div>
                            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-widest text-blue-900">Verificación Woo en vivo</p>
                                        <p className="mt-1 text-xs font-semibold text-blue-800">
                                            Los punticos solo enmascaran la clave. Esta prueba sí consulta la tienda real y te confirma si estamos leyendo la web en vivo.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={runWooCheck}
                                        disabled={wooChecking}
                                        className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-blue-700 disabled:opacity-60"
                                    >
                                        {wooChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        {wooChecking ? "Probando..." : "Verificar Woo en vivo"}
                                    </button>
                                </div>

                                {wooStatus && (
                                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <DatabaseZap size={16} className="text-emerald-600" />
                                                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Store API pública</p>
                                                </div>
                                                <span className={cn(
                                                    "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest",
                                                    wooStatus.storeApi?.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                                                )}>
                                                    {wooStatus.storeApi?.ok ? "Conectada" : "Falló"}
                                                </span>
                                            </div>
                                            <div className="mt-3 space-y-1 text-xs font-semibold text-slate-600">
                                                <p>URL: {wooStatus.wcUrl || config.wcUrl || "No definida"}</p>
                                                <p>Productos leídos: {wooStatus.storeApi?.productsRead ?? 0}</p>
                                                <p>Latencia: {wooStatus.storeApi?.latencyMs ?? "-"} ms</p>
                                            </div>
                                            {wooStatus.storeApi?.sample?.length > 0 && (
                                                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Muestra real</p>
                                                    <ul className="mt-2 space-y-1 text-xs font-semibold text-slate-700">
                                                        {wooStatus.storeApi.sample.map((product: any) => (
                                                            <li key={`store-${product.id}`}>{product.name} · ${Number(product.price || 0).toLocaleString("es-CO")} · {product.unit}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <Shield size={16} className="text-purple-600" />
                                                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-900">Woo REST API autenticada</p>
                                                </div>
                                                <span className={cn(
                                                    "rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest",
                                                    wooStatus.restApi?.ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                                )}>
                                                    {wooStatus.restApi?.ok ? "Conectada" : wooStatus.restApi?.configured === false ? "Falta revisar" : "Falló"}
                                                </span>
                                            </div>
                                            <div className="mt-3 space-y-1 text-xs font-semibold text-slate-600">
                                                <p>Estado: {wooStatus.restApi?.message || (wooStatus.restApi?.ok ? "Leyendo Woo con CK/CS guardadas en el servidor." : wooStatus.error || "Sin verificar")}</p>
                                                {wooStatus.restApi?.ok && <p>Productos leídos: {wooStatus.restApi?.productsRead ?? 0}</p>}
                                                {wooStatus.restApi?.ok && <p>Latencia: {wooStatus.restApi?.latencyMs ?? "-"} ms</p>}
                                                {wooStatus.checkedAt && <p>Última verificación: {new Date(wooStatus.checkedAt).toLocaleString("es-CO")}</p>}
                                            </div>
                                            {wooStatus.restApi?.sample?.length > 0 && (
                                                <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Muestra real</p>
                                                    <ul className="mt-2 space-y-1 text-xs font-semibold text-slate-700">
                                                        {wooStatus.restApi.sample.map((product: any) => (
                                                            <li key={`rest-${product.id}`}>{product.name} · ${Number(product.price || 0).toLocaleString("es-CO")}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard title="Proveedor IA / credenciales" icon={<Key className="text-purple-500" />} color="purple">
                        <div className="space-y-4">
                            <div>
                                <Label>API Key de respaldo</Label>
                                <Input
                                    type="password"
                                    value={config.geminiApiKey}
                                    onChange={(v: string) => setConfig({ ...config, geminiApiKey: v })}
                                />
                            </div>
                            <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                                <p className="text-[11px] font-bold text-purple-700 leading-relaxed">
                                    El despliegue productivo usa variables seguras del servidor. Este campo sirve como respaldo interno para no perder la referencia, pero no reemplaza las variables protegidas del hosting.
                                </p>
                            </div>
                        </div>
                    </SectionCard>

                    <div className="md:col-span-2">
                        <SectionCard title="Instrucciones del Sistema (🧠 El Cerebro)" icon={<Bot className="text-emerald-500" />} color="emerald">
                            <div className="space-y-6">
                                <div>
                                    <Label>Perfil de Personalidad</Label>
                                    <select
                                        value={config.perfilConversacional || "asistente_familiar"}
                                        onChange={e => setConfig({ ...config, perfilConversacional: e.target.value })}
                                        className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/10 transition-all shadow-sm"
                                    >
                                        <option value="chef_gourmet">Chef Gourmet (inspirador)</option>
                                        <option value="ahorrador_inteligente">Ahorrador Inteligente (analítico)</option>
                                        <option value="asistente_familiar">Asistente Familiar (predictivo)</option>
                                        <option value="eficiente_express">Eficiente Express (rápido)</option>
                                    </select>
                                </div>
                                <div>
                                    <Label>Prompt Maestro (Definición del Personaje)</Label>
                                    <textarea
                                        rows={8}
                                        value={config.personalidad}
                                        onChange={e => setConfig({ ...config, personalidad: e.target.value })}
                                        placeholder="Instrucciones sobre cómo debe responder el robot..."
                                        className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-[13px] font-mono text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white focus:border-emerald-200 transition-all shadow-sm"
                                    />
                                </div>
                                <div>
                                    <Label>Mensaje de Saludo Predeterminado</Label>
                                    <Input
                                        value={config.mensajeBienvenida}
                                        onChange={(v: string) => setConfig({ ...config, mensajeBienvenida: v })}
                                    />
                                </div>
                            </div>
                        </SectionCard>
                    </div>

                    <SectionCard title="Reglas Operativas" icon={<Clock className="text-orange-500" />} color="orange">
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Hora de Corte</Label>
                                    <input
                                        type="time"
                                        value={config.horaCorte || "14:00"}
                                        onChange={e => setConfig({ ...config, horaCorte: e.target.value })}
                                        className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:bg-white transition-all shadow-sm"
                                    />
                                    <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-400">
                                        Esta hora define hasta cuándo se reciben pedidos para la entrega del día siguiente. Después del corte, el sistema mueve la entrega para pasado mañana y lo advierte en el chat.
                                    </p>
                                </div>
                                <div>
                                    <Label>Franja de entrega visible</Label>
                                    <Input
                                        value={config.deliveryWindow || "10:00 AM a 5:00 PM"}
                                        onChange={(v: string) => setConfig({ ...config, deliveryWindow: v })}
                                    />
                                    <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-400">
                                        Esta franja sale en el chat, en el correo y en los pedidos impresos.
                                    </p>
                                </div>
                                <div>
                                    <Label>Email Notificaciones</Label>
                                    <Input
                                        type="email"
                                        value={config.emailAdmin}
                                        onChange={(v: string) => setConfig({ ...config, emailAdmin: v })}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>Pedido mínimo</Label>
                                <Input
                                    type="number"
                                    value={config.pedidoMinimo ?? 0}
                                    onChange={(v: string) => setConfig({ ...config, pedidoMinimo: Number(v || 0) })}
                                />
                                <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-400">
                                    Si el mercado no llega a este valor, el cliente verá cuánto le falta antes de poder cerrar.
                                </p>
                            </div>
                            <div>
                                <Label>Envío gratis desde</Label>
                                <Input
                                    type="number"
                                    value={config.envioGratisDesde ?? 69900}
                                    onChange={(v: string) => setConfig({ ...config, envioGratisDesde: Number(v || 0) })}
                                />
                                <p className="mt-2 text-[11px] font-semibold leading-relaxed text-slate-400">
                                    Hoy el sistema estaba cobrando domicilio manualmente con envío gratis desde $69.900. Ya puedes cambiar ese umbral aquí.
                                </p>
                            </div>
                            <div>
                                <Label>Emails Copia (separados por coma)</Label>
                                <Input
                                    value={config.emailsCopia || ""}
                                    placeholder="logistica@dominio.com, supervisor@dominio.com"
                                    onChange={(v: string) => setConfig({ ...config, emailsCopia: v })}
                                />
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label>Ciudades operativas y domicilio</Label>
                                        <p className="text-[11px] font-semibold leading-relaxed text-slate-400">
                                            Aquí decides en qué ciudades operamos y cuánto vale el domicilio en cada una.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={addCityRule}
                                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-emerald-700"
                                    >
                                        Agregar ciudad
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {(config.ciudadesOperacion || []).map((city: CityRule, index: number) => (
                                        <div key={`${city.value || "new"}-${index}`} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-[1.2fr_1.2fr_0.8fr_auto_auto] md:items-end">
                                            <div>
                                                <Label>Clave interna</Label>
                                                <Input
                                                    value={city.value}
                                                    placeholder="bucaramanga"
                                                    onChange={(v: string) => updateCityRule(index, { value: v.toLowerCase().trim().replace(/\s+/g, " ") })}
                                                />
                                            </div>
                                            <div>
                                                <Label>Nombre visible</Label>
                                                <Input
                                                    value={city.label}
                                                    placeholder="Bucaramanga"
                                                    onChange={(v: string) => updateCityRule(index, { label: v })}
                                                />
                                            </div>
                                            <div>
                                                <Label>Domicilio</Label>
                                                <Input
                                                    type="number"
                                                    value={city.shipping}
                                                    onChange={(v: string) => updateCityRule(index, { shipping: Number(v || 0) })}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => updateCityRule(index, { enabled: !city.enabled })}
                                                className={cn(
                                                    "h-12 rounded-xl border px-4 text-[11px] font-black uppercase tracking-widest",
                                                    city.enabled
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                        : "border-slate-200 bg-white text-slate-500"
                                                )}
                                            >
                                                {city.enabled ? "Activa" : "Inactiva"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeCityRule(index)}
                                                className="h-12 rounded-xl border border-rose-200 bg-rose-50 px-4 text-[11px] font-black uppercase tracking-widest text-rose-700"
                                            >
                                                Quitar
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="p-4 bg-orange-50/50 rounded-2xl border border-orange-100 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-colors", config.intervencionManual ? "bg-orange-500 text-white" : "bg-slate-200 text-slate-400")}>
                                        <History size={20} />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-800 uppercase tracking-tighter">Intervención Manual</p>
                                        <p className="text-[10px] font-bold text-slate-400">Pausa al robot para chat humano</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setConfig({ ...config, intervencionManual: !config.intervencionManual })}
                                    className={cn(
                                        "w-12 h-6 rounded-full relative transition-colors duration-300 ring-2 ring-white shadow-inner",
                                        config.intervencionManual ? "bg-orange-500" : "bg-slate-300"
                                    )}
                                >
                                    <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300", config.intervencionManual ? "left-7" : "left-1")} />
                                </button>
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard title="Estado real del sistema" icon={<ShieldCheck className="text-slate-500" />} color="slate">
                        <div className="space-y-6">
                            <div className="space-y-3">
                                {statusItems.map((item) => (
                                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest">{item.label}</p>
                                                <p className="mt-1 text-xs font-semibold text-slate-500">{item.help}</p>
                                            </div>
                                            <div className={cn(
                                                "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest",
                                                item.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                                            )}>
                                                {item.ok ? <Check size={12} /> : <X size={12} />}
                                                {item.ok ? "OK" : "FALTA"}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </SectionCard>

                </form>

                <div className="mt-12 flex justify-center pb-20">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full max-w-md h-14 bg-slate-900 text-white text-[13px] font-black uppercase tracking-[0.2em] rounded-2xl shadow-2xl shadow-slate-300 hover:scale-[1.03] active:scale-95 transition-all flex items-center justify-center gap-3 group disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={24} className="animate-spin text-emerald-400" /> : <Save size={20} className="text-emerald-400" />}
                        {saving ? "Procesando cambios..." : "Guardar en Base de Datos"}
                    </button>
                </div>
            </div>
        </div>
    );
}

function SectionCard({ title, icon, children, color }: any) {
    return (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col h-full group transition-all duration-300 hover:shadow-premium hover:border-slate-300/50">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50/30">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm border border-slate-100">
                    {icon}
                </div>
                <h3 className="text-[11px] font-black text-slate-700 uppercase tracking-widest">{title}</h3>
            </div>
            <div className="p-6">
                {children}
            </div>
        </div>
    );
}

function Label({ children }: any) {
    return <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1.5 italic">{children}</label>;
}

function Input({ ...props }: any) {
    return (
        <input
            {...props}
            onChange={e => props.onChange(e.target.value)}
            className="mt-2 block w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10 focus:bg-white focus:border-emerald-200 transition-all shadow-sm"
        />
    );
}
