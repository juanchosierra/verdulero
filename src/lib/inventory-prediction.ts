import { prisma } from "@/lib/prisma";
import { getCatalogMeasureProfile } from "@/lib/catalog";

type OrderItem = {
  product_id?: number;
  name?: string;
  quantity?: number;
  unit?: string;
  price?: number;
  image?: string | null;
};

type ProductAggregate = {
  key: string;
  productId: number | null;
  name: string;
  unit: string;
  image: string | null;
  revenueToday: number;
  revenue7d: number;
  revenue30d: number;
  qtyToday: number;
  qty7d: number;
  qty30d: number;
  orderCountToday: number;
  orderCount7d: number;
  orderCount30d: number;
  perDay: Map<string, number>;
};

type CustomerAggregate = {
  customerName: string;
  customerCity: string;
  orders30d: number;
  total30d: number;
  favoriteProducts: Map<string, number>;
};

function bogotaDateKey(dateLike: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(dateLike));
}

function startOfTodayBogota() {
  return bogotaDateKey(new Date());
}

function daysAgoKey(daysAgo: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return bogotaDateKey(d);
}

function normalizeItemName(name: string) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function safeParseItems(raw: string): OrderItem[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function roundForUnit(value: number, unit: string) {
  const profile = getCatalogMeasureProfile(unit);
  if (value <= 0) return 0;
  if (profile.wholeOnly) return Math.ceil(value);
  const step = profile.step || 0.5;
  return Math.ceil(value / step) * step;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function dayOfWeekInBogota(dateKey: string) {
  return new Date(`${dateKey}T12:00:00-05:00`).getDay();
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export async function getInventoryPredictionSnapshot() {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90)
      }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      customerName: true,
      customerCity: true,
      total: true,
      status: true,
      items: true
    }
  });

  const todayKey = startOfTodayBogota();
  const key7 = daysAgoKey(6);
  const key30 = daysAgoKey(29);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowWeekday = tomorrow.getDay();

  const productMap = new Map<string, ProductAggregate>();
  const customerMap = new Map<string, CustomerAggregate>();
  const dailySeriesMap = new Map<string, { qty: number; revenue: number; orders: Set<number> }>();

  for (const order of orders) {
    const dateKey = bogotaDateKey(order.createdAt);
    const items = safeParseItems(order.items);
    const in7 = dateKey >= key7;
    const in30 = dateKey >= key30;
    const inToday = dateKey === todayKey;

    if (in30) {
      const customerKey = `${order.customerName}__${order.customerCity}`;
      const customer = customerMap.get(customerKey) || {
        customerName: order.customerName,
        customerCity: order.customerCity,
        orders30d: 0,
        total30d: 0,
        favoriteProducts: new Map<string, number>()
      };
      customer.orders30d += 1;
      customer.total30d += Number(order.total || 0);
      customerMap.set(customerKey, customer);

      for (const rawItem of items) {
        const itemName = normalizeItemName(rawItem.name || "");
        if (!itemName) continue;
        customer.favoriteProducts.set(itemName, (customer.favoriteProducts.get(itemName) || 0) + Number(rawItem.quantity || 0));
      }
    }

    for (const rawItem of items) {
      const name = normalizeItemName(rawItem.name || "");
      const quantity = Number(rawItem.quantity || 0);
      const unit = String(rawItem.unit || "und").trim() || "und";
      const price = Number(rawItem.price || 0);
      const image = typeof rawItem.image === "string" ? rawItem.image : null;
      const productId = Number(rawItem.product_id || 0) || null;
      if (!name || !Number.isFinite(quantity) || quantity <= 0) continue;

      const key = productId ? `id:${productId}` : `name:${name.toLowerCase()}`;
      const product = productMap.get(key) || {
        key,
        productId,
        name,
        unit,
        image,
        revenueToday: 0,
        revenue7d: 0,
        revenue30d: 0,
        qtyToday: 0,
        qty7d: 0,
        qty30d: 0,
        orderCountToday: 0,
        orderCount7d: 0,
        orderCount30d: 0,
        perDay: new Map<string, number>()
      };

      product.perDay.set(dateKey, (product.perDay.get(dateKey) || 0) + quantity);
      if (!product.image && image) product.image = image;

      if (inToday) {
        product.qtyToday += quantity;
        product.revenueToday += quantity * price;
        product.orderCountToday += 1;
      }
      if (in7) {
        product.qty7d += quantity;
        product.revenue7d += quantity * price;
        product.orderCount7d += 1;
      }
      if (in30) {
        product.qty30d += quantity;
        product.revenue30d += quantity * price;
        product.orderCount30d += 1;
      }

      productMap.set(key, product);

      const series = dailySeriesMap.get(dateKey) || { qty: 0, revenue: 0, orders: new Set<number>() };
      series.qty += quantity;
      series.revenue += quantity * price;
      series.orders.add(order.id);
      dailySeriesMap.set(dateKey, series);
    }
  }

  const products = Array.from(productMap.values());
  const todayProducts = products.filter((p) => p.qtyToday > 0).sort((a, b) => b.qtyToday - a.qtyToday || b.revenueToday - a.revenueToday).slice(0, 20);
  const weeklyProducts = products.filter((p) => p.qty7d > 0).sort((a, b) => b.qty7d - a.qty7d || b.revenue7d - a.revenue7d).slice(0, 25);
  const monthlyProducts = products.filter((p) => p.qty30d > 0).sort((a, b) => b.qty30d - a.qty30d || b.revenue30d - a.revenue30d).slice(0, 25);

  const forecasts = products
    .map((product) => {
      const perDayEntries = Array.from(product.perDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const last7Values = perDayEntries.filter(([dateKey]) => dateKey >= key7).map(([, qty]) => qty);
      const prev7CutoffStart = daysAgoKey(13);
      const prev7CutoffEnd = daysAgoKey(7);
      const prev7Values = perDayEntries.filter(([dateKey]) => dateKey >= prev7CutoffStart && dateKey <= prev7CutoffEnd).map(([, qty]) => qty);
      const sameWeekdayValues = perDayEntries
        .filter(([dateKey]) => dayOfWeekInBogota(dateKey) === tomorrowWeekday)
        .slice(-4)
        .map(([, qty]) => qty);

      const avg7 = average(last7Values);
      const avgPrev7 = average(prev7Values);
      const sameWeekdayAvg = average(sameWeekdayValues);
      const trendBase = avgPrev7 > 0 ? (avg7 - avgPrev7) / avgPrev7 : 0;
      const boundedTrend = Math.max(-0.35, Math.min(0.5, trendBase));
      const rawForecast = (sameWeekdayAvg * 0.6) + (avg7 * 0.4);
      const adjustedForecast = Math.max(0, rawForecast * (1 + boundedTrend * 0.35));
      const suggestedBuy = roundForUnit(adjustedForecast * 1.12, product.unit);
      const avgDailyDemand = avg7 > 0 ? avg7 : adjustedForecast > 0 ? adjustedForecast : 0;
      const coverageDays = avgDailyDemand > 0 ? Number((suggestedBuy / avgDailyDemand).toFixed(1)) : 0;
      const coverageDate = coverageDays > 0
        ? addDays(tomorrow, Math.max(0, Math.ceil(coverageDays) - 1)).toISOString()
        : null;

      return {
        name: product.name,
        unit: product.unit,
        image: product.image,
        qty7d: product.qty7d,
        qty30d: product.qty30d,
        avg7: Number(avg7.toFixed(2)),
        sameWeekdayAvg: Number(sameWeekdayAvg.toFixed(2)),
        trendPct: Number((boundedTrend * 100).toFixed(1)),
        forecastQty: Number(adjustedForecast.toFixed(2)),
        suggestedBuy: Number(suggestedBuy.toFixed(2)),
        coverageDays,
        coverageDate
      };
    })
    .filter((item) => item.forecastQty > 0)
    .sort((a, b) => b.forecastQty - a.forecastQty)
    .slice(0, 25);

  const customers = Array.from(customerMap.values())
    .map((customer) => ({
      customerName: customer.customerName,
      customerCity: customer.customerCity,
      orders30d: customer.orders30d,
      total30d: customer.total30d,
      favoriteProducts: Array.from(customer.favoriteProducts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name]) => name)
    }))
    .sort((a, b) => b.orders30d - a.orders30d || b.total30d - a.total30d)
    .slice(0, 20);

  const dailySeries = Array.from(dailySeriesMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([dateKey, value]) => ({
      dateKey,
      qty: value.qty,
      revenue: value.revenue,
      orders: value.orders.size
    }));

  const summary = {
    productsSoldToday: todayProducts.length,
    qtySoldToday: Number(todayProducts.reduce((acc, item) => acc + item.qtyToday, 0).toFixed(2)),
    qtySold7d: Number(weeklyProducts.reduce((acc, item) => acc + item.qty7d, 0).toFixed(2)),
    qtySold30d: Number(monthlyProducts.reduce((acc, item) => acc + item.qty30d, 0).toFixed(2)),
    forecastProducts: forecasts.length,
    totalSuggestedBuy: Number(forecasts.reduce((acc, item) => acc + item.suggestedBuy, 0).toFixed(2))
  };

  return {
    summary,
    todayProducts,
    weeklyProducts,
    monthlyProducts,
    forecasts,
    customers,
    dailySeries,
    generatedAt: new Date().toISOString()
  };
}
