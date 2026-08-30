'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/line-charts-9';
import { TrendingUp, Target, Building2, Users, Zap, CheckCircle2, Briefcase } from 'lucide-react';
import { CartesianGrid, ComposedChart, Line, Bar, ReferenceLine, XAxis, YAxis } from 'recharts';

export interface BreakEvenDataPoint {
  day: number;
  date: string;
  cumulativeSales: number; // in Millions of Tomans
  cumulativeFixedCost: number; // in Millions of Tomans
  dailySales: number; // in Millions of Tomans (Fluctuations / فراز و نشیب)
  isActual: boolean;
  profitOrLoss: number;
  orderCount?: number;
}

export interface CostCategoryItem {
  id?: string;
  name: string;
  amountToman: number;
  categoryCode?: string;
  headcount?: number;
}

// Monthly 30-day trajectory with realistic daily revenue fluctuations (فراز و نشیب‌های درآمدی)
const defaultTrajectoryData: BreakEvenDataPoint[] = [
  { day: 1, date: '۱ فروردین', cumulativeSales: 48, cumulativeFixedCost: 42.6, dailySales: 48, isActual: true, profitOrLoss: 5.4, orderCount: 22 },
  { day: 2, date: '۲ فروردین', cumulativeSales: 103, cumulativeFixedCost: 85.3, dailySales: 55, isActual: true, profitOrLoss: 17.7, orderCount: 28 },
  { day: 3, date: '۳ فروردین', cumulativeSales: 142, cumulativeFixedCost: 128.0, dailySales: 39, isActual: true, profitOrLoss: 14.0, orderCount: 19 },
  { day: 4, date: '۴ فروردین', cumulativeSales: 214, cumulativeFixedCost: 170.6, dailySales: 72, isActual: true, profitOrLoss: 43.4, orderCount: 35 },
  { day: 5, date: '۵ فروردین', cumulativeSales: 275, cumulativeFixedCost: 213.3, dailySales: 61, isActual: true, profitOrLoss: 61.7, orderCount: 30 },
  { day: 6, date: '۶ فروردین', cumulativeSales: 317, cumulativeFixedCost: 256.0, dailySales: 42, isActual: true, profitOrLoss: 61.0, orderCount: 20 },
  { day: 7, date: '۷ فروردین', cumulativeSales: 405, cumulativeFixedCost: 298.6, dailySales: 88, isActual: true, profitOrLoss: 106.4, orderCount: 44 },
  { day: 8, date: '۸ فروردین', cumulativeSales: 457, cumulativeFixedCost: 341.3, dailySales: 52, isActual: true, profitOrLoss: 115.7, orderCount: 26 },
  { day: 9, date: '۹ فروردین', cumulativeSales: 523, cumulativeFixedCost: 384.0, dailySales: 66, isActual: true, profitOrLoss: 139.0, orderCount: 32 },
  { day: 10, date: '۱۰ فروردین', cumulativeSales: 618, cumulativeFixedCost: 426.6, dailySales: 95, isActual: true, profitOrLoss: 191.4, orderCount: 48 },
  { day: 11, date: '۱۱ فروردین', cumulativeSales: 663, cumulativeFixedCost: 469.3, dailySales: 45, isActual: true, profitOrLoss: 193.7, orderCount: 23 },
  { day: 12, date: '۱۲ فروردین', cumulativeSales: 741, cumulativeFixedCost: 512.0, dailySales: 78, isActual: true, profitOrLoss: 229.0, orderCount: 38 },
  { day: 13, date: '۱۳ فروردین', cumulativeSales: 845, cumulativeFixedCost: 554.6, dailySales: 104, isActual: true, profitOrLoss: 290.4, orderCount: 52 },
  { day: 14, date: '۱۴ فروردین', cumulativeSales: 903, cumulativeFixedCost: 597.3, dailySales: 58, isActual: true, profitOrLoss: 305.7, orderCount: 29 },
  { day: 15, date: '۱۵ فروردین', cumulativeSales: 985, cumulativeFixedCost: 640.0, dailySales: 82, isActual: true, profitOrLoss: 408.0, orderCount: 41 },
  { day: 16, date: '۱۶ فروردین', cumulativeSales: 1056, cumulativeFixedCost: 682.6, dailySales: 71, isActual: true, profitOrLoss: 455.4, orderCount: 36 },
  { day: 17, date: '۱۷ فروردین', cumulativeSales: 1195, cumulativeFixedCost: 725.3, dailySales: 139, isActual: true, profitOrLoss: 504.7, orderCount: 68 },
  { day: 18, date: '۱۸ فروردین (نقطه سر به سر)', cumulativeSales: 1285, cumulativeFixedCost: 768.0, dailySales: 90, isActual: false, profitOrLoss: 557.0, orderCount: 45 },
  { day: 19, date: '۱۹ فروردین', cumulativeSales: 1362, cumulativeFixedCost: 810.6, dailySales: 77, isActual: false, profitOrLoss: 611.4, orderCount: 38 },
  { day: 20, date: '۲۰ فروردین', cumulativeSales: 1445, cumulativeFixedCost: 853.3, dailySales: 83, isActual: false, profitOrLoss: 666.7, orderCount: 41 },
  { day: 21, date: '۲۱ فروردین', cumulativeSales: 1540, cumulativeFixedCost: 896.0, dailySales: 95, isActual: false, profitOrLoss: 724.0, orderCount: 47 },
  { day: 22, date: '۲۲ فروردین', cumulativeSales: 1608, cumulativeFixedCost: 938.6, dailySales: 68, isActual: false, profitOrLoss: 783.4, orderCount: 34 },
  { day: 23, date: '۲۳ فروردین', cumulativeSales: 1720, cumulativeFixedCost: 981.3, dailySales: 112, isActual: false, profitOrLoss: 844.7, orderCount: 56 },
  { day: 24, date: '۲۴ فروردین', cumulativeSales: 1805, cumulativeFixedCost: 1024.0, dailySales: 85, isActual: false, profitOrLoss: 908.0, orderCount: 42 },
  { day: 25, date: '۲۵ فروردین', cumulativeSales: 1925, cumulativeFixedCost: 1066.6, dailySales: 120, isActual: false, profitOrLoss: 973.4, orderCount: 60 },
  { day: 26, date: '۲۶ فروردین', cumulativeSales: 2015, cumulativeFixedCost: 1109.3, dailySales: 90, isActual: false, profitOrLoss: 1040.7, orderCount: 45 },
  { day: 27, date: '۲۷ فروردین', cumulativeSales: 2165, cumulativeFixedCost: 1152.0, dailySales: 150, isActual: false, profitOrLoss: 1110.0, orderCount: 75 },
  { day: 28, date: '۲۸ فروردین', cumulativeSales: 2250, cumulativeFixedCost: 1194.6, dailySales: 85, isActual: false, profitOrLoss: 1181.4, orderCount: 42 },
  { day: 29, date: '۲۹ فروردین', cumulativeSales: 2355, cumulativeFixedCost: 1237.3, dailySales: 105, isActual: false, profitOrLoss: 1254.7, orderCount: 52 },
  { day: 30, date: '۳۰ فروردین (ددلاین)', cumulativeSales: 2480, cumulativeFixedCost: 1280.0, dailySales: 125, isActual: false, profitOrLoss: 1330.0, orderCount: 62 },
];

