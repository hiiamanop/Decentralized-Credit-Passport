import type { TransactionEvent } from "../data-gateway/types.js";

export type FeatureWindow = {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
};

export type EngineeredFeatures = {
  feature_version: "tx_features_v1";
  window: FeatureWindow;

  tx_count_total: number;
  tx_count_in: number;
  tx_count_out: number;
  active_days: number;

  monthly_revenue_mean_minor: number;
  monthly_revenue_cv: number;
  revenue_stability: number;

  tx_frequency_per_day: number;
  avg_tx_size_minor: number;

  seasonality_index: number;
  cashflow_consistency: number;
  inflow_outflow_ratio: number;

  sources: Record<string, number>;
  channels: Record<string, number>;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function std(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const v = nums.reduce((a, b) => a + (b - m) * (b - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

export function engineerTransactionFeatures(args: {
  events: TransactionEvent[];
  windowDays: number;
  now?: Date;
}): EngineeredFeatures {
  const now = args.now ?? new Date();
  const windowDays = Math.max(1, Math.min(365, Math.floor(args.windowDays || 90)));
  const windowEnd = new Date(now);
  const windowStart = new Date(windowEnd);
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays);

  const events = args.events.filter((e) => {
    const d = safeDate(e.occurred_at);
    if (!d) return false;
    return d >= windowStart && d <= windowEnd;
  });

  const sources: Record<string, number> = {};
  const channels: Record<string, number> = {};
  const activeDays = new Set<string>();

  const monthlyInflow: Record<string, number> = {};
  const monthlyOutflow: Record<string, number> = {};

  let txIn = 0;
  let txOut = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const e of events) {
    sources[e.source] = (sources[e.source] ?? 0) + 1;
    channels[e.channel] = (channels[e.channel] ?? 0) + 1;

    const d = safeDate(e.occurred_at);
    if (!d) continue;
    activeDays.add(dayKey(d));
    const mk = monthKey(d);

    const amt = Math.max(0, Math.floor(e.money.amount_minor || 0));
    if (e.direction === "in") {
      txIn += 1;
      totalIn += amt;
      monthlyInflow[mk] = (monthlyInflow[mk] ?? 0) + amt;
    } else {
      txOut += 1;
      totalOut += amt;
      monthlyOutflow[mk] = (monthlyOutflow[mk] ?? 0) + amt;
    }
  }

  const monthKeys = Array.from(
    new Set<string>([...Object.keys(monthlyInflow), ...Object.keys(monthlyOutflow)])
  ).sort();

  const monthlyRevenue = monthKeys.map((k) => monthlyInflow[k] ?? 0);
  const monthlyNet = monthKeys.map((k) => (monthlyInflow[k] ?? 0) - (monthlyOutflow[k] ?? 0));

  const revenueMean = mean(monthlyRevenue);
  const revenueStd = std(monthlyRevenue);
  const revenueCv = revenueMean > 0 ? revenueStd / revenueMean : 0;
  const revenueStability = clamp01(1 - revenueCv);

  const txTotal = events.length;
  const txFrequencyPerDay = txTotal / windowDays;
  const avgTxSize = txIn > 0 ? Math.floor(totalIn / txIn) : 0;

  const maxRevenue = monthlyRevenue.length ? Math.max(...monthlyRevenue) : 0;
  const seasonalityIndex = revenueMean > 0 ? maxRevenue / revenueMean : 0;

  const activeMonthCount = monthKeys.length || 1;
  const positiveNetMonths = monthlyNet.filter((n) => n > 0).length;
  const cashflowConsistency = clamp01(positiveNetMonths / activeMonthCount);

  const inflowOutflowRatio = totalOut > 0 ? totalIn / totalOut : totalIn > 0 ? 10 : 0;

  return {
    feature_version: "tx_features_v1",
    window: { windowDays, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() },
    tx_count_total: txTotal,
    tx_count_in: txIn,
    tx_count_out: txOut,
    active_days: activeDays.size,
    monthly_revenue_mean_minor: Math.floor(revenueMean),
    monthly_revenue_cv: Number.isFinite(revenueCv) ? revenueCv : 0,
    revenue_stability: revenueStability,
    tx_frequency_per_day: txFrequencyPerDay,
    avg_tx_size_minor: avgTxSize,
    seasonality_index: Number.isFinite(seasonalityIndex) ? seasonalityIndex : 0,
    cashflow_consistency: cashflowConsistency,
    inflow_outflow_ratio: Number.isFinite(inflowOutflowRatio) ? inflowOutflowRatio : 0,
    sources,
    channels,
  };
}

