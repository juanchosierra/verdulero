"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { Send, Loader2, Sparkles, ShoppingBasket, CheckCircle2, User, Bot, Plus, Minus, Search, X, ShieldAlert } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { buildDeliverySchedule, DEFAULT_CUTOFF } from "@/lib/delivery";
import { DEFAULT_CITY_RULES, normalizeCityValue, type CityRule } from "@/lib/store-rules";

type Message = {
    role: "user" | "assistant";
    content: string;
    type?: "text" | "order" | "info";
    hidden?: boolean;
};

type CartItem = {
    product_id: number;
    name: string;
    quantity: number;
    unit: string;
    price: number;
    image?: string;
};

type Product = {
    id: number;
    name: string;
    price: number;
    stock_status: string;
    image?: string | null;
    unit: string;
};

const FEATURED_PRODUCT_SEARCH = "colemon";
const ERROR_REPORTING_UI_ENABLED = false;

type PreChatForm = {
    correo: string;
    nombre: string;
    ciudad: string;
};

type CheckoutForm = {
    telefono: string;
    ciudad: string;
    direccion: string;
};

type PendingErrorReport = {
    key: string;
    index: number;
    message: Message;
};

type CustomerLookup = {
    found: boolean;
    customer?: {
        firstName?: string | null;
    };
};

type TrackedOrder = {
    id: number;
    createdAt: string;
    customerName: string;
    customerCity: string;
    customerAddress: string;
    status: string;
    total: number;
    items: Array<{
        name: string;
        quantity: number;
        unit: string;
        price: number;
        image?: string | null;
    }>;
};

type StoredChatSession = {
    sessionId: string;
    messages: Message[];
    preChatReady: boolean;
    preChatForm: PreChatForm;
    checkoutForm: CheckoutForm;
    savedAt: number;
};

type PublicStoreConfig = {
    nombreTienda?: string;
    siteUrl?: string;
    logoUrl?: string;
    supportWhatsapp?: string;
    horaCorte: string;
    deliveryWindow?: string;
    mensajeBienvenida?: string;
    pedidoMinimo?: number;
    envioGratisDesde?: number;
    ciudades?: CityRule[];
    cobertura?: string;
};

const UNIT_LABELS: Record<string, string> = {
    lb: "Lb",
    und: "Und",
    carton: "Cartón",
    bidon: "Bidón",
    canastilla: "Canastilla",
    lts: "Lts",
    bja: "Bja",
    atado: "Atado"
};

function formatMoney(value: number) {
    return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0
    }).format(value);
}

function shortUnitLabel(unit: string) {
    return UNIT_LABELS[unit] || unit;
}

function isPackagedVolumeUnitProduct(productName: string | null | undefined) {
    const normalized = String(productName || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    if (!/\b(zumo|jugo)\b/.test(normalized)) return false;
    return /\b(?:x\s*)?(?:4|cuatro)\s*(?:l|lt|lts|litro|litros)\b/.test(normalized);
}

function productUnitLabel(unit: string, productName?: string | null) {
    if (isPackagedVolumeUnitProduct(productName)) return "Botella 4 L";
    return shortUnitLabel(unit);
}

function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeUiText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function isClickableAssistantOption(content: string, line: string) {
    if (!line.startsWith("- ")) return false;
    const normalized = normalizeUiText(content);

    return (
        /opciones reales|estas opciones|cual le doy|cual le anoto|le sirve alguna|necesito que me diga cual/.test(normalized) &&
        !/tirilla de compra|resumen final|total a pagar|fecha de entrega/.test(normalized)
    );
}

function optionReplyFromLine(line: string) {
    return line
        .replace(/^-\s*/, "")
        .replace(/\s+-\s+\$[\d.,]+.*$/i, "")
        .replace(/\s+\(\s*(kg|kilo|kilos|lb|libra|libras|und|unidad|unidades|atado|bandeja|lts?|litros?)\s*\)\s*$/i, "")
        .trim();
}

function renderAssistantMessage(content: string, onOptionClick?: (option: string) => void, optionsDisabled = false) {
    const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const normalized = content.replace(/\s+/g, " ").trim();

    if (/le tengo registrada su ultima compra|le tengo registrada su última compra/i.test(normalized)) {
        const historyMatch = normalized.match(/(.*?)(Le tengo registrada su última compra:\s*.*?)(Si quiere repetirla, diga "repetir pedido"\.?)(.*)$/i);
        if (historyMatch) {
            const intro = historyMatch[1]?.trim();
            const history = historyMatch[2]?.replace(/^Le tengo registrada su última compra:\s*/i, "").trim();
            const hint = historyMatch[3]?.trim();
            const question = historyMatch[4]?.trim();

            return (
                <div className="space-y-2">
                    {intro && <p className="leading-relaxed text-slate-800">{intro}</p>}
                    {history && <p className="text-sm font-semibold leading-relaxed text-slate-900">Última compra: {history}</p>}
                    {hint && <p className="text-sm leading-relaxed text-slate-600">{hint}</p>}
                    {question && <p className="text-[15px] font-semibold leading-relaxed text-emerald-800">{question}</p>}
                </div>
            );
        }
    }

    const isStructured = lines.some((line) =>
        line.startsWith("- ") ||
        /tirilla de compra|resumen final|total a pagar|^total:|^fecha de entrega/i.test(line)
    );

    if (!isStructured) {
        const chunks = normalized
            .split(/(?<=[.?!])\s+(?=[A-ZÁÉÍÓÚ¿¡])/)
            .map((chunk) => chunk.trim())
            .filter(Boolean);

        if (chunks.length >= 2) {
            return (
                <div className="space-y-2">
                    {chunks.map((chunk, idx) => {
                        const isQuestion = /[?¿]/.test(chunk);
                        return (
                            <p
                                key={idx}
                                className={cn(
                                    "whitespace-pre-line leading-relaxed",
                                    isQuestion ? "font-semibold text-emerald-800" : "text-[15px] text-slate-800"
                                )}
                            >
                                {chunk}
                            </p>
                        );
                    })}
                </div>
            );
        }

        return <p className="whitespace-pre-line leading-relaxed">{content}</p>;
    }

    return (
        <div className="space-y-2">
            {lines.map((line, idx) => {
                if (/tirilla de compra|resumen final/i.test(line)) {
                    return (
                        <div key={idx} className="pb-1 text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">
                            {line}
                        </div>
                    );
                }

                if (line.startsWith("- ")) {
                    if (onOptionClick && isClickableAssistantOption(content, line)) {
                        const optionReply = optionReplyFromLine(line);

                        return (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => onOptionClick(optionReply)}
                                disabled={optionsDisabled}
                                className="flex w-full items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-left text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                <span className="leading-relaxed">{line.slice(2)}</span>
                            </button>
                        );
                    }

                    return (
                        <div key={idx} className="flex items-start gap-2 pl-0.5">
                            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                            <span className="leading-relaxed text-slate-800">{line.slice(2)}</span>
                        </div>
                    );
                }

                if (/^subtotal mercado:|^envio:|^envío:/i.test(line)) {
                    return (
                        <div key={idx} className="border-t border-slate-100 pt-2 text-slate-700">
                            {line}
                        </div>
                    );
                }

                if (/total a pagar|^total:/i.test(line)) {
                    return (
                        <div key={idx} className="border-t-2 border-emerald-200 pt-3 text-emerald-900 text-base font-black">
                            {line}
                        </div>
                    );
                }

                if (/^fecha de entrega/i.test(line)) {
                    return (
                        <div key={idx} className="text-sm font-semibold text-sky-800">
                            {line}
                        </div>
                    );
                }

                if (/^si est[aá] todo bien|^si necesita cualquier cosa/i.test(line)) {
                    return (
                        <div key={idx} className="text-sm font-semibold text-amber-800">
                            {line}
                        </div>
                    );
                }

                return (
                    <p key={idx} className="whitespace-pre-line leading-relaxed">
                        {line}
                    </p>
                );
            })}
        </div>
    );
}

function shouldShowCheckoutDecisionButtons(content: string) {
    const normalized = normalizeUiText(content);

    return (
        normalized.includes('si esta todo bien, confirmeme con "si" o "no"') ||
        normalized.includes('si esta todo bien, confirmame con "si" o "no"') ||
        normalized.includes('me confirma por favor con "si" o "no" para enviar su pedido') ||
        normalized.includes('me confirmas por favor con "si" o "no" para enviar tu pedido') ||
        (normalized.includes("confirm") && normalized.includes('"si" o "no"'))
    );
}

function shouldShowFinalizeOrderButton(content: string) {
    const normalized = normalizeUiText(content);

    const asksForMore =
        /que mas (necesita|necesitas|te anoto|le anoto|te pongo|le pongo|te ponemos|le ponemos|hace falta|te hace falta|le hace falta)/.test(normalized) ||
        /quiere algo mas|quieres algo mas|algo mas para la canasta/.test(normalized);

    const isFinalConfirmation =
        /tirilla de compra|resumen final|total a pagar|fecha de entrega|confirmar pedido|confirma por favor|confirmeme|confirmame|pedido confirmado|numero de orden/.test(normalized);

    const isProductChoice =
        /opciones reales|estas opciones|cual le doy|cual te doy|cual le anoto|cual te anoto|le sirve alguna|necesito que me diga cual/.test(normalized);

    return asksForMore && !isFinalConfirmation && !isProductChoice;
}

