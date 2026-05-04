"use client";

import { useEffect, useState } from 'react';
import {
  BarChart2,
  TrendingUp,
  ShoppingBasket,
  MessageSquare,
  ShieldCheck,
  Loader2,
  Calendar,
  Mail,
  Send,
  FileText,
  Bot,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCcw,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function ReportsPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [reportConfig, setReportConfig] = useState({
    reportesVentasActivos: false,
    reportesVentasHora: '18:00',
    reportesVentasEmails: '',
  });
  const [savingReports, setSavingReports] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);

  const loadStats = async () => {
    return fetch('/api/admin/stats')
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setStats(data);
          setReportConfig({
            reportesVentasActivos: data?.reports?.enabled || false,
            reportesVentasHora: data?.reports?.hour || '18:00',
            reportesVentasEmails: data?.reports?.emails || '',
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleReset = async () => {
    if (!confirm('¿Seguro que quieres reiniciar chats, pedidos y métricas a cero?')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      if (res.ok) {
        await loadStats();
      }
    } finally {
      setResetting(false);
    }
  };

  const handleSaveReports = async () => {
    setSavingReports(true);
    try {
      await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportConfig),
      });
      await loadStats();
    } finally {
      setSavingReports(false);
    }
  };

  const handleSendNow = async () => {
    setSendingReport(true);
    try {
      await fetch('/api/admin/sales-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-now' }),
      });
      await loadStats();
    } finally {
      setSendingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
        <p className="text-sm font-black uppercase tracking-widest text-slate-400">Cargando datos reales...</p>
      </div>
    );
  }

  const totals = stats?.totals || { salesToday: 0, sales: 0, pending: 0, chats: 0, orders: 0, conversion: 0, completed: 0 };
  const chart = stats?.chart || [];
  const reports = stats?.reports || {};
  const operations = stats?.operations || {};
  const maxSales = Math.max(...chart.map((d: any) => d.sales || 0), 1);
  const reportRecipients = String(reports.emails || '').split(',').map((email: string) => email.trim()).filter(Boolean);
  const copyRecipients = String(operations.copyEmails || '').split(',').map((email: string) => email.trim()).filter(Boolean);

  return (
    <div className="mb-20 flex min-h-screen flex-1 flex-col overflow-x-hidden bg-[#F8FAFC]/50 font-sans animate-in fade-in duration-500">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-slate-900 p-2.5 text-white">
            <BarChart2 size={18} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-black uppercase tracking-widest text-slate-900">Inteligencia de negocio</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase italic tracking-tighter text-slate-400">
              <Calendar size={10} /> {new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_green]" />
            <span className="text-[10px] font-black uppercase text-emerald-700">Datos reales</span>
          </div>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-[10px] font-black uppercase text-rose-700 disabled:opacity-50"
          >
            {resetting ? 'Reiniciando...' : 'Reiniciar datos'}
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 md:p-8">
        <section className="rounded-[2rem] border border-amber-200 bg-amber-50 px-6 py-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Modo honesto</p>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-900">
            Este módulo ahora muestra solo métricas y estados que salen de la base o de la configuración guardada. Si algo no está medido, no lo vamos a maquillar.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <StatMiniCard label="Ventas hoy" value={`$${(totals.salesToday || 0).toLocaleString()}`} icon={<ShoppingBasket className="text-emerald-600" />} helper={`${totals.orders || 0} pedidos creados`} />
          <StatMiniCard label="Conversión" value={`${totals.conversion}%`} icon={<TrendingUp className="text-blue-600" />} helper={`${totals.completed || 0} pedidos completados`} />
          <StatMiniCard label="Chats activos" value={String(totals.chats || 0)} icon={<MessageSquare className="text-purple-600" />} helper={`${totals.pending || 0} pedidos pendientes`} />
          <StatMiniCard label="Ventas acumuladas" value={`$${(totals.sales || 0).toLocaleString()}`} icon={<ShieldCheck className="text-orange-600" />} helper="Total histórico guardado" />
        </section>

        <section className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="group relative overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white p-10 shadow-premium lg:col-span-8">
            <div className="mb-12 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black uppercase italic tracking-widest text-slate-900">Ventas de los últimos 7 días</h3>
                <p className="mt-1 text-xs font-bold uppercase text-slate-400">Basado en pedidos guardados</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase text-slate-400">
                7 días
              </div>
            </div>

            <div className="flex h-64 items-end justify-between gap-4 px-4">
              {chart.map((d: any, i: number) => {
                const height = Math.max((d.sales / maxSales) * 100, d.sales > 0 ? 8 : 2);
                return (
                  <div key={i} className="group/bar flex h-full flex-1 flex-col items-center justify-end gap-4">
                    <div className="relative flex h-[100%] w-full flex-col justify-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ duration: 0.8, delay: i * 0.06 }}
                        className={cn(
                          'relative w-full rounded-t-xl bg-gradient-to-t transition-all duration-500',
                          i === chart.length - 1
                            ? 'from-emerald-600 to-emerald-400'
                            : 'from-slate-100 to-slate-50 group-hover/bar:from-emerald-100 group-hover/bar:to-emerald-50'
                        )}
                      >
                        <div className="absolute -top-10 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[9px] font-black text-white shadow-xl group-hover/bar:block">
                          ${Number(d.sales || 0).toLocaleString()} · {d.orders || 0} pedidos
                        </div>
                      </motion.div>
                    </div>
                    <span className="text-[10px] font-black uppercase italic leading-none text-slate-300">{d.day}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-6 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-premium lg:col-span-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl border',
                operations.aiPaused ? 'border-amber-100 bg-amber-50 text-amber-600' : 'border-emerald-100 bg-emerald-50 text-emerald-600'
              )}>
                {operations.aiPaused ? <AlertTriangle size={22} /> : <Bot size={22} />}
              </div>
              <div>
                <h3 className="text-sm font-black uppercase italic tracking-widest text-slate-900">Operación del bot</h3>
                <p className="text-[11px] font-bold uppercase tracking-tighter text-slate-400">Estado real guardado en configuración</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <RealStatusTile label="IA" value={operations.aiPaused ? 'Pausada' : 'Activa'} tone={operations.aiPaused ? 'warning' : 'ok'} />
              <RealStatusTile label="Hora de corte" value={operations.cutoffHour || 'Sin definir'} tone={operations.cutoffHour ? 'ok' : 'warning'} />
              <RealStatusTile label="Woo" value={operations.wooConfigured ? 'Configurado' : 'Falta revisar'} tone={operations.wooConfigured ? 'ok' : 'warning'} />
              <RealStatusTile label="Correo admin" value={operations.adminEmail ? 'Configurado' : 'Falta revisar'} tone={operations.adminEmail ? 'ok' : 'warning'} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lectura operativa</p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
                {operations.aiPaused
                  ? 'La IA está pausada manualmente. Antes de reactivarla conviene revisar errores, chats y pedidos pendientes.'
                  : 'La IA está atendiendo con la configuración actual. Si algo del comportamiento no convence, se ajusta desde Ajustes.'}
              </p>
            </div>

            <Link href="/admin/settings" className="mt-auto flex items-center justify-center rounded-2xl bg-slate-900 py-3 text-[11px] font-black uppercase tracking-widest text-white transition-all active:scale-95 hover:bg-slate-800">
              Abrir ajustes reales <ChevronRight size={14} className="ml-2" />
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-6 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-premium">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">
                <Settings2 size={22} />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase italic tracking-widest text-slate-900">Configuración verificada</h4>
                <p className="text-[11px] font-bold uppercase tracking-tighter text-slate-400">Chequeos directos sobre la configuración</p>
              </div>
            </div>

            <div className="space-y-3">
              <SystemCheckRow label="WooCommerce enlazado" ok={Boolean(operations.wooConfigured)} detail={operations.wooConfigured ? 'La URL de la tienda está guardada.' : 'Falta guardar la URL o revisar las llaves en Ajustes.'} />
              <SystemCheckRow label="Prompt del bot" ok={Boolean(operations.promptConfigured)} detail={operations.promptConfigured ? 'Hay instrucciones maestras guardadas.' : 'Falta prompt maestro para el bot.'} />
              <SystemCheckRow label="Saludo inicial" ok={Boolean(operations.greetingConfigured)} detail={operations.greetingConfigured ? 'El mensaje de bienvenida está configurado.' : 'Falta mensaje de bienvenida.'} />
            </div>
          </div>

          <div className="flex flex-col gap-6 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-premium">
            <div className="flex items-center gap-4">
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-2xl border',
                operations.aiPaused ? 'border-amber-100 bg-amber-50 text-amber-600' : 'border-emerald-100 bg-emerald-50 text-emerald-600'
              )}>
                <RefreshCcw size={22} />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase italic tracking-widest text-slate-900">Intervención humana</h4>
                <p className="text-[11px] font-bold uppercase tracking-tighter text-slate-400">Estado manual y correos extra</p>
              </div>
            </div>

            <div className={cn(
              'rounded-2xl border p-4',
              operations.aiPaused ? 'border-amber-100 bg-amber-50' : 'border-emerald-100 bg-emerald-50'
            )}>
              <p className={cn(
                'text-sm font-black uppercase tracking-wide',
                operations.aiPaused ? 'text-amber-700' : 'text-emerald-700'
              )}>
                {operations.aiPaused ? 'Intervención manual encendida' : 'Sin intervención manual'}
              </p>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
                {operations.aiPaused
                  ? 'Hoy el operador dejó la IA pausada desde ajustes.'
                  : 'El sistema no registra pausa manual en este momento.'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correos de copia</p>
              <p className="mt-2 break-words text-sm font-semibold text-slate-700">
                {copyRecipients.length > 0 ? copyRecipients.join(', ') : 'No hay correos adicionales configurados.'}
              </p>
            </div>

            <Link href="/admin/errors" className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-600">
              Revisar errores reportados <ChevronRight size={14} />
            </Link>
          </div>
        </section>

        <section className="space-y-6 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-premium">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                  <Mail size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase italic tracking-widest text-slate-900">Reportes de ventas por correo</h3>
                  <p className="text-[11px] font-bold uppercase tracking-tighter text-slate-400">Configuración, destinatarios y último intento</p>
                </div>
              </div>
              <p className="max-w-2xl text-sm font-semibold leading-relaxed text-slate-500">
                Aquí programamos a qué correos mandar el PDF, a qué hora guardarlo y también podemos disparar un envío manual de prueba.
              </p>
            </div>

            <div className="grid min-w-[340px] grid-cols-3 gap-3">
              <MiniInfo label="Destinatarios" value={`${reports.recipientsCount || 0}`} />
              <MiniInfo label="Pedidos hoy" value={`${reports.todayOrders || 0}`} />
              <MiniInfo label="Ventas hoy" value={`$${(reports.todaySales || 0).toLocaleString()}`} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:col-span-3">
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Activar envío automático</label>
                <button
                  type="button"
                  onClick={() => setReportConfig((prev) => ({ ...prev, reportesVentasActivos: !prev.reportesVentasActivos }))}
                  className={cn(
                    'relative h-8 w-14 rounded-full ring-2 ring-white transition-colors duration-300 shadow-inner',
                    reportConfig.reportesVentasActivos ? 'bg-emerald-500' : 'bg-slate-300'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-1 h-6 w-6 rounded-full bg-white transition-all duration-300',
                      reportConfig.reportesVentasActivos ? 'left-7' : 'left-1'
                    )}
                  />
                </button>
                <p className="text-xs font-semibold text-slate-500">
                  {reportConfig.reportesVentasActivos
                    ? 'La programación queda activa y guardada en la base.'
                    : 'La programación está pausada por ahora.'}
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Hora de envío</label>
                <input
                  type="time"
                  value={reportConfig.reportesVentasHora}
                  onChange={(e) => setReportConfig((prev) => ({ ...prev, reportesVentasHora: e.target.value }))}
                  className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10"
                />
                <p className="text-xs font-semibold text-slate-500">
                  La hora se guarda aquí. La automatización depende del scheduler disponible en la infraestructura.
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 md:col-span-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Correos destino</label>
                <textarea
                  rows={3}
                  value={reportConfig.reportesVentasEmails}
                  onChange={(e) => setReportConfig((prev) => ({ ...prev, reportesVentasEmails: e.target.value }))}
                  placeholder="gerencia@dominio.com, operaciones@dominio.com"
                  className="block w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/10"
                />
                <p className="text-xs font-semibold text-slate-500">Separa varios correos con coma. También se suma el correo admin si está configurado.</p>
              </div>
            </div>

            <div className="flex flex-col gap-5 rounded-[2rem] bg-slate-900 p-6 text-white lg:col-span-2">
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">Último intento de envío</p>
                {reports.lastDispatch ? (
                  <>
                    <p className="text-lg font-black tracking-tight">{reports.lastDispatch.period}</p>
                    <p className="text-xs font-semibold text-white/70">{reports.lastDispatch.summary}</p>
                    <p className="break-words text-[11px] font-bold text-white/50">{reports.lastDispatch.recipients}</p>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-white/70">Todavía no hay envíos registrados.</p>
                )}
              </div>

              <div className="mt-auto flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleSaveReports}
                  disabled={savingReports}
                  className="w-full rounded-2xl bg-emerald-600 py-3 text-[11px] font-black uppercase tracking-widest transition-all hover:bg-emerald-500 disabled:opacity-50"
                >
                  {savingReports ? 'Guardando...' : 'Guardar programación'}
                </button>
                <button
                  type="button"
                  onClick={handleSendNow}
                  disabled={sendingReport}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 py-3 text-[11px] font-black uppercase tracking-widest transition-all hover:bg-white/15 disabled:opacity-50"
                >
                  {sendingReport ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {sendingReport ? 'Enviando...' : 'Enviar PDF ahora'}
                </button>
                <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <FileText size={18} className="mt-0.5 text-emerald-400" />
                  <p className="text-xs font-semibold leading-relaxed text-white/75">
                    El PDF sale con ventas del día, cantidad de pedidos, estados y total vendido. Si SMTP falla, aquí queda registrado el último intento.
                  </p>
                </div>
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Destinatarios guardados</p>
                  <p className="break-words text-xs font-semibold text-white/75">
                    {reportRecipients.length > 0 ? reportRecipients.join(', ') : 'No hay correos configurados todavía.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatMiniCard({ label, value, icon, helper }: any) {
  return (
    <div className="group flex flex-col gap-6 rounded-[2rem] border border-slate-200 bg-white p-8 shadow-premium transition-all duration-300 hover:-translate-y-2">
      <div className="flex items-center justify-between">
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-slate-700 shadow-sm transition-all group-hover:border-emerald-100 group-hover:bg-emerald-50 group-hover:text-emerald-600">
          {icon}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase text-slate-500 shadow-sm">
          Real
        </div>
      </div>
      <div className="space-y-4">
        <p className="text-[10px] font-black uppercase italic tracking-widest leading-none text-slate-400">{label}</p>
        <h3 className="text-3xl font-black italic leading-none tracking-tighter text-slate-900">{value}</h3>
        <p className="text-xs font-semibold text-slate-500">{helper}</p>
      </div>
    </div>
  );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-2 text-base font-black tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

function RealStatusTile({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warning' }) {
  const ok = tone === 'ok';
  return (
    <div className={cn('rounded-2xl border p-4', ok ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50')}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <div className="mt-3 flex items-center gap-2">
        {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
        <p className={cn('text-sm font-black', ok ? 'text-emerald-700' : 'text-amber-700')}>{value}</p>
      </div>
    </div>
  );
}

function SystemCheckRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
          <p className="text-sm font-black text-slate-800">{label}</p>
        </div>
        <span className={cn('text-[10px] font-black uppercase tracking-widest', ok ? 'text-emerald-600' : 'text-amber-600')}>
          {ok ? 'OK' : 'Revisar'}
        </span>
      </div>
      <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p>
    </div>
  );
}