const chartConfig = {
  cumulativeSales: {
    label: 'فروش تجمعی',
    color: 'var(--color-purple-500, #a855f7)',
  },
  dailySales: {
    label: 'فراز و نشیب فروش روزانه',
    color: 'var(--color-sky-500, #0ea5e9)',
  },
  breakEvenTarget: {
    label: 'هدف نقطه سر به سر',
    color: 'var(--color-yellow-500, #eab308)',
  },
} satisfies ChartConfig;

export interface LineChart9Props {
  totalFixedCostsToman?: number;
  realizedSalesToman?: number;
  costBreakdown?: CostCategoryItem[];
  data?: BreakEvenDataPoint[];
}

export default function LineChart9({
  totalFixedCostsToman = 1_280_000_000,
  realizedSalesToman = 1_195_000_000,
  costBreakdown = [
    { name: 'اجاره محل', amountToman: 800_000_000, categoryCode: 'rent' },
    { name: 'هزینه نیرو', amountToman: 450_000_000, categoryCode: 'payroll', headcount: 10 },
    { name: 'اشتراک آب/برق/گاز', amountToman: 30_000_000, categoryCode: 'utilities' },
  ],
  data = defaultTrajectoryData,
}: LineChart9Props) {
  const dynamicTotalCosts = costBreakdown.length
    ? costBreakdown.reduce((sum, item) => sum + item.amountToman, 0)
    : totalFixedCostsToman;

  const breakEvenTargetMillion = dynamicTotalCosts / 1_000_000;
  const progressPercent = Math.min(100, Math.round((realizedSalesToman / dynamicTotalCosts) * 100));

  return (
    <div className="w-full max-w-6xl flex items-center justify-center p-2 sm:p-4" dir="rtl">
      <Card className="w-full bg-white dark:bg-[#172230] border border-slate-200 dark:border-slate-700/60 shadow-xl dark:shadow-2xl rounded-2xl text-slate-900 dark:text-slate-100 transition-colors duration-200">
        <CardContent className="flex flex-col items-stretch gap-5 p-4 sm:p-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700/50 pb-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                <Target className="w-4 h-4" />
                <span>تحلیل نقطه سر به سر و فراز و نشیب درآمدی</span>
              </div>
              <div className="flex flex-wrap items-baseline gap-3 mt-1.5">
                <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">
                  {(dynamicTotalCosts / 1_000_000).toLocaleString('fa-IR')} <small className="text-sm font-normal text-slate-500 dark:text-slate-400">میلیون تومان ددلاین</small>
                </span>
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/30">
                  <TrendingUp className="w-4 h-4" />
                  <span>پیشرفت: {progressPercent.toLocaleString('fa-IR')}٪</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                محاسبه زنده بر مبنای هزینه‌های استخراج‌شده از سیستم حسابداری و دفتر مالی.
              </p>
            </div>

            {/* Dynamic Cost Breakdown Chips */}
            <div className="flex flex-wrap gap-2.5 text-xs">
              {costBreakdown.map((cost, idx) => {
                let Icon = Briefcase;
                if (cost.categoryCode === 'rent' || cost.name.includes('اجاره')) Icon = Building2;
                else if (cost.categoryCode === 'payroll' || cost.name.includes('نیرو') || cost.name.includes('حقوق')) Icon = Users;
                else if (cost.categoryCode === 'utilities' || cost.name.includes('آب') || cost.name.includes('برق')) Icon = Zap;

                return (
                  <div key={cost.id || `cost-${idx}`} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <Icon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block">
                        {cost.name}{cost.headcount ? ` (${cost.headcount.toLocaleString('fa-IR')} نفر)` : ''}
                      </span>
                      <strong className="text-slate-900 dark:text-white font-bold">{(cost.amountToman / 1_000_000).toLocaleString('fa-IR')} م.ت</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Chart Container */}
          <div className="grow">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-purple-500 inline-block"></span>
                  فروش تجمعی ۳۰ روزه
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 rounded bg-sky-400 inline-block"></span>
                  فراز و نشیب فروش روزانه
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-yellow-500 inline-block border-t border-dashed"></span>
                  خط هدف سر به سر ({breakEvenTargetMillion.toLocaleString('fa-IR')} م.ت)
                </span>
              </div>
              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>ددلاین هدف سودآوری: عبور از {breakEvenTargetMillion.toLocaleString('fa-IR')} م.ت</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 p-2 sm:p-3">
              <ChartContainer
                config={chartConfig}
                className="h-84 w-full [&_.recharts-curve.recharts-tooltip-cursor]:stroke-initial"
              >
                <ComposedChart
                  data={data}
                  margin={{
                    top: 20,
                    right: 15,
                    left: 10,
                    bottom: 20,
                  }}
                >
                  <defs>
                    <linearGradient id="breakEvenAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="dailyBarGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#0284c7" stopOpacity={0.3} />
                    </linearGradient>
                    <pattern id="dotGridBE" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                      <circle cx="10" cy="10" r="1" className="fill-slate-400 dark:fill-slate-600 opacity-40" />
                    </pattern>
                  </defs>

                  <rect x="0" y="0" width="100%" height="100%" fill="url(#dotGridBE)" style={{ pointerEvents: 'none' }} />

                  <CartesianGrid
                    strokeDasharray="4 8"
                    className="stroke-slate-300 dark:stroke-slate-700"
                    strokeOpacity={0.7}
                    horizontal={true}
                    vertical={false}
                  />

                  {/* Horizontal Break-Even Target Line */}
                  <ReferenceLine
                    y={breakEvenTargetMillion}
                    stroke="#d97706"
                    strokeDasharray="5 5"
                    strokeWidth={2}
                    label={{
                      value: `نقطه سر به سر (${breakEvenTargetMillion.toLocaleString('fa-IR')} م.ت)`,
                      fill: '#d97706',
                      position: 'insideTopRight',
                      fontSize: 11,
                    }}
                  />

                  {/* Crossing Point Reference Line (Day 18) */}
                  <ReferenceLine
                    x="۱۸ فروردین (نقطه سر به سر)"
                    stroke="#059669"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: 'ورود به سوددهی',
                      fill: '#059669',
                      position: 'insideTopLeft',
                      fontSize: 11,
                    }}
                  />

                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11 }}
                    className="text-slate-500 dark:text-slate-400"
                    tickMargin={12}
                    interval="preserveStartEnd"
                  />

                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11 }}
                    className="text-slate-500 dark:text-slate-400"
                    tickFormatter={(val) => `${Number(val).toLocaleString('fa-IR')} م`}
                    tickMargin={10}
                  />

                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload as BreakEvenDataPoint;
                        return (
                          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-2xl text-xs text-right text-slate-800 dark:text-slate-100" dir="rtl">
                            <div className="text-slate-500 dark:text-slate-400 mb-1.5 font-bold">{item.date}</div>
                            <div className="flex justify-between gap-4 py-0.5">
                              <span className="text-slate-500 dark:text-slate-400">فروش روزانه (فراز و نشیب):</span>
                              <strong className="text-sky-600 dark:text-sky-400 font-bold">{item.dailySales.toLocaleString('fa-IR')} م.ت</strong>
                            </div>
                            <div className="flex justify-between gap-4 py-0.5">
                              <span className="text-slate-500 dark:text-slate-400">فروش تجمعی:</span>
                              <strong className="text-purple-600 dark:text-purple-400">{item.cumulativeSales.toLocaleString('fa-IR')} م.ت</strong>
                            </div>
                            <div className="flex justify-between gap-4 py-0.5">
                              <span className="text-slate-500 dark:text-slate-400">هزینه ثابت سرشکن:</span>
                              <strong className="text-amber-600 dark:text-amber-400">{item.cumulativeFixedCost.toLocaleString('fa-IR')} م.ت</strong>
                            </div>
                            <div className="flex justify-between gap-4 py-0.5 border-t border-slate-100 dark:border-slate-800 mt-1 pt-1">
                              <span className="text-slate-500 dark:text-slate-400">سود/زیان تجمعی:</span>
                              <strong className={item.profitOrLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>
                                {item.profitOrLoss >= 0 ? '+' : ''}{item.profitOrLoss.toLocaleString('fa-IR')} م.ت
                              </strong>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />

                  {/* Daily Sales Bar (Fluctuations / فراز و نشیب روزانه) */}
                  <Bar
                    dataKey="dailySales"
                    fill="url(#dailyBarGradient)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={14}
                  />

                  {/* Cumulative Sales Line (Ultra-clean continuous curve with dynamic hover dot only) */}
                  <Line
                    type="monotone"
                    dataKey="cumulativeSales"
                    stroke="#a855f7"
                    strokeWidth={2.8}
                    dot={false}
                    activeDot={{
                      r: 6.5,
                      fill: '#a855f7',
                      stroke: '#ffffff',
                      strokeWidth: 2.5,
                    }}
                  />
                </ComposedChart>
              </ChartContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