const DEFAULT_WELCOME_MESSAGE = "¡Qué tal, veci! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué te vamos a poner en la canasta hoy?";
const SESSION_STORAGE_KEY = "verdulero-chat-session-v1";
const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([
        { role: "assistant", content: DEFAULT_WELCOME_MESSAGE, type: "text" }
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [cartItems, setCartItems] = useState<CartItem[]>([]);
    const [cartTotal, setCartTotal] = useState(0);
    const [cartLoading, setCartLoading] = useState(false);
    const [updatingProduct, setUpdatingProduct] = useState<number | null>(null);
    const [products, setProducts] = useState<Product[]>([]);
    const [featuredProduct, setFeaturedProduct] = useState<Product | null>(null);
    const [productsLoading, setProductsLoading] = useState(false);
    const [productSearch, setProductSearch] = useState("");
    const [catalogOpen, setCatalogOpen] = useState(false);
    const [mobileCartOpen, setMobileCartOpen] = useState(false);
    const [addingProduct, setAddingProduct] = useState<number | null>(null);
    const [catalogQuantities, setCatalogQuantities] = useState<Record<number, number>>({});
    const [preChatForm, setPreChatForm] = useState<PreChatForm>({
        correo: "",
        nombre: "",
        ciudad: ""
    });
    const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>({
        telefono: "",
        ciudad: "",
        direccion: ""
    });
    const [preChatReady, setPreChatReady] = useState(false);
    const [preChatSubmitting, setPreChatSubmitting] = useState(false);
    const [preChatError, setPreChatError] = useState("");
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
    const [checkoutError, setCheckoutError] = useState("");
    const [clockTick, setClockTick] = useState(0);
    const [reportingKey, setReportingKey] = useState<string | null>(null);
    const [reportedKeys, setReportedKeys] = useState<Record<string, boolean>>({});
    const [pendingErrorReport, setPendingErrorReport] = useState<PendingErrorReport | null>(null);
    const [errorDescription, setErrorDescription] = useState("");
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupInfo, setLookupInfo] = useState<CustomerLookup | null>(null);
    const [lookupEmail, setLookupEmail] = useState("");
    const [trackingOpen, setTrackingOpen] = useState(false);
    const [trackingSubmitting, setTrackingSubmitting] = useState(false);
    const [trackingError, setTrackingError] = useState("");
    const [trackedOrders, setTrackedOrders] = useState<TrackedOrder[]>([]);
    const [resumeCandidate, setResumeCandidate] = useState<StoredChatSession | null>(null);
    const [publicConfig, setPublicConfig] = useState<PublicStoreConfig>({
        nombreTienda: "El Verdulero",
        siteUrl: "https://elverdulero.com.co",
        logoUrl: "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png",
        supportWhatsapp: "573176778089",
        horaCorte: DEFAULT_CUTOFF,
        deliveryWindow: "10:00 AM a 5:00 PM",
        mensajeBienvenida: DEFAULT_WELCOME_MESSAGE,
        pedidoMinimo: 0,
        ciudades: DEFAULT_CITY_RULES,
        cobertura: "Cobertura Bucaramanga, Floridablanca, Girón, Piedecuesta y Ruitoque"
    });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const isMountedRef = useRef(true);
    const deliverySchedule = useMemo(
        () => buildDeliverySchedule(publicConfig.horaCorte, new Date(), publicConfig.deliveryWindow),
        [clockTick, publicConfig.horaCorte, publicConfig.deliveryWindow]
    );
    const minimumOrder = Math.max(0, publicConfig.pedidoMinimo || 0);
    const freeShippingFrom = Math.max(0, publicConfig.envioGratisDesde || 0);
    const minimumShortfall = Math.max(0, minimumOrder - cartTotal);
    const freeShippingShortfall = Math.max(0, freeShippingFrom - cartTotal);
    const minimumMet = minimumOrder === 0 || cartTotal >= minimumOrder;
    const freeShippingMet = freeShippingFrom === 0 || cartTotal >= freeShippingFrom;
    const freeShippingProgress = freeShippingFrom > 0 ? Math.min(100, Math.round((cartTotal / freeShippingFrom) * 100)) : 100;
    const selectedCityRule = (publicConfig.ciudades || DEFAULT_CITY_RULES).find(
        (city) => city.value === normalizeCityValue(preChatForm.ciudad)
    ) || null;
    const selectedCityLabel = selectedCityRule?.label || preChatForm.ciudad || "";
    const estimatedShipping = cartItems.length === 0
        ? 0
        : freeShippingMet
            ? 0
            : Math.max(0, selectedCityRule?.shipping ?? 10000);

    const createNewSessionId = () => `web_${Math.random().toString(36).substring(2, 9)}`;

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const loadCart = async (sid: string) => {
        try {
            setCartLoading(true);
            const res = await fetch(`/api/cart?sessionId=${sid}`);
            const data = await res.json();
            if (res.ok) {
                setCartItems(Array.isArray(data.items) ? data.items : []);
                setCartTotal(typeof data.total === "number" ? data.total : 0);
            }
        } catch (error) {
            console.error("Cart load error:", error);
        } finally {
            setCartLoading(false);
        }
    };

    const loadProducts = async (query = "", forceRefresh = false) => {
        try {
            setProductsLoading(true);
            const params = new URLSearchParams();
            if (query.trim()) params.set("search", query.trim());
            params.set("limit", "24");
            if (forceRefresh) params.set("forceRefresh", "1");
            const res = await fetch(`/api/products?${params.toString()}`);
            const data = await res.json();
            if (res.ok) {
                setProducts(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error("Products load error:", error);
        } finally {
            setProductsLoading(false);
        }
    };

    const loadFeaturedProduct = async (forceRefresh = false) => {
        try {
            const params = new URLSearchParams({
                search: FEATURED_PRODUCT_SEARCH,
                limit: "8"
            });
            if (forceRefresh) params.set("forceRefresh", "1");
            const res = await fetch(`/api/products?${params.toString()}`);
            const data = await res.json();
            if (!res.ok || !Array.isArray(data)) return;

            const match = data.find((product: Product) =>
                /zumo de lim[oó]n/i.test(product.name) && /colemon/i.test(product.name)
            ) || data[0] || null;

            setFeaturedProduct(match);
        } catch (error) {
            console.error("Featured product load error:", error);
        }
    };

    const updateQuantity = async (productId: number, delta: 1 | -1) => {
        if (!sessionId) return;
        try {
            setUpdatingProduct(productId);
            const res = await fetch("/api/cart", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, productId, delta })
            });
            const data = await res.json();
            if (res.ok) {
                setCartItems(Array.isArray(data.items) ? data.items : []);
                setCartTotal(typeof data.total === "number" ? data.total : 0);
            }
        } catch (error) {
            console.error("Cart update error:", error);
        } finally {
            setUpdatingProduct(null);
        }
    };

    const changeCatalogQuantity = (productId: number, delta: 1 | -1) => {
        setCatalogQuantities((prev) => {
            const current = prev[productId] || 1;
            const next = Math.max(1, current + delta);
            return { ...prev, [productId]: next };
        });
    };

    const addProductToCart = async (product: Product) => {
        if (!preChatReady) {
            setPreChatError("Completa el inicio del pedido antes de agregar productos.");
            return;
        }
        if (!sessionId) return;
        try {
            setAddingProduct(product.id);
            const quantity = catalogQuantities[product.id] || 1;
            const res = await fetch("/api/cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    quantity,
                    item: {
                        product_id: product.id,
                        name: product.name,
                        price: product.price,
                        unit: product.unit,
                        image: product.image
                    }
                })
            });
            const data = await res.json();
            if (res.ok) {
                setCartItems(Array.isArray(data.items) ? data.items : []);
                setCartTotal(typeof data.total === "number" ? data.total : 0);
                setCatalogQuantities((prev) => ({ ...prev, [product.id]: 1 }));
            }
        } catch (error) {
            console.error("Cart add error:", error);
        } finally {
            setAddingProduct(null);
        }
    };

    useEffect(() => {
        if (typeof window === "undefined") return;

        try {
            const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
            if (!raw) {
                setSessionId(createNewSessionId());
                return;
            }

            const parsed = JSON.parse(raw) as StoredChatSession;
            const isFresh = parsed?.savedAt && Date.now() - parsed.savedAt < SESSION_MAX_AGE_MS;

            if (!parsed?.sessionId || !isFresh || !parsed.preChatReady) {
                window.localStorage.removeItem(SESSION_STORAGE_KEY);
                setSessionId(createNewSessionId());
                return;
            }

            setResumeCandidate(parsed);
        } catch (error) {
            console.error("Session restore error:", error);
            setSessionId(createNewSessionId());
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !sessionId) return;

        const payload: StoredChatSession = {
            sessionId,
            messages,
            preChatReady,
            preChatForm,
            checkoutForm,
            savedAt: Date.now()
        };

        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
    }, [sessionId, messages, preChatReady, preChatForm, checkoutForm]);

    useEffect(() => {
        if (!sessionId) return;
        loadCart(sessionId);
        const interval = setInterval(() => loadCart(sessionId), 4000);
        return () => clearInterval(interval);
    }, [sessionId]);

    useEffect(() => {
        const timer = setTimeout(() => loadProducts(productSearch), 220);
        return () => clearTimeout(timer);
    }, [productSearch]);

    useEffect(() => {
        const normalizedEmail = preChatForm.correo.trim().toLowerCase();

        if (!isValidEmail(normalizedEmail)) {
            setLookupLoading(false);
            setLookupInfo(null);
            setLookupEmail("");
            return;
        }

        if (normalizedEmail === lookupEmail) {
            return;
        }

        const timer = setTimeout(async () => {
            try {
                setLookupLoading(true);
                const response = await fetch(`/api/customer-lookup?email=${encodeURIComponent(normalizedEmail)}`);
                const data = await response.json();
                setLookupEmail(normalizedEmail);

                if (response.ok && data?.found) {
                    setLookupInfo(data);
                } else {
                    setLookupInfo({ found: false });
                }
            } catch (error) {
                console.error("Customer lookup UI error:", error);
                setLookupInfo(null);
            } finally {
                setLookupLoading(false);
            }
        }, 350);

        return () => clearTimeout(timer);
    }, [preChatForm.correo, lookupEmail]);

    useEffect(() => {
        loadFeaturedProduct();
    }, []);

    useEffect(() => {
        const loadPublicConfig = async () => {
            try {
                const response = await fetch("/api/public/store-config");
                const data = await response.json();
                if (response.ok && typeof data?.horaCorte === "string") {
                    setPublicConfig({
                        nombreTienda: typeof data?.nombreTienda === "string" ? data.nombreTienda : "El Verdulero",
                        siteUrl: typeof data?.siteUrl === "string" ? data.siteUrl : "https://elverdulero.com.co",
                        logoUrl: typeof data?.logoUrl === "string" ? data.logoUrl : "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png",
                        supportWhatsapp: typeof data?.supportWhatsapp === "string" ? data.supportWhatsapp : "573176778089",
                        horaCorte: data.horaCorte,
                        deliveryWindow: typeof data?.deliveryWindow === "string" ? data.deliveryWindow : "10:00 AM a 5:00 PM",
                        mensajeBienvenida: typeof data?.mensajeBienvenida === "string" && data.mensajeBienvenida.trim() ? data.mensajeBienvenida.trim() : DEFAULT_WELCOME_MESSAGE,
                        pedidoMinimo: typeof data?.pedidoMinimo === "number" ? data.pedidoMinimo : 0,
                        envioGratisDesde: typeof data?.envioGratisDesde === "number" ? data.envioGratisDesde : undefined,
                        ciudades: Array.isArray(data?.ciudades) && data.ciudades.length > 0 ? data.ciudades : DEFAULT_CITY_RULES,
                        cobertura: typeof data?.cobertura === "string" ? data.cobertura : undefined
                    });
                    const welcome = typeof data?.mensajeBienvenida === "string" && data.mensajeBienvenida.trim()
                        ? data.mensajeBienvenida.trim()
                        : DEFAULT_WELCOME_MESSAGE;
                    setMessages((prev) => prev.some((m) => m.role === "user") ? prev : [{ role: "assistant", content: welcome, type: "text" }]);
                }
            } catch (error) {
                console.error("Public config UI error:", error);
            }
        };

        loadPublicConfig();
    }, []);

    useEffect(() => {
        const interval = setInterval(() => setClockTick((v) => v + 1), 60000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (isLoading) return;
        if (!preChatReady || resumeCandidate || checkoutOpen || trackingOpen || pendingErrorReport) return;
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [isLoading, preChatReady, resumeCandidate, checkoutOpen, trackingOpen, pendingErrorReport]);

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        messagesEndRef.current?.scrollIntoView({ behavior });
    };

    useEffect(() => {
        scrollToBottom(isLoading ? "auto" : "smooth");
    }, [messages, isLoading]);

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const animateAssistantMessage = async (fullText: string) => {
        if (!isMountedRef.current) return;
        await sleep(380);
        if (!isMountedRef.current) return;

        setMessages((prev) => [...prev, { role: "assistant", content: "", type: "text" }]);

        const step = fullText.length > 500 ? 8 : fullText.length > 250 ? 5 : 3;
        const delay = fullText.length > 500 ? 8 : 14;

        for (let i = step; i <= fullText.length; i += step) {
            if (!isMountedRef.current) return;
            const chunk = fullText.slice(0, i);
            setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (!last || last.role !== "assistant") return prev;
                next[next.length - 1] = { ...last, content: chunk };
                return next;
            });
            await sleep(delay);
        }

        if (!isMountedRef.current) return;
        setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") return prev;
            next[next.length - 1] = { ...last, content: fullText };
            return next;
        });
    };

    const bootstrapPreChat = async () => {
        if (!sessionId) return;

        const email = preChatForm.correo.trim().toLowerCase();
        if (!isValidEmail(email)) {
            setPreChatError("Déjame tu correo electrónico válido para empezar.");
            return;
        }

        if (!lookupInfo?.found && preChatForm.nombre.trim().length < 3) {
            setPreChatError("Déjame tu nombre para arrancar bien.");
            return;
        }

        if (!preChatForm.ciudad) {
            setPreChatError("Selecciona una ciudad de cobertura.");
            return;
        }

        setPreChatSubmitting(true);
        setPreChatError("");

        try {
            await Promise.all([
                loadProducts(productSearch, true),
                loadFeaturedProduct(true)
            ]);
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    customerName: preChatForm.nombre.trim() || lookupInfo?.customer?.firstName || "Visitante Web",
                    bootstrapProfile: {
                        correo: email,
                        ciudad: preChatForm.ciudad,
                        nombre: lookupInfo?.found ? undefined : preChatForm.nombre.trim(),
                    }
                })
            });

            const data = await response.json();
            const assistantReply = response.ok && data.content
                ? data.content
                : "¡Listo, veci! Ya quedamos registrados. Ahora sí, ¿qué te anoto en tu pedido?";

            setMessages([]);
            setPreChatReady(true);
            setCheckoutForm((prev) => ({
                ...prev,
                ciudad: preChatForm.ciudad || prev.ciudad
            }));
            await animateAssistantMessage(assistantReply);
            await loadCart(sessionId);
        } catch (error) {
            console.error("Pre-chat bootstrap error:", error);
            setPreChatError("Se me enredó el registro inicial. Intentemos otra vez.");
        } finally {
            setPreChatSubmitting(false);
        }
    };

    const continueStoredSession = async () => {
        if (!resumeCandidate) return;
        setSessionId(resumeCandidate.sessionId);
        setMessages(Array.isArray(resumeCandidate.messages) && resumeCandidate.messages.length > 0
            ? resumeCandidate.messages
            : [{ role: "assistant", content: DEFAULT_WELCOME_MESSAGE, type: "text" }]);
        setPreChatForm(resumeCandidate.preChatForm);
        setCheckoutForm(resumeCandidate.checkoutForm);
        setPreChatReady(Boolean(resumeCandidate.preChatReady));
        setResumeCandidate(null);
        await Promise.all([
            loadProducts(productSearch, true),
            loadFeaturedProduct(true),
            loadCart(resumeCandidate.sessionId)
        ]);
    };

    const startFreshSession = () => {
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
        }
        setMessages([{ role: "assistant", content: DEFAULT_WELCOME_MESSAGE, type: "text" }]);
        setCartItems([]);
        setCartTotal(0);
        setPreChatForm({ correo: "", nombre: "", ciudad: "" });
        setCheckoutForm({ telefono: "", ciudad: "", direccion: "" });
        setPreChatReady(false);
        setLookupInfo(null);
        setLookupEmail("");
        setPreChatError("");
        setResumeCandidate(null);
        setSessionId(createNewSessionId());
    };

    const sendUserMessage = async (userMessage: string) => {
        if (!userMessage.trim() || isLoading) return;
        if (!preChatReady) {
            setPreChatError("Antes de empezar, completa tus datos para atenderte mejor.");
            return;
        }

        const nextMessages = [...messages, { role: "user", content: userMessage }];
        const firstUserIndex = nextMessages.findIndex((m) => m.role === "user");
        const normalizedMessages = firstUserIndex >= 0 ? nextMessages.slice(firstUserIndex) : nextMessages;
        setInput("");
        setMessages((prev) => [...prev, { role: "user", content: userMessage, type: "text" }]);
        setIsLoading(true);
        requestAnimationFrame(() => inputRef.current?.focus());

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: normalizedMessages,
                    sessionId,
                    customerName: "Visitante Web"
                })
            });

            const data = await response.json();
            let assistantReply = "Ay caramba, se me enredó el pedido. ¿Me repites?";
            if (response.ok && data.content) {
                assistantReply = data.content;
            }
            await animateAssistantMessage(assistantReply);

            if (sessionId) await loadCart(sessionId);
        } catch (error) {
            console.error("Chat error:", error);
            await animateAssistantMessage("Ay caramba, se me enredó un poco el pedido. ¿Me repites?");
        } finally {
            setIsLoading(false);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await sendUserMessage(input.trim());
    };

    const sendQuickReply = async (reply: string) => {
        if (isLoading) return;
        await sendUserMessage(reply);
    };

    const submitCheckout = async () => {
        if (!sessionId || isLoading || cartItems.length === 0) return;

        const phone = checkoutForm.telefono.replace(/\D/g, "");
        const checkoutCity = normalizeCityValue(preChatForm.ciudad || checkoutForm.ciudad);
        if (phone.length !== 10 || !phone.startsWith("3")) {
            setCheckoutError("Déjame tu número de WhatsApp válido de 10 dígitos.");
            return;
        }

        if (!checkoutCity) {
            setCheckoutError("Primero necesitamos la ciudad del inicio para confirmar el pedido.");
            return;
        }

        if (checkoutForm.direccion.trim().length < 8) {
            setCheckoutError("Déjame una dirección de entrega más completa.");
            return;
        }

        setCheckoutSubmitting(true);
        setCheckoutError("");

        try {
            const nextMessages = [...messages, { role: "user", content: "confirmar pedido" }];
            const firstUserIndex = nextMessages.findIndex((m) => m.role === "user");
            const normalizedMessages = firstUserIndex >= 0 ? nextMessages.slice(firstUserIndex) : nextMessages;

            setMessages((prev) => [...prev, { role: "user", content: "confirmar pedido", type: "text" }]);
            setIsLoading(true);
            setCheckoutOpen(false);

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: normalizedMessages,
                    sessionId,
                    customerName: preChatForm.nombre || lookupInfo?.customer?.firstName || "Visitante Web",
                    checkoutProfile: {
                        telefono: phone,
                        ciudad: checkoutCity,
                        direccion: checkoutForm.direccion.trim()
                    }
                })
            });

            const data = await response.json();
            const assistantReply = response.ok && data.content
                ? data.content
                : "Ay caramba, se me enredó el cierre del pedido. ¿Me lo intentas otra vez?";

            await animateAssistantMessage(assistantReply);
            if (sessionId) await loadCart(sessionId);
        } catch (error) {
            console.error("Checkout modal error:", error);
            await animateAssistantMessage("Ay caramba, se me enredó el cierre del pedido. ¿Me lo intentas otra vez?");
        } finally {
            setCheckoutSubmitting(false);
            setIsLoading(false);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    };

    const handleCheckoutClick = async () => {
        if (!preChatReady) {
            setPreChatError("Primero completa tus datos para poder confirmar el pedido.");
            return;
        }
        if (!preChatForm.ciudad) {
            setPreChatError("Primero selecciona tu ciudad en el inicio del pedido.");
            return;
        }
        if (cartItems.length === 0 || isLoading) return;
        if (!minimumMet) {
            setCheckoutError(`Todavía te faltan ${formatMoney(minimumShortfall)} para llegar al pedido mínimo.`);
            return;
        }
        setCheckoutError("");
        setCheckoutOpen(true);
    };

    const buildConversationSlice = (targetIndex: number) => {
        const visibleMessages = messages
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => !message.hidden);

        const visibleIndex = visibleMessages.findIndex(({ index }) => index === targetIndex);
        const start = Math.max(0, visibleIndex - 3);
        const end = Math.min(visibleMessages.length, visibleIndex + 4);

        return visibleMessages
            .slice(start, end)
            .map(({ message }) => `${message.role === "assistant" ? "EL VERDULERO" : "CLIENTE"}: ${message.content}`)
            .join("\n\n");
    };

    const reportErrorMessage = async (message: Message, index: number, note: string) => {
        if (!sessionId) return;
        const reportKey = `${index}-${message.role}-${message.content}`;
        if (reportedKeys[reportKey] || reportingKey === reportKey) return;

        setReportingKey(reportKey);
        try {
            const response = await fetch("/api/error-reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    messageIndex: index,
                    messageRole: message.role,
                    messageContent: message.content,
                    reporterNote: note.trim(),
                    previousMessage: index > 0 ? messages[index - 1]?.content || null : null,
                    nextMessage: index < messages.length - 1 ? messages[index + 1]?.content || null : null,
                    conversationSlice: buildConversationSlice(index),
                    pageUrl: typeof window !== "undefined" ? window.location.href : null
                })
            });

            if (!response.ok) {
                throw new Error("No pude registrar el reporte");
            }

            setReportedKeys((prev) => ({ ...prev, [reportKey]: true }));
        } catch (error) {
            console.error("Report error action failed:", error);
        } finally {
            setReportingKey(null);
        }
    };

    const openErrorReportModal = (message: Message, index: number) => {
        if (!ERROR_REPORTING_UI_ENABLED) return;
        const key = `${index}-${message.role}-${message.content}`;
        if (reportedKeys[key]) return;
        setErrorDescription("");
        setPendingErrorReport({ key, index, message });
    };

    const submitErrorReport = async () => {
        if (!pendingErrorReport) return;
        await reportErrorMessage(pendingErrorReport.message, pendingErrorReport.index, errorDescription);
        setPendingErrorReport(null);
        setErrorDescription("");
    };

    const openTrackingModal = () => {
        setTrackingError("");
        setTrackedOrders([]);
        setTrackingOpen(true);
    };

    const lookupOrderStatus = async () => {
        const email = preChatForm.correo.trim().toLowerCase();
        if (!isValidEmail(email)) {
            setTrackingError("Déjame un correo válido para buscar tu pedido.");
            return;
        }

        setTrackingSubmitting(true);
        setTrackingError("");
        try {
            const res = await fetch(`/api/order-tracking?email=${encodeURIComponent(email)}`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.error || "No pude buscar tu pedido.");
            }

            if (!data?.found || !Array.isArray(data.orders) || data.orders.length === 0) {
                setTrackedOrders([]);
                setTrackingError("No encontré pedidos con ese correo todavía.");
                return;
            }

            setTrackedOrders(data.orders);
        } catch (error) {
            console.error("Order tracking lookup failed:", error);
            setTrackingError(error instanceof Error ? error.message : "No pude buscar tu pedido.");
        } finally {
            setTrackingSubmitting(false);
        }
    };

    const renderCatalogPanel = (isMobile = false) => (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-800">Mercado rápido</h2>
                        <p className="mt-1 text-xs font-semibold text-gray-400">Agregue productos sin salir del chat.</p>
                    </div>
                    {isMobile && (
                        <button
                            type="button"
                            onClick={() => setCatalogOpen(false)}
                            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-500"
                        >
                            <X size={18} />
                        </button>
                    )}
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3">
                    <Search size={16} className="text-gray-400" />
                    <input
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Buscar papa, tomate, piña..."
                        className="w-full bg-transparent text-sm font-semibold text-gray-700 outline-none placeholder:text-gray-400"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {productsLoading && (
                    <div className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando productos frescos...
                    </div>
                )}

                {!productsLoading && products.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center text-sm font-semibold text-gray-400">
                        No encontré productos con ese nombre.
                    </div>
                )}

                {products.filter((product) => product.id !== featuredProduct?.id).map((product) => {
                    const quantity = catalogQuantities[product.id] || 1;
                    return (
                        <div key={product.id} className="rounded-3xl border border-gray-100 bg-white p-3 shadow-sm">
                            <div className="flex gap-3">
                                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
                                    {product.image ? (
                                        <Image src={product.image} alt={product.name} fill className="object-cover" />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gray-400">
                                            Sin foto
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-black leading-tight text-gray-800">{product.name}</p>
                                    <p className="mt-1 text-sm font-bold text-green-700">{formatMoney(product.price)}</p>
                                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                                        {productUnitLabel(product.unit, product.name)} · {product.stock_status === "instock" ? "Disponible" : "Consultar"}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                                <div className="flex items-center rounded-2xl border border-gray-200 bg-gray-50">
                                    <button
                                        type="button"
                                        onClick={() => changeCatalogQuantity(product.id, -1)}
                                        className="flex h-10 w-10 items-center justify-center text-gray-600"
                                    >
                                        <Minus size={14} />
                                    </button>
                                    <span className="w-10 text-center text-sm font-black text-gray-800">{quantity}</span>
                                    <button
                                        type="button"
                                        onClick={() => changeCatalogQuantity(product.id, 1)}
                                        className="flex h-10 w-10 items-center justify-center text-gray-600"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => addProductToCart(product)}
                                    disabled={addingProduct === product.id}
                                    className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wide text-white transition hover:bg-slate-800 disabled:opacity-60"
                                >
                                    {addingProduct === product.id ? "Agregando..." : "Agregar"}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {featuredProduct && (
                <div className="border-t border-emerald-100 bg-gradient-to-r from-emerald-50/60 via-lime-50/35 to-white px-2 py-1.5">
                    <div className="rounded-[0.9rem] border border-emerald-200 bg-white/95 p-2 shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">Destacado del mes</p>
                        <div className="mt-1.5 flex items-center gap-2">
                            <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-[0.75rem] border border-emerald-100 bg-white">
                                {featuredProduct.image ? (
                                    <Image src={featuredProduct.image} alt={featuredProduct.name} fill className="object-cover" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gray-400">
                                        Sin foto
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-[10px] font-black leading-tight text-slate-900">{featuredProduct.name}</p>
                                <p className="mt-0.5 text-[12px] font-black text-emerald-700">{formatMoney(featuredProduct.price)}</p>
                                <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    {productUnitLabel(featuredProduct.unit, featuredProduct.name)} · Disponible
                                </p>
                            </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex items-center rounded-[0.75rem] border border-emerald-200 bg-emerald-50/60">
                                <button
                                    type="button"
                                    onClick={() => changeCatalogQuantity(featuredProduct.id, -1)}
                                    className="flex h-6 w-6 items-center justify-center text-slate-600"
                                >
                                    <Minus size={12} />
                                </button>
                                <span className="w-6 text-center text-xs font-black text-slate-900">{catalogQuantities[featuredProduct.id] || 1}</span>
                                <button
                                    type="button"
                                    onClick={() => changeCatalogQuantity(featuredProduct.id, 1)}
                                    className="flex h-6 w-6 items-center justify-center text-slate-600"
                                >
                                    <Plus size={12} />
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => addProductToCart(featuredProduct)}
                                disabled={addingProduct === featuredProduct.id}
                                className="flex-1 rounded-[0.8rem] bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:opacity-60"
                            >
                                {addingProduct === featuredProduct.id ? "Agregando..." : "Agregar"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderCartPanel = (isMobile = false) => (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
                <div>
                    <h2 className="text-sm font-black uppercase tracking-widest text-gray-700">Tu Canasta</h2>
                    <p className="mt-1 text-[11px] font-semibold text-gray-400">
                        {cartItems.length > 0 ? `${cartItems.length} productos listos` : "Todavía no hay productos"}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {cartLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    {isMobile && (
                        <button
                            type="button"
                            onClick={() => setMobileCartOpen(false)}
                            className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-emerald-700"
                        >
                            <X size={15} />
                            <span className="ml-1.5">Volver al chat</span>
                        </button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {cartItems.length === 0 && (
                    <div className="rounded-[2rem] border border-dashed border-gray-200 bg-gray-50 px-5 py-16 text-center">
                        <p className="text-sm font-black text-gray-500">Todavía no hay productos en la canasta.</p>
                        <p className="mt-2 text-xs font-semibold text-gray-400">Usa el chat o el catálogo para empezar a mercar.</p>
                    </div>
                )}

                {cartItems.map((item) => (
                    <div key={item.product_id} className="p-3 border border-gray-100 rounded-2xl bg-gray-50/40">
                        <div className="flex gap-3">
                            <div className="w-16 h-16 rounded-xl bg-white border border-gray-100 overflow-hidden relative flex-shrink-0">
                                {item.image ? (
                                    <Image src={item.image} alt={item.name} fill className="object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">Sin foto</div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-800 leading-tight">{item.name}</p>
                                <p className="text-xs font-semibold text-gray-500 mt-1">{formatMoney(item.price)} / {productUnitLabel(item.unit, item.name)}</p>
                                <p className="text-xs font-black text-primary mt-1">Subtotal: {formatMoney(item.price * item.quantity)}</p>
                            </div>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => updateQuantity(item.product_id, -1)}
                                disabled={updatingProduct === item.product_id}
                                className="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center hover:border-primary/40"
                            >
                                <Minus size={14} />
                            </button>
                            <span className="w-10 text-center text-sm font-black text-gray-800">{item.quantity}</span>
                            <button
                                type="button"
                                onClick={() => updateQuantity(item.product_id, 1)}
                                disabled={updatingProduct === item.product_id}
                                className="w-8 h-8 rounded-xl bg-white border border-gray-200 flex items-center justify-center hover:border-primary/40"
                            >
                                <Plus size={14} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="shrink-0 border-t border-gray-100 bg-white p-4 sm:p-5">
                <div className="mb-4 space-y-3">
                    {minimumOrder > 0 && (
                        <div className={cn(
                            "rounded-2xl border px-4 py-3",
                            minimumMet ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                        )}>
                            <p className={cn(
                                "text-[10px] font-black uppercase tracking-[0.18em]",
                                minimumMet ? "text-emerald-700" : "text-amber-700"
                            )}>
                                Pedido mínimo
                            </p>
                            <p className={cn(
                                "mt-1 text-sm font-black",
                                minimumMet ? "text-emerald-950" : "text-amber-950"
                            )}>
                                {minimumMet
                                    ? `Ya cumples el pedido mínimo de ${formatMoney(minimumOrder)}`
                                    : `Te faltan ${formatMoney(minimumShortfall)} para llegar al pedido mínimo`}
                            </p>
                        </div>
                    )}

                    {freeShippingFrom > 0 && (
                        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-700">Barra envío gratis</p>
                                <span className="text-[11px] font-black text-sky-900">{Math.min(100, freeShippingProgress)}%</span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
                                <div
                                    className="h-full rounded-full bg-sky-500 transition-all duration-500"
                                    style={{ width: `${Math.min(100, freeShippingProgress)}%` }}
                                />
                            </div>
                            <p className="mt-2 text-xs font-bold text-sky-900">
                                {freeShippingMet
                                    ? `Ya te ganaste el envío gratis desde ${formatMoney(freeShippingFrom)}.`
                                    : `Te faltan ${formatMoney(freeShippingShortfall)} para conseguir envío gratis.`}
                            </p>
                            {selectedCityLabel && (
                                <p className="mt-1 text-[11px] font-semibold text-sky-700">
                                    {freeShippingMet
                                        ? `Domicilio estimado en ${selectedCityLabel}: GRATIS`
                                        : `Domicilio estimado en ${selectedCityLabel}: ${formatMoney(estimatedShipping)}`}
                                </p>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">Total</span>
                    <span className="text-2xl font-black text-gray-900">{formatMoney(cartTotal)}</span>
                </div>
                <button
                    type="button"
                    onClick={async () => {
                        if (isMobile) setMobileCartOpen(false);
                        await handleCheckoutClick();
                    }}
                    disabled={cartItems.length === 0 || isLoading || !minimumMet}
                    className="mt-4 w-full rounded-2xl bg-green-600 px-4 py-3 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-green-600/20 transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                >
                    Confirmar pedido
                </button>
                <p className="mt-2 text-[11px] font-semibold text-gray-400">
                    {minimumMet
                        ? "Cuando le des clic, el chat pasa al cierre del pedido."
                        : `Primero necesitamos llegar al pedido mínimo de ${formatMoney(minimumOrder)}.`}
                </p>
            </div>
        </div>
    );

    return (
        <main className="app-safe-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.08),_transparent_28%),linear-gradient(180deg,_#f8faf8_0%,_#f4f6f3_100%)]">
            <div className="app-safe-top sticky top-0 z-[100] border-b border-[#e6eadf] bg-white/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(15,23,42,0.04)]">
                <div className="mx-auto max-w-[1720px] px-3 md:px-5">
                    <div className="flex flex-wrap items-center gap-2 py-1.5 md:py-3 lg:flex-nowrap lg:gap-3">
                        <div className="hidden min-w-0 lg:flex lg:items-center lg:gap-3">
                            <a
                                href={publicConfig.siteUrl || "https://elverdulero.com.co"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded-2xl bg-[#3f7d2a] px-4 py-3 text-[11px] font-black uppercase tracking-[0.15em] text-white shadow-lg shadow-green-900/10 transition hover:bg-[#356b23]"
                            >
                                Ver tienda principal
                            </a>
                        </div>

                        <div className="order-first flex w-full justify-center sm:order-none sm:w-auto lg:flex-1">
                            <a
                                href={publicConfig.siteUrl || "https://elverdulero.com.co"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group inline-flex items-center justify-center gap-2"
                            >
                                <div className="relative h-[42px] w-[170px] md:h-[78px] md:w-[320px]">
                                    <Image
                                        src={publicConfig.logoUrl || "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png"}
                                        alt="El Verdulero"
                                        fill
                                        className="object-contain transition duration-300 group-hover:scale-[1.01]"
                                        priority
                                    />
                                </div>
                                <span className="inline-flex h-fit rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 shadow-sm">
                                    Beta
                                </span>
                            </a>
                        </div>

                        <div className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600 md:flex">
                            Pago contra entrega
                        </div>
                        <div className="hidden min-w-0 max-w-[420px] rounded-[1.2rem] border border-green-200 bg-green-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] leading-tight text-green-700 sm:text-[11px] md:block">
                            <div className="line-clamp-2">{publicConfig.cobertura || "Cobertura Bucaramanga, Floridablanca, Girón, Piedecuesta y Ruitoque"}</div>
                        </div>
                        <div className="flex w-full items-center justify-center gap-2 rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-center text-[10px] font-black uppercase tracking-[0.12em] text-lime-800 md:hidden">
                            <span>{deliverySchedule.fullDateLabel}</span>
                            <span className="text-lime-500">·</span>
                            <span>Canasta {formatMoney(cartTotal)}</span>
                        </div>
                        <div className="ml-auto hidden min-w-0 items-center justify-end gap-2 md:flex">
                            <div className="rounded-2xl border border-lime-200 bg-lime-50 px-4 py-3 text-center">
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-700">Entrega</p>
                                <p className="mt-1 whitespace-nowrap text-xs font-black text-lime-950">{deliverySchedule.fullDateLabel}</p>
                                <p className="mt-1 text-[10px] font-bold text-lime-700">{deliverySchedule.statusLabel}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Canasta</p>
                                <p className="mt-1 whitespace-nowrap text-xs font-black text-slate-950">{formatMoney(cartTotal)}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {resumeCandidate && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[112] bg-slate-950/45"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.98 }}
                            className="mx-auto flex h-full max-w-xl items-center justify-center"
                        >
                            <div className="app-safe-panel w-full overflow-y-auto rounded-[2rem] border border-white/60 bg-white p-6 shadow-2xl md:p-8">
                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-green-700">Seguimos donde ibas</p>
                                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">
                                    Encontré tu chat y tu canasta guardados.
                                </h2>
                                <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-500">
                                    Si quieres, retomamos justo donde ibas. Si prefieres arrancar limpio, te abro una sesión nueva.
                                </p>

                                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Sesión guardada</p>
                                    <p className="mt-2 text-sm font-bold text-slate-900">
                                        {resumeCandidate.preChatForm.correo || "Sin correo"}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-slate-500">
                                        {resumeCandidate.preChatForm.ciudad
                                            ? `Ciudad: ${(publicConfig.ciudades || DEFAULT_CITY_RULES).find((city) => city.value === resumeCandidate.preChatForm.ciudad)?.label || resumeCandidate.preChatForm.ciudad}`
                                            : "Ciudad pendiente"}
                                    </p>
                                </div>

                                <div className="app-modal-actions mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                                    <button
                                        type="button"
                                        onClick={startFreshSession}
                                        className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-slate-600"
                                    >
                                        Sesión nueva
                                    </button>
                                    <button
                                        type="button"
                                        onClick={continueStoredSession}
                                        className="rounded-2xl bg-green-600 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-green-600/25"
                                    >
                                        Continuar
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {ERROR_REPORTING_UI_ENABLED && pendingErrorReport && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[115] bg-slate-950/50"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.98 }}
                            className="mx-auto flex h-full max-w-xl items-center justify-center"
                        >
                            <div className="app-safe-panel w-full overflow-y-auto rounded-[2rem] border border-white/60 bg-white p-6 shadow-2xl md:p-7">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-rose-700">Modo inspección</p>
                                        <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Describa el error</h3>
                                        <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500">
                                            Guárdenos qué salió mal para revisarlo luego con calma. Este reporte queda amarrado al mensaje y al contexto del chat.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setPendingErrorReport(null)}
                                        className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                        Mensaje reportado
                                    </p>
                                    <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-800">
                                        {pendingErrorReport.message.content}
                                    </p>
                                </div>

                                <label className="mt-5 block">
                                    <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                                        Describa el error
                                    </span>
                                    <textarea
                                        value={errorDescription}
                                        onChange={(e) => setErrorDescription(e.target.value)}
                                        placeholder="Ejemplo: aquí confundió la variante, no entendió la cantidad, volvió a pedir un dato ya capturado..."
                                        className="min-h-[140px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-300"
                                    />
                                </label>

                                <div className="app-modal-actions mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setPendingErrorReport(null)}
                                        className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-600"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={submitErrorReport}
                                        disabled={reportingKey === pendingErrorReport.key || !errorDescription.trim()}
                                        className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-rose-600/20 disabled:opacity-60"
                                    >
                                        {reportingKey === pendingErrorReport.key ? "Guardando..." : "Guardar reporte"}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {checkoutOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[111] bg-slate-950/50"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.98 }}
                            className="mx-auto flex h-full max-w-2xl items-stretch justify-center sm:items-center"
                        >
                            <div className="app-safe-panel flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white shadow-2xl sm:h-auto">
                                <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="max-w-xl">
                                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-green-700">Cierre del pedido</p>
                                            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">
                                                Completa tus datos de entrega y confirmamos.
                                            </h2>
                                            <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-500">
                                                Aquí sí te pido tu número de WhatsApp y tu dirección. La ciudad ya quedó guardada al inicio.
                                            </p>
                                            {selectedCityLabel && (
                                                <p className="mt-3 inline-flex rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-800">
                                                    Ciudad: {selectedCityLabel}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setCheckoutOpen(false)}
                                            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>

                                    <div className="mt-8 grid gap-4 md:grid-cols-2">
                                        <label className="md:col-span-2">
                                        <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Tu número de WhatsApp</span>
                                        <input
                                            value={checkoutForm.telefono}
                                            onChange={(e) => setCheckoutForm((prev) => ({ ...prev, telefono: e.target.value }))}
                                            placeholder="3114479821"
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-800 outline-none transition focus:border-green-300 focus:bg-white"
                                        />
                                    </label>

                                    <label className="md:col-span-2">
                                        <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Dirección exacta de entrega</span>
                                        <input
                                            value={checkoutForm.direccion}
                                            onChange={(e) => setCheckoutForm((prev) => ({ ...prev, direccion: e.target.value }))}
                                            placeholder="Calle 45 # 12-34, apto 201, barrio..."
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-800 outline-none transition focus:border-green-300 focus:bg-white"
                                        />
                                    </label>
                                </div>

                                {checkoutError && (
                                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                                        {checkoutError}
                                    </div>
                                )}
                                </div>

                                <div className="app-modal-actions flex shrink-0 flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8 md:py-5">
                                    <p className="text-xs font-semibold text-slate-400">
                                        Vamos a usar estos datos solo para despacho y contacto del pedido.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={submitCheckout}
                                        disabled={checkoutSubmitting}
                                        className="inline-flex items-center justify-center rounded-2xl bg-green-600 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-green-600/25 transition hover:bg-green-700 disabled:opacity-60"
                                    >
                                        {checkoutSubmitting ? "Confirmando..." : "Confirmar pedido"}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {!resumeCandidate && !preChatReady && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[110] bg-slate-950/45"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.98 }}
                            className="mx-auto flex h-full max-w-2xl items-center justify-center"
                        >
                            <div className="app-safe-panel flex w-full flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white shadow-2xl">
                                <div className="flex-1 overflow-y-auto p-5 md:p-8">
                                    <div className="max-w-xl">
                                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-green-700">Antes de empezar</p>
                                        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900 md:mt-3 md:text-3xl">
                                            Déjame tu correo y arrancamos el mercado.
                                        </h2>
                                        <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-500 md:mt-3">
                                            Con tu <span className="text-slate-800">correo</span> y ciudad empezamos el chat y guardamos tu canasta.
                                        </p>
                                        <div className="mt-3 rounded-2xl border border-lime-200 bg-lime-50 px-4 py-3 md:mt-4">
                                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-700">Horario de pedidos</p>
                                            <p className="mt-1 text-sm font-black text-lime-950">{deliverySchedule.statusLabel}</p>
                                            <p className="mt-1 text-xs font-semibold text-lime-700">{deliverySchedule.countdownLabel}</p>
                                        </div>
                                    </div>

                                    <div className="mt-5 grid gap-3 md:mt-8 md:grid-cols-2 md:gap-4">
                                        <label className="md:col-span-2">
                                            <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Tu correo electrónico</span>
                                            <input
                                                value={preChatForm.correo}
                                                onChange={(e) => setPreChatForm((prev) => ({ ...prev, correo: e.target.value }))}
                                                placeholder="tu@correo.com"
                                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-800 outline-none transition focus:border-green-300 focus:bg-white"
                                            />
                                        </label>

                                        {lookupLoading && (
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500 md:col-span-2">
                                                Estoy revisando si ya te tengo registrado con ese correo...
                                            </div>
                                        )}

                                        {lookupInfo?.found && (
                                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 md:col-span-2">
                                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Cliente reconocido</p>
                                                <p className="mt-2 text-sm font-bold text-emerald-950">
                                                    Ya te reconocí. Puedes entrar de una y seguir con tu mercado.
                                                </p>
                                            </div>
                                        )}

                                        {lookupInfo && !lookupInfo.found && lookupEmail && (
                                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 md:col-span-2">
                                                No te encontré todavía. Déjame tu nombre y ciudad.
                                            </div>
                                        )}

                                        <label className="md:col-span-1">
                                            <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Ciudad</span>
                                            <select
                                                value={preChatForm.ciudad}
                                                onChange={(e) => setPreChatForm((prev) => ({ ...prev, ciudad: e.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-800 outline-none transition focus:border-green-300 focus:bg-white"
                                            >
                                                <option value="">Seleccione una ciudad</option>
                                                {(publicConfig.ciudades || DEFAULT_CITY_RULES).filter((city) => city.enabled !== false).map((city) => (
                                                    <option key={city.value} value={city.value}>{city.label}</option>
                                                ))}
                                            </select>
                                        </label>

                                        {!lookupInfo?.found && (
                                        <label className="md:col-span-1">
                                            <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Nombre completo</span>
                                            <input
                                                value={preChatForm.nombre}
                                                onChange={(e) => setPreChatForm((prev) => ({ ...prev, nombre: e.target.value }))}
                                                placeholder="Paola Rodríguez"
                                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-800 outline-none transition focus:border-green-300 focus:bg-white"
                                            />
                                        </label>
                                        )}
                                    </div>

                                    {preChatError && (
                                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                                            {preChatError}
                                        </div>
                                    )}
                                </div>

                                <div className="app-modal-actions flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between md:p-6">
                                    <p className="hidden text-xs font-semibold text-slate-400 md:block">
                                        {publicConfig.cobertura || "Solo entregamos en Bucaramanga, Floridablanca, Girón, Piedecuesta y Ruitoque."}
                                    </p>
                                    <div className="flex flex-col gap-3 sm:flex-row md:ml-auto">
                                        <button
                                            type="button"
                                            onClick={openTrackingModal}
                                            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-slate-700 transition hover:bg-slate-50"
                                        >
                                            ¿Dónde está mi pedido?
                                        </button>
                                        <button
                                            type="button"
                                            onClick={bootstrapPreChat}
                                            disabled={preChatSubmitting || !sessionId}
                                            className="inline-flex items-center justify-center rounded-2xl bg-green-600 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-green-600/25 transition hover:bg-green-700 disabled:opacity-60"
                                        >
                                            {preChatSubmitting ? "Entrando..." : "Empezar pedido"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {catalogOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[90] bg-slate-950/35 xl:hidden"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 24 }}
                            className="app-safe-panel mx-auto flex h-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-gray-100 bg-white shadow-2xl"
                        >
                            {renderCatalogPanel(true)}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {trackingOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[111] bg-slate-950/45"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 24, scale: 0.98 }}
                            className="mx-auto flex h-full max-w-2xl items-center justify-center"
                        >
                            <div className="app-safe-panel w-full overflow-y-auto rounded-[2rem] border border-white/60 bg-white p-6 shadow-2xl md:p-8">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="max-w-xl">
                                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-green-700">Seguimiento</p>
                                        <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">
                                            Mira dónde va tu pedido.
                                        </h2>
                                        <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-500">
                                            Déjame tu <span className="text-slate-800">correo electrónico</span> y te muestro si tu pedido está pendiente, en camino o completado.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setTrackingOpen(false)}
                                        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="mt-8 flex flex-col gap-4">
                                    <label>
                                        <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Tu correo electrónico</span>
                                        <input
                                            value={preChatForm.correo}
                                            onChange={(e) => setPreChatForm((prev) => ({ ...prev, correo: e.target.value }))}
                                            placeholder="tu@correo.com"
                                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-800 outline-none transition focus:border-green-300 focus:bg-white"
                                        />
                                    </label>

                                    <div className="app-modal-actions flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-xs font-semibold text-slate-400">
                                            Solo con tu correo te mostramos el estado de tus últimos pedidos.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={lookupOrderStatus}
                                            disabled={trackingSubmitting}
                                            className="inline-flex items-center justify-center rounded-2xl bg-green-600 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-green-600/25 transition hover:bg-green-700 disabled:opacity-60"
                                        >
                                            {trackingSubmitting ? "Buscando..." : "Ver mi pedido"}
                                        </button>
                                    </div>

                                    {trackingError && (
                                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                                            {trackingError}
                                        </div>
                                    )}

                                    {trackedOrders.length > 0 && (
                                        <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
                                            {trackedOrders.map((order) => (
                                                <div key={order.id} className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Pedido #{order.id}</p>
                                                            <p className="mt-1 text-sm font-bold text-slate-900">
                                                                {new Date(order.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                                                            </p>
                                                            <p className="mt-1 text-sm font-semibold text-slate-600">
                                                                {order.customerAddress}, {order.customerCity}
                                                            </p>
                                                        </div>
                                                        <div className={cn(
                                                            "rounded-full border px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em]",
                                                            order.status === "Pendiente"
                                                                ? "border-orange-200 bg-orange-50 text-orange-700"
                                                                : order.status === "En Camino"
                                                                    ? "border-sky-200 bg-sky-50 text-sky-700"
                                                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                        )}>
                                                            {order.status}
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 space-y-2">
                                                        {order.items.map((item, index) => (
                                                            <div key={`${order.id}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white bg-white px-3 py-3">
                                                                <div className="min-w-0">
                                                                    <p className="text-sm font-bold text-slate-900">{item.name}</p>
                                                                    <p className="mt-1 text-xs font-semibold text-slate-500">
                                                                        {item.quantity} {productUnitLabel(item.unit, item.name)} · {formatMoney(item.price)} c/u
                                                                    </p>
                                                                </div>
                                                                <div className="text-sm font-black text-slate-900">
                                                                    {formatMoney(item.quantity * item.price)}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
                                                        <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Total</span>
                                                        <span className="text-lg font-black text-slate-950">{formatMoney(order.total)}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {mobileCartOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="app-safe-modal fixed inset-0 z-[130] bg-slate-950/35 lg:hidden"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 24 }}
                            className="app-safe-panel mx-auto flex h-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-gray-100 bg-white shadow-2xl"
                        >
                            {renderCartPanel(true)}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="mx-auto max-w-[1720px] px-2 py-2 md:px-5 md:py-4">
                <div className="app-chat-height flex gap-4">
                <section className="flex-1 min-w-0 flex flex-col bg-white border border-gray-100 shadow-premium rounded-[1.4rem] md:rounded-3xl overflow-hidden font-sans relative">
                    <div className="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none -z-10" />

                    <header className="sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-gray-100 bg-white/95 px-3 py-2 backdrop-blur-xl sm:px-6 sm:py-4">
                        <div className="group flex min-w-0 items-center gap-2 sm:gap-4">
                            <div className="relative">
                                <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white shadow-premium sm:h-12 sm:w-12 sm:rounded-2xl">
                                    <Image
                                        src={publicConfig.logoUrl || "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png"}
                                        alt="El Verdulero"
                                        fill
                                        className="object-contain p-2"
                                    />
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-green-500 shadow-sm shadow-green-500/50 sm:-bottom-1 sm:-right-1 sm:h-4 sm:w-4 sm:border-4" />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 lg:gap-3">
                                    <div>
                                        <h1 className="truncate text-base font-black leading-none tracking-tight text-gray-900 sm:text-xl">El Verdulero</h1>
                                        <p className="mt-0.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-green-600 sm:mt-1 sm:text-[10px] sm:tracking-widest">
                                            <Sparkles size={10} /> En línea
                                        </p>
                                    </div>
                                    <div className="hidden max-w-full items-center gap-2 self-start rounded-2xl border border-green-200 bg-green-50 px-3 py-2 sm:inline-flex">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-green-600 shadow-sm">
                                            <CheckCircle2 size={15} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-green-700">Entrega</p>
                                            <p className="truncate text-[12px] font-black text-green-950">{deliverySchedule.fullWindowLabel}</p>
                                            <p className="mt-0.5 truncate text-[10px] font-bold text-green-700">{deliverySchedule.countdownLabel}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
                            <a
                                href={`https://wa.me/${(publicConfig.supportWhatsapp || "573176778089").replace(/\D/g, "")}?text=Hola%2C%20necesito%20ayuda%20con%20mi%20pedido`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center rounded-xl border border-green-200 bg-green-50 px-2.5 py-2 text-[10px] font-black uppercase tracking-wide text-green-700 transition-colors hover:bg-green-100 sm:px-3 sm:text-[11px]"
                            >
                                Agente
                            </a>
                            <button
                                type="button"
                                onClick={() => setMobileCartOpen(true)}
                                className="rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 text-[10px] font-black uppercase tracking-wide text-gray-700 transition hover:bg-gray-100 sm:px-3 sm:text-[11px] lg:hidden"
                            >
                                {cartItems.length ? formatMoney(cartTotal) : "Canasta"}
                            </button>
                            <button className="relative hidden h-10 w-10 items-center justify-center rounded-xl text-gray-400 transition-all duration-300 hover:bg-gray-50 hover:text-gray-900 sm:flex">
                                <ShoppingBasket size={22} />
                                {cartItems.length > 0 && (
                                    <span className="absolute -top-1 -right-1 text-[10px] bg-primary text-white w-5 h-5 rounded-full flex items-center justify-center font-bold">
                                        {cartItems.length}
                                    </span>
                                )}
                            </button>
                        </div>
                    </header>

                    <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3 sm:space-y-8 sm:px-6 sm:py-6">
                        <AnimatePresence>
                            {messages.map((m, i) => (
                                m.hidden ? null : (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
                                    className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}
                                >
                                    <div className="flex items-center gap-2 mb-2 px-1">
                                        {m.role === "assistant" && <div className="p-1 bg-primary/10 rounded px-1.5"><Bot size={10} className="text-primary" /></div>}
                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                            {m.role === "assistant" ? "El Verdulero" : "Tú"}
                                        </span>
                                        {m.role === "user" && <div className="p-1 bg-gray-100 rounded px-1.5"><User size={10} className="text-gray-500" /></div>}
                                    </div>
                                    <div className={cn(
                                        "max-w-[92%] rounded-[1.35rem] p-3 text-sm font-medium leading-relaxed shadow-sm sm:max-w-[85%] sm:rounded-[2rem] sm:p-5",
                                        m.role === "assistant"
                                            ? "bg-white border border-gray-100 text-gray-800 rounded-tl-none"
                                            : "bg-primary text-white rounded-tr-none shadow-lg shadow-primary/20"
                                    )}>
                                        {m.role === "assistant" ? renderAssistantMessage(m.content, sendQuickReply, isLoading) : <p className="whitespace-pre-line">{m.content}</p>}
                                    </div>
                                    {m.role === "assistant" && shouldShowCheckoutDecisionButtons(m.content) && (
                                        <div className="mt-3 flex w-full max-w-[85%] justify-start gap-2">
                                            <button
                                                type="button"
                                                onClick={() => sendQuickReply("sí")}
                                                disabled={isLoading}
                                                className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                Sí
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => sendQuickReply("no")}
                                                disabled={isLoading}
                                                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                No
                                            </button>
                                        </div>
                                    )}
                                    {m.role === "assistant" && cartItems.length > 0 && shouldShowFinalizeOrderButton(m.content) && (
                                        <div className="mt-3 flex w-full max-w-[92%] flex-col items-start gap-1 sm:max-w-[85%]">
                                            <button
                                                type="button"
                                                onClick={handleCheckoutClick}
                                                disabled={isLoading || !minimumMet}
                                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-green-600 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-lg shadow-green-600/20 transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
                                            >
                                                <CheckCircle2 size={15} />
                                                Finalizar pedido
                                            </button>
                                            {!minimumMet && minimumOrder > 0 && (
                                                <p className="pl-1 text-[11px] font-bold text-amber-700">
                                                    Falta {formatMoney(minimumShortfall)} para el pedido mínimo.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {ERROR_REPORTING_UI_ENABLED && (
                                        <div className={cn("mt-1 flex w-full max-w-[85%]", m.role === "user" ? "justify-end" : "justify-start")}>
                                            <button
                                                type="button"
                                                onClick={() => openErrorReportModal(m, i)}
                                                disabled={!!reportedKeys[`${i}-${m.role}-${m.content}`] || reportingKey === `${i}-${m.role}-${m.content}`}
                                                className={cn(
                                                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] transition-colors",
                                                    reportedKeys[`${i}-${m.role}-${m.content}`]
                                                        ? "border-amber-200 bg-amber-50 text-amber-700"
                                                        : "border-rose-200 bg-white/80 text-rose-600 hover:bg-rose-50",
                                                    reportingKey === `${i}-${m.role}-${m.content}` && "opacity-60"
                                                )}
                                            >
                                                <ShieldAlert size={11} />
                                                {reportedKeys[`${i}-${m.role}-${m.content}`] ? "Error reportado" : "Reportar error"}
                                            </button>
                                        </div>
                                    )}
                                </motion.div>
                                )
                            ))}
                        </AnimatePresence>

                        {isLoading && (
                            <div className="flex items-center gap-3 bg-gray-50/50 w-fit px-6 py-4 rounded-[1.5rem] border border-gray-100">
                                <div className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" />
                                    <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:120ms]" />
                                    <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:240ms]" />
                                </div>
                                <span className="text-xs font-black uppercase tracking-widest text-primary/60">El Verdulero está escribiendo...</span>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="app-chat-composer sticky bottom-0 z-50 border-t border-gray-100 bg-white/95 px-3 pt-2 backdrop-blur-xl sm:px-6 sm:pt-4">
                        {cartItems.length > 0 && (
                            <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-green-100 bg-green-50 px-3 py-2.5 md:hidden">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Tu canasta</p>
                                    <p className="mt-1 text-sm font-black text-green-950">{cartItems.length} productos · {formatMoney(cartTotal)}</p>
                                    {!minimumMet && minimumOrder > 0 && (
                                        <p className="mt-1 text-[11px] font-bold text-amber-700">
                                            Te faltan {formatMoney(minimumShortfall)} para el pedido mínimo.
                                        </p>
                                    )}
                                    {minimumMet && !freeShippingMet && freeShippingFrom > 0 && (
                                        <p className="mt-1 text-[11px] font-bold text-sky-700">
                                            Te faltan {formatMoney(freeShippingShortfall)} para envío gratis.
                                        </p>
                                    )}
                                    {selectedCityLabel && (
                                        <p className="mt-1 text-[11px] font-semibold text-slate-500">
                                            {freeShippingMet
                                                ? `Domicilio en ${selectedCityLabel}: GRATIS`
                                                : `Domicilio en ${selectedCityLabel}: ${formatMoney(estimatedShipping)}`}
                                        </p>
                                    )}
                                </div>
                                {!minimumMet && (
                                    <button
                                        type="button"
                                        onClick={() => setMobileCartOpen(true)}
                                        disabled={isLoading}
                                        className="shrink-0 rounded-2xl bg-green-600 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-white disabled:opacity-60"
                                    >
                                        Ver
                                    </button>
                                )}
                            </div>
                        )}
                        {cartItems.length > 0 && (
                            <div className="mb-4 hidden rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:block">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Estado del pedido</p>
                                        {!minimumMet && minimumOrder > 0 ? (
                                            <p className="mt-1 text-sm font-black text-amber-800">
                                                Te faltan {formatMoney(minimumShortfall)} para llegar al pedido mínimo.
                                            </p>
                                        ) : freeShippingMet ? (
                                            <p className="mt-1 text-sm font-black text-emerald-800">
                                                Ya cumples el mínimo y tu pedido va con envío gratis.
                                            </p>
                                        ) : (
                                            <p className="mt-1 text-sm font-black text-sky-800">
                                                Ya cumples el mínimo. Te faltan {formatMoney(freeShippingShortfall)} para envío gratis.
                                            </p>
                                        )}
                                    </div>
                                    {freeShippingFrom > 0 && (
                                        <div className="w-full md:max-w-[260px]">
                                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-sky-700">
                                                <span>Barra envío gratis</span>
                                                <span>{Math.min(100, freeShippingProgress)}%</span>
                                            </div>
                                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-100">
                                                <div
                                                    className={cn(
                                                        "h-full rounded-full transition-all duration-500",
                                                        freeShippingMet ? "bg-emerald-500" : "bg-sky-500"
                                                    )}
                                                    style={{ width: `${Math.min(100, freeShippingProgress)}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <form onSubmit={handleSubmit} className="relative flex gap-2 group">
                            <input
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="¿Qué te vamos a poner en la canasta?"
                                className="flex-1 rounded-2xl border border-gray-100/70 bg-gray-50/80 px-4 py-3 text-sm font-semibold outline-none transition-all duration-300 placeholder:text-gray-400 focus:border-primary/30 focus:bg-white focus:shadow-premium sm:rounded-3xl sm:px-6 sm:py-4"
                            />
                            <button
                                type="submit"
                                disabled={isLoading || !input.trim()}
                                className="rounded-2xl bg-primary p-3 text-white shadow-xl shadow-primary/30 transition-all disabled:opacity-30 sm:rounded-3xl sm:p-4"
                            >
                                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                            </button>
                        </form>
                        <a
                            href="https://cuantium.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 block text-center text-[8px] font-semibold leading-none text-gray-300 transition hover:text-emerald-700 sm:mt-2 sm:text-[10px]"
                        >
                            Desarrollado por Cuantium - Wibi™
                        </a>
                    </div>
                </section>

                <aside className="hidden xl:flex w-[330px] bg-white border border-gray-100 shadow-premium rounded-3xl overflow-hidden">
                    {renderCatalogPanel(false)}
                </aside>

                <aside className="hidden lg:flex w-[380px] bg-white border border-gray-100 shadow-premium rounded-3xl flex-col overflow-hidden">
                    {renderCartPanel(false)}
                </aside>
                </div>
            </div>
        </main>
    );
}
