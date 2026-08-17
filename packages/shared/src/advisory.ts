export type AdvisorySeverity = "stable" | "watch" | "urgent" | "insufficient";

export interface AdvisoryFlock {
  id: string;
  name: string;
  poultryType: string;
  initialCount: number;
  currentCount: number;
  startDate: string | null;
}

export interface AdvisoryRecord {
  flockId: string;
  recordDate: string;
  mortalityCount: number;
  cullingCount: number;
  feedKg: number | null;
  waterLiters: number | null;
  eggsCollected: number | null;
  averageWeightGrams: number | null;
}

export interface ManagementAlert {
  severity: Exclude<AdvisorySeverity, "insufficient">;
  title: string;
  observation: string;
  action: string;
}

export interface FlockAdvisory {
  flockId: string;
  flockName: string;
  severity: AdvisorySeverity;
  confidence: "low" | "medium" | "high";
  recordDays: number;
  ageWeeks: number | null;
  forecast: {
    mortalityNext2Days: number;
    feedKgNext2Days: number | null;
    eggsNext2Days: number | null;
  };
  alerts: ManagementAlert[];
  disclaimer: string;
}

type DailyTotals = {
  date: string;
  mortality: number;
  feed: number | null;
  water: number | null;
  eggs: number | null;
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function metricAverage(days: DailyTotals[], metric: keyof Omit<DailyTotals, "date">) {
  return average(days.map((day) => day[metric]).filter((value): value is number => value !== null));
}

function percentageChange(recent: number | null, baseline: number | null) {
  if (recent === null || baseline === null || baseline <= 0) return null;
  return (recent - baseline) / baseline;
}

function projectedTwoDayTotal(recent: number | null, baseline: number | null) {
  if (recent === null) return null;
  const dailyForecast = Math.max(0, recent + ((recent - (baseline ?? recent)) * 0.5));
  return Math.round(dailyForecast * 2 * 10) / 10;
}

function ageWeeks(startDate: string | null, latestDate: string | undefined) {
  if (!startDate || !latestDate) return null;
  const days = Math.floor((Date.parse(`${latestDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? Math.floor(days / 7) : null;
}

export function predictFlockManagement(flock: AdvisoryFlock, records: AdvisoryRecord[]): FlockAdvisory {
  const grouped = new Map<string, DailyTotals>();
  for (const record of records.filter((item) => item.flockId === flock.id)) {
    const current = grouped.get(record.recordDate) ?? { date: record.recordDate, mortality: 0, feed: null, water: null, eggs: null };
    current.mortality += record.mortalityCount + record.cullingCount;
    current.feed = record.feedKg === null ? current.feed : (current.feed ?? 0) + record.feedKg;
    current.water = record.waterLiters === null ? current.water : (current.water ?? 0) + record.waterLiters;
    current.eggs = record.eggsCollected === null ? current.eggs : (current.eggs ?? 0) + record.eggsCollected;
    grouped.set(record.recordDate, current);
  }

  const days = [...grouped.values()].sort((left, right) => left.date.localeCompare(right.date));
  const age = ageWeeks(flock.startDate, days.at(-1)?.date);
  const disclaimer = "Trend support only. Inspect birds and housing; contact a qualified poultry veterinarian for illness, sudden mortality, or treatment decisions.";
  if (days.length < 5) {
    return {
      flockId: flock.id,
      flockName: flock.name,
      severity: "insufficient",
      confidence: "low",
      recordDays: days.length,
      ageWeeks: age,
      forecast: { mortalityNext2Days: 0, feedKgNext2Days: null, eggsNext2Days: null },
      alerts: [],
      disclaimer
    };
  }

  const recentSize = Math.min(7, Math.max(3, Math.floor(days.length / 2)));
  const recent = days.slice(-recentSize);
  const baseline = days.slice(0, -recentSize).slice(-recentSize);
  const birdCount = Math.max(1, flock.currentCount || flock.initialCount);
  const mortalityRecent = metricAverage(recent, "mortality") ?? 0;
  const mortalityBaseline = metricAverage(baseline, "mortality") ?? 0;
  const feedRecent = metricAverage(recent, "feed");
  const feedBaseline = metricAverage(baseline, "feed");
  const waterRecent = metricAverage(recent, "water");
  const waterBaseline = metricAverage(baseline, "water");
  const eggsRecent = metricAverage(recent, "eggs");
  const eggsBaseline = metricAverage(baseline, "eggs");
  const mortalityChange = percentageChange(mortalityRecent, mortalityBaseline);
  const feedChange = percentageChange(feedRecent, feedBaseline);
  const waterChange = percentageChange(waterRecent, waterBaseline);
  const eggChange = percentageChange(eggsRecent, eggsBaseline);
  const mortalityPerThousand = mortalityRecent / birdCount * 1000;
  const alerts: ManagementAlert[] = [];

  if (mortalityPerThousand >= 5 || (mortalityChange !== null && mortalityChange >= 1)) {
    alerts.push({
      severity: "urgent",
      title: "Mortality trend needs same-day review",
      observation: `${mortalityPerThousand.toFixed(1)} deaths/culls per 1,000 birds/day in the latest window${mortalityChange === null ? "" : `, ${Math.round(mortalityChange * 100)}% above the prior window`}.`,
      action: "Check all houses for sick or injured birds, water access, feed availability, ventilation, heat stress, and predators. Isolate visibly unwell birds according to the farm plan and contact a qualified poultry veterinarian if deaths are sudden or continuing."
    });
  } else if (mortalityPerThousand >= 2 || (mortalityChange !== null && mortalityChange >= 0.5)) {
    alerts.push({
      severity: "watch",
      title: "Mortality is above its recent baseline",
      observation: `${mortalityPerThousand.toFixed(1)} deaths/culls per 1,000 birds/day in the latest window.`,
      action: "Increase flock walk-through frequency and verify water, feed, litter condition, ventilation, and biosecurity before the next record."
    });
  }

  if (feedChange !== null && feedChange <= -0.15) {
    alerts.push({
      severity: "watch",
      title: "Feed intake is falling",
      observation: `Average feed is ${Math.round(Math.abs(feedChange) * 100)}% below the prior window.`,
      action: "Check feed stock, feeder access, feed quality, water availability, and house temperature. Do not change ration formulation from this trend alone."
    });
  }

  if (waterChange !== null && Math.abs(waterChange) >= 0.2) {
    alerts.push({
      severity: "watch",
      title: waterChange > 0 ? "Water use is rising" : "Water use is falling",
      observation: `Average water use changed ${Math.round(Math.abs(waterChange) * 100)}% from the prior window.`,
      action: "Inspect drinker function, leaks, water quality, stocking density, and heat conditions. Compare with feed intake and bird behaviour."
    });
  }

  if (["layer", "breeder"].includes(flock.poultryType) && eggChange !== null && eggChange <= -0.1) {
    alerts.push({
      severity: "watch",
      title: "Egg collection is falling",
      observation: `Average eggs are ${Math.round(Math.abs(eggChange) * 100)}% below the prior window.`,
      action: "Verify lighting consistency, clean water, feed intake, nest access, heat stress, and flock health. Record egg quality separately if the decline continues."
    });
  }

  if (!alerts.length) {
    alerts.push({
      severity: "stable",
      title: "Recent operating signals are stable",
      observation: "No material change was detected across the recorded production signals.",
      action: "Continue daily records and routine flock checks. More consecutive records improve forecast confidence."
    });
  }

  const severity = alerts.some((alert) => alert.severity === "urgent") ? "urgent" : alerts.some((alert) => alert.severity === "watch") ? "watch" : "stable";
  const optionalCoverage = [feedRecent, waterRecent, eggsRecent].filter((value) => value !== null).length;
  return {
    flockId: flock.id,
    flockName: flock.name,
    severity,
    confidence: days.length >= 12 && optionalCoverage >= 2 ? "high" : days.length >= 7 ? "medium" : "low",
    recordDays: days.length,
    ageWeeks: age,
    forecast: {
      mortalityNext2Days: Math.round((projectedTwoDayTotal(mortalityRecent, mortalityBaseline) ?? 0) * 10) / 10,
      feedKgNext2Days: projectedTwoDayTotal(feedRecent, feedBaseline),
      eggsNext2Days: projectedTwoDayTotal(eggsRecent, eggsBaseline)
    },
    alerts,
    disclaimer
  };
}
