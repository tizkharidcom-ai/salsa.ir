/*
 * WESTO — reusable break-even chart
 *
 * Usage:
 *   const chart = window.WestoBreakEvenChart.mount('#break-even', data);
 *   chart.update(nextData);
 *   chart.destroy();
 *
 * The component accepts the Finance V2 break-even response directly (including
 * `...Irr` fields), or a display-ready JSON object in تومان.  Optional `series`
 * rows can contain `day`, `cumulativeSales` and `cumulativeCost`; otherwise a
 * transparent projection is drawn from the supplied financial totals.
 */
(() => {
  'use strict';

  if (typeof window === 'undefined' || !window.document) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const INSTANCES = new WeakMap();
  let uid = 0;

  const AMOUNT_KEYS = Object.freeze({
    fixed: ['fixedCosts', 'totalFixedCosts', 'totalFixedCostsIrr', 'fixedCost', 'fixedCostIrr', 'committedFixedCost', 'committedFixedCostIrr'],
    breakEven: ['breakEvenSales', 'breakEvenSalesIrr', 'breakEven', 'breakEvenIrr'],
    realized: ['realizedSales', 'realizedNetSales', 'realizedNetSalesIrr', 'netSales', 'netSalesIrr', 'currentSales', 'salesToDate'],
    variable: ['variableCost', 'variableCosts', 'variableCostIrr', 'variableCostsIrr'],
    target: ['targetSales', 'targetSalesIrr', 'salesTarget', 'salesTargetIrr', 'goalSales', 'goalSalesIrr'],
    gap: ['gap', 'gapIrr', 'remainingSales', 'remainingSalesIrr'],
    requiredDaily: ['requiredDailySales', 'requiredDailySalesIrr', 'dailyRequiredSales', 'dailyRequiredSalesIrr'],
  });

  function asNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const normalized = value
      .trim()
      .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[٬,٫]/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function firstValue(source, keys) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source || {}, key)) continue;
      const value = asNumber(source[key]);
      if (value != null) return { key, value };
    }
    return null;
  }

  function displayUnit(data, options) {
    const explicit = String(options.currency || data.currency || data.displayCurrency || '').trim();
    if (explicit) return explicit;
    const sourceUnit = String(options.amountUnit || data.amountUnit || data.unit || '').toLowerCase();
    return /rial|irr|ریال/.test(sourceUnit) ? 'ریال' : 'تومان';
  }

  function isRialDisplay(data, options) {
    return /rial|irr|ریال/.test(String(options.currency || data.currency || data.displayCurrency || '').toLowerCase())
      || /rial|irr|ریال/.test(String(options.displayUnit || '').toLowerCase());
  }

  function amountFromValue(value, key, data, options) {
    if (value == null) return null;
    const sourceUnit = String(options.amountUnit || data.amountUnit || data.unit || '').toLowerCase();
    const inRial = /irr$/i.test(key || '') || /rial|irr|ریال/.test(sourceUnit);
    return inRial && !isRialDisplay(data, options) ? value / 10 : value;
  }

  function amountFrom(data, keys, options) {
    const found = firstValue(data, keys);
    return found ? amountFromValue(found.value, found.key, data, options) : null;
  }

  function numberFrom(data, keys) {
    const found = firstValue(data, keys);
    return found ? found.value : null;
  }

  function toFaDigits(value) {
    return String(value).replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)]);
  }

  function formatNumber(value, options = {}) {
    const number = asNumber(value);
    if (number == null) return options.empty || '—';
    const decimals = Number.isFinite(options.maximumFractionDigits) ? options.maximumFractionDigits : 0;
    const formatted = new Intl.NumberFormat('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: options.minimumFractionDigits || 0,
    }).format(number);
    return toFaDigits(formatted).replace(/,/g, '٫').replace(/\./g, '٫');
  }

  function formatMoney(value, options = {}) {
    const unit = options.unit || 'تومان';
    return `${formatNumber(value, options)}${unit ? ` ${unit}` : ''}`;
  }

  function formatPercent(value) {
    return value == null ? '—' : `${formatNumber(value * 100, { maximumFractionDigits: 1 })}٪`;
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(date);
  }

  function dateDiffDays(from, to) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.ceil((endUtc - startUtc) / 86400000);
  }

  function unwrapData(input) {
    if (input && typeof input === 'object' && input.data && typeof input.data === 'object') return input.data;
    return input && typeof input === 'object' ? input : {};
  }

  function getModel(input, options) {
    const data = unwrapData(input);
    const unit = displayUnit(data, options);
    const fixedCosts = amountFrom(data, AMOUNT_KEYS.fixed, options) || 0;
    const realizedSales = amountFrom(data, AMOUNT_KEYS.realized, options) || 0;
    const variableCost = amountFrom(data, AMOUNT_KEYS.variable, options);
    let contributionMarginRatio = numberFrom(data, ['contributionMarginRatio', 'contributionMargin', 'marginRatio']);
    const contributionMarginPercent = numberFrom(data, ['contributionMarginPercent', 'marginPercent']);
    if (contributionMarginRatio == null && contributionMarginPercent != null) contributionMarginRatio = contributionMarginPercent / 100;
    if (contributionMarginRatio == null && variableCost != null && realizedSales > 0) contributionMarginRatio = 1 - (variableCost / realizedSales);
    if (contributionMarginRatio != null) contributionMarginRatio = clamp(contributionMarginRatio, 0, 0.9999);

    let breakEvenSales = amountFrom(data, AMOUNT_KEYS.breakEven, options);
    if (breakEvenSales == null && fixedCosts >= 0 && contributionMarginRatio > 0) breakEvenSales = Math.ceil(fixedCosts / contributionMarginRatio);
    const targetSales = amountFrom(data, AMOUNT_KEYS.target, options) ?? breakEvenSales;
    const suppliedGap = amountFrom(data, AMOUNT_KEYS.gap, options);
    const gap = suppliedGap ?? (targetSales == null ? null : Math.max(0, targetSales - realizedSales));
    const requiredDailySales = amountFrom(data, AMOUNT_KEYS.requiredDaily, options);

    const deadline = data.deadline || data.deadlineAt || data.targetDate || null;
    const deadlineLabel = data.deadlineLabel || (deadline ? formatDate(deadline) : null);
    const asOf = data.asOf || data.asOfDate || options.asOf || new Date();
    const explicitRemaining = numberFrom(data, ['remainingOpenDays', 'remainingDays', 'daysRemaining']);
    const computedRemaining = deadline ? dateDiffDays(asOf, deadline) : null;
    const remainingDays = explicitRemaining != null ? Math.max(0, Math.round(explicitRemaining)) : (computedRemaining != null ? Math.max(0, computedRemaining) : null);
    const explicitPeriod = numberFrom(data, ['periodDays', 'daysInPeriod', 'totalDays', 'deadlineDays']);
    const startDate = data.periodStart || data.startDate || null;
    const inferredPeriod = deadline && startDate ? dateDiffDays(startDate, deadline) : null;
    const explicitElapsed = numberFrom(data, ['daysElapsed', 'elapsedDays', 'currentDay', 'day']);
    let periodDays = Math.max(1, Math.round(explicitPeriod || inferredPeriod || ((explicitElapsed || 0) + (remainingDays || 0)) || 30));
    let daysElapsed = explicitElapsed != null ? Math.round(explicitElapsed) : (remainingDays != null ? Math.max(0, periodDays - remainingDays) : Math.round(periodDays * 0.6));
    daysElapsed = clamp(daysElapsed, 0, periodDays);
    if (remainingDays != null && !explicitPeriod && !inferredPeriod) periodDays = Math.max(1, daysElapsed + remainingDays);

    const breakEvenDay = numberFrom(data, ['breakEvenDay', 'breakEvenAtDay']);
    const status = String(data.status || '').toLowerCase();
    const ready = status !== 'insufficient_data' && Number.isFinite(breakEvenSales) && breakEvenSales >= 0;
    const variableRatio = contributionMarginRatio != null ? 1 - contributionMarginRatio : (variableCost != null && realizedSales > 0 ? variableCost / realizedSales : null);

    return {
      raw: data,
      unit,
      title: String(data.title || options.title || 'نقطهٔ سربه‌سر و مسیر سوددهی'),
      subtitle: String(data.subtitle || options.subtitle || 'فروش تجمعی در برابر هزینهٔ تجمعی تا ددلاین'),
      fixedCosts,
      realizedSales,
      variableCost,
      variableRatio: variableRatio == null ? null : clamp(variableRatio, 0, 1.5),
      contributionMarginRatio,
      breakEvenSales,
      targetSales,
      gap,
      requiredDailySales,
      deadline,
      deadlineLabel,
      remainingDays,
      periodDays,
      daysElapsed,
      breakEvenDay: breakEvenDay == null ? null : clamp(Math.round(breakEvenDay), 0, periodDays),
      ready,
      status,
    };
  }

  function rowAmount(row, keys, rootData, options) {
    const found = firstValue(row, keys);
    return found ? amountFromValue(found.value, found.key, rootData, options) : null;
  }

  function rowDay(row, index) {
    const candidate = numberFrom(row, ['day', 'index', 'x', 'offsetDays']);
    return candidate == null ? index + 1 : Math.max(0, Math.round(candidate));
  }

  function pointAtDay(points, day) {
    if (!points.length) return null;
    if (day <= points[0].day) return { ...points[0], day };
    const last = points[points.length - 1];
    if (day >= last.day) return { ...last, day };
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      if (day > next.day) continue;
      const range = next.day - previous.day || 1;
      const ratio = (day - previous.day) / range;
      return {
        day,
        sales: previous.sales + ((next.sales - previous.sales) * ratio),
        cost: previous.cost + ((next.cost - previous.cost) * ratio),
      };
    }
    return null;
  }

  function normalizeSeries(model, options) {
    const data = model.raw;
    const source = Array.isArray(data.series) ? data.series
      : Array.isArray(data.salesSeries) ? data.salesSeries
        : Array.isArray(data.cumulativeSeries) ? data.cumulativeSeries
          : Array.isArray(data.points) ? data.points : [];
    const supplied = [];
    let runningSales = 0;
    let runningCost = 0;

    for (let index = 0; index < source.length; index += 1) {
      const row = source[index] || {};
      const cumulativeSales = rowAmount(row, ['cumulativeSales', 'cumulativeSalesIrr', 'salesCumulative', 'salesCumulativeIrr', 'revenueCumulative', 'revenueCumulativeIrr'], data, options);
      const dailySales = rowAmount(row, ['sales', 'salesIrr', 'revenue', 'revenueIrr', 'dailySales', 'dailySalesIrr'], data, options);
      const cumulativeCost = rowAmount(row, ['cumulativeCost', 'cumulativeCostIrr', 'costCumulative', 'costCumulativeIrr', 'totalCost', 'totalCostIrr'], data, options);
      const dailyCost = rowAmount(row, ['cost', 'costIrr', 'dailyCost', 'dailyCostIrr', 'expenses', 'expensesIrr'], data, options);
      runningSales = cumulativeSales != null ? cumulativeSales : runningSales + (dailySales || 0);
      const fallbackCost = (model.fixedCosts * (rowDay(row, index) / model.periodDays)) + ((model.variableRatio || 0) * runningSales);
      runningCost = cumulativeCost != null ? cumulativeCost : (dailyCost != null ? runningCost + dailyCost : fallbackCost);
      supplied.push({
        day: rowDay(row, index),
        sales: Math.max(0, runningSales),
        cost: Math.max(0, runningCost),
        label: String(row.label || row.date || row.name || ''),
      });
    }

    supplied.sort((left, right) => left.day - right.day);
    const points = supplied.filter((point, index) => index === 0 || point.day !== supplied[index - 1].day);
    if (!points.length || points[0].day > 0) points.unshift({ day: 0, sales: 0, cost: 0, label: '' });

    const sourceLast = points[points.length - 1];
    const actualDay = source.length ? Math.min(model.daysElapsed, sourceLast.day) : model.daysElapsed;
    const target = Math.max(model.targetSales || 0, model.breakEvenSales || 0, model.realizedSales || 0, sourceLast.sales || 0);
    const endDay = Math.max(model.periodDays, sourceLast.day, 1);

    if (!source.length) {
      const count = Math.max(12, Math.min(32, endDay));
      for (let index = 1; index <= count; index += 1) {
        const day = Math.round((endDay * index) / count);
        const isActual = day <= actualDay;
        const actualShare = actualDay > 0 ? clamp(day / actualDay, 0, 1) : 0;
        const forecastShare = endDay > actualDay ? clamp((day - actualDay) / (endDay - actualDay), 0, 1) : 1;
        const sales = isActual
          ? model.realizedSales * actualShare
          : model.realizedSales + ((target - model.realizedSales) * forecastShare);
        const cost = (model.fixedCosts * (day / endDay)) + ((model.variableRatio || 0) * sales);
        points.push({ day, sales: Math.max(0, sales), cost: Math.max(0, cost), label: '' });
      }
    } else if (sourceLast.day < endDay) {
      const start = { ...sourceLast };
      const endSales = Math.max(target, start.sales);
      const endCost = model.fixedCosts + ((model.variableRatio || 0) * endSales);
      const steps = Math.max(2, Math.min(12, endDay - sourceLast.day));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        points.push({
          day: Math.round(start.day + ((endDay - start.day) * ratio)),
          sales: start.sales + ((endSales - start.sales) * ratio),
          cost: start.cost + ((endCost - start.cost) * ratio),
          label: '',
        });
      }
    }

    const unique = points.filter((point, index, all) => index === 0 || point.day > all[index - 1].day);
    return { points: unique, actualDay: clamp(actualDay, 0, unique[unique.length - 1].day) };
  }

  function svgNode(name, attributes = {}, text = null) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [attribute, value] of Object.entries(attributes)) {
      if (value != null) node.setAttribute(attribute, String(value));
    }
    if (text != null) node.textContent = text;
    return node;
  }

  function htmlNode(name, className, text = null) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pathFor(points, key, x, y) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${x(point.day).toFixed(2)} ${y(point[key]).toFixed(2)}`).join(' ');
  }

  function splitAtDay(points, day) {
    const before = points.filter((point) => point.day < day);
    const after = points.filter((point) => point.day > day);
    const exact = pointAtDay(points, day);
    if (exact) {
      before.push(exact);
      after.unshift(exact);
    }
    return { actual: before.length > 1 ? before : [], forecast: after.length > 1 ? after : [] };
  }

  function findValuePoint(points, key, value) {
    if (value == null) return null;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      if (!((previous[key] <= value && next[key] >= value) || (previous[key] >= value && next[key] <= value))) continue;
      const span = next[key] - previous[key];
      const ratio = span === 0 ? 0 : (value - previous[key]) / span;
      return {
        day: previous.day + ((next.day - previous.day) * ratio),
        sales: previous.sales + ((next.sales - previous.sales) * ratio),
        cost: previous.cost + ((next.cost - previous.cost) * ratio),
      };
    }
    return null;
  }

  function findIntersection(points) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      const previousGap = previous.sales - previous.cost;
      const nextGap = next.sales - next.cost;
      if (previousGap === 0) return previous;
      if (previousGap * nextGap > 0) continue;
      const ratio = previousGap / (previousGap - nextGap);
      return {
        day: previous.day + ((next.day - previous.day) * ratio),
        sales: previous.sales + ((next.sales - previous.sales) * ratio),
        cost: previous.cost + ((next.cost - previous.cost) * ratio),
      };
    }
    return null;
  }

  function niceMaximum(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const ratio = value / magnitude;
    const ceiling = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
    return ceiling * magnitude;
  }

  function addAreaSegment(group, first, last, type, x, y) {
    const d = [
      `M${x(first.day).toFixed(2)} ${y(first.sales).toFixed(2)}`,
      `L${x(last.day).toFixed(2)} ${y(last.sales).toFixed(2)}`,
      `L${x(last.day).toFixed(2)} ${y(last.cost).toFixed(2)}`,
      `L${x(first.day).toFixed(2)} ${y(first.cost).toFixed(2)}Z`,
    ].join(' ');
    group.append(svgNode('path', { d, class: `be-chart__area be-chart__area--${type}` }));
  }

  function addProfitLossAreas(group, points, x, y) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const next = points[index];
      const startGap = previous.sales - previous.cost;
      const endGap = next.sales - next.cost;
      if (startGap === 0 && endGap === 0) continue;
      if (startGap === 0 || endGap === 0 || startGap * endGap > 0) {
        addAreaSegment(group, previous, next, (startGap || endGap) > 0 ? 'profit' : 'loss', x, y);
        continue;
      }
      const ratio = startGap / (startGap - endGap);
      const cross = {
        day: previous.day + ((next.day - previous.day) * ratio),
        sales: previous.sales + ((next.sales - previous.sales) * ratio),
        cost: previous.cost + ((next.cost - previous.cost) * ratio),
      };
      addAreaSegment(group, previous, cross, startGap > 0 ? 'profit' : 'loss', x, y);
      addAreaSegment(group, cross, next, endGap > 0 ? 'profit' : 'loss', x, y);
    }
  }

  function addSvgLabel(svg, attributes, text) {
    const label = svgNode('text', attributes, text);
    svg.append(label);
    return label;
  }

  function createChart(model, series, identifier) {
    const { points, actualDay } = series;
    const width = 1000;
    const height = 500;
    const padding = { top: 58, right: 42, bottom: 74, left: 112 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxDay = Math.max(1, points[points.length - 1].day);
    const maximum = niceMaximum(Math.max(
      model.breakEvenSales || 0,
      model.targetSales || 0,
      ...points.flatMap((point) => [point.sales, point.cost]),
    ) * 1.06);
    const x = (day) => padding.left + ((day / maxDay) * plotWidth);
    const y = (value) => padding.top + plotHeight - ((value / maximum) * plotHeight);
    const chartTitleId = `${identifier}-svg-title`;
    const chartDescId = `${identifier}-svg-description`;
    const svg = svgNode('svg', {
      class: 'westo-break-even__svg', viewBox: `0 0 ${width} ${height}`,
      role: 'img', tabindex: '0', 'aria-labelledby': `${chartTitleId} ${chartDescId}`,
    });
    svg.append(
      svgNode('title', { id: chartTitleId }, 'نمودار فروش تجمعی و هزینه تجمعی'),
      svgNode('desc', { id: chartDescId }, `فروش تجمعی ${formatMoney(model.realizedSales, { unit: model.unit })} است. فروش سربه‌سر ${formatMoney(model.breakEvenSales, { unit: model.unit })} است. ${model.gap > 0 ? `${formatMoney(model.gap, { unit: model.unit })} تا هدف فاصله دارید.` : 'هدف سربه‌سر پوشش داده شده است.'}`),
    );

    const defs = svgNode('defs');
    const clipId = `${identifier}-clip`;
    const clip = svgNode('clipPath', { id: clipId });
    clip.append(svgNode('rect', { x: padding.left, y: padding.top, width: plotWidth, height: plotHeight, rx: 14 }));
    defs.append(clip);
    svg.append(defs);

    const grid = svgNode('g', { class: 'be-chart__grid' });
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = (maximum / 4) * tick;
      const yPosition = y(value);
      grid.append(svgNode('line', { x1: padding.left, x2: width - padding.right, y1: yPosition, y2: yPosition }));
      addSvgLabel(grid, { x: padding.left - 14, y: yPosition + 4, class: 'be-chart__axis-label', 'text-anchor': 'end' }, formatNumber(value));
    }
    svg.append(grid);

    const areaGroup = svgNode('g', { 'clip-path': `url(#${clipId})` });
    addProfitLossAreas(areaGroup, points, x, y);
    svg.append(areaGroup);

    const dataGroup = svgNode('g', { 'clip-path': `url(#${clipId})` });
    const split = splitAtDay(points, actualDay);
    if (split.actual.length) {
      dataGroup.append(svgNode('path', { d: pathFor(split.actual, 'sales', x, y), class: 'be-chart__line be-chart__line--sales' }));
      dataGroup.append(svgNode('path', { d: pathFor(split.actual, 'cost', x, y), class: 'be-chart__line be-chart__line--cost' }));
    }
    if (split.forecast.length) {
      dataGroup.append(svgNode('path', { d: pathFor(split.forecast, 'sales', x, y), class: 'be-chart__line be-chart__line--sales be-chart__line--forecast' }));
      dataGroup.append(svgNode('path', { d: pathFor(split.forecast, 'cost', x, y), class: 'be-chart__line be-chart__line--cost be-chart__line--forecast' }));
    }
    if (!split.actual.length && !split.forecast.length) {
      dataGroup.append(svgNode('path', { d: pathFor(points, 'sales', x, y), class: 'be-chart__line be-chart__line--sales' }));
      dataGroup.append(svgNode('path', { d: pathFor(points, 'cost', x, y), class: 'be-chart__line be-chart__line--cost' }));
    }
    svg.append(dataGroup);

    const currentPoint = pointAtDay(points, actualDay);
    if (currentPoint) {
      svg.append(svgNode('line', { x1: x(actualDay), x2: x(actualDay), y1: padding.top, y2: height - padding.bottom, class: 'be-chart__today-line' }));
      svg.append(svgNode('circle', { cx: x(actualDay), cy: y(currentPoint.sales), r: 6, class: 'be-chart__point be-chart__point--current' }));
      addSvgLabel(svg, { x: x(actualDay), y: padding.top - 14, class: 'be-chart__marker-label', 'text-anchor': 'middle' }, 'امروز');
    }

    const deadlineX = x(maxDay);
    svg.append(svgNode('line', { x1: deadlineX, x2: deadlineX, y1: padding.top, y2: height - padding.bottom, class: 'be-chart__deadline-line' }));
    addSvgLabel(svg, { x: deadlineX, y: padding.top - 31, class: 'be-chart__deadline-label', 'text-anchor': 'end' }, model.deadlineLabel || 'پایان افق تحلیل');

    const breakEvenPoint = model.breakEvenDay != null
      ? pointAtDay(points, model.breakEvenDay)
      : findValuePoint(points, 'sales', model.breakEvenSales) || findIntersection(points);
    if (breakEvenPoint) {
      svg.append(svgNode('circle', { cx: x(breakEvenPoint.day), cy: y(breakEvenPoint.sales), r: 8, class: 'be-chart__point be-chart__point--break-even' }));
      addSvgLabel(svg, {
        x: x(breakEvenPoint.day), y: Math.max(padding.top + 16, y(breakEvenPoint.sales) - 16),
        class: 'be-chart__break-even-label', 'text-anchor': 'middle',
      }, 'نقطهٔ سربه‌سر');
    }

    const axis = svgNode('g', { class: 'be-chart__axis' });
    axis.append(svgNode('line', { x1: padding.left, x2: width - padding.right, y1: height - padding.bottom, y2: height - padding.bottom }));
    const xTicks = [
      { day: 0, text: 'شروع دوره' },
      { day: actualDay, text: 'امروز' },
      { day: maxDay, text: model.deadlineLabel || 'ددلاین' },
    ].filter((tick, index, ticks) => index === 0 || tick.day !== ticks[index - 1].day);
    for (const tick of xTicks) {
      const position = x(tick.day);
      axis.append(svgNode('line', { x1: position, x2: position, y1: height - padding.bottom, y2: height - padding.bottom + 7 }));
      addSvgLabel(axis, { x: position, y: height - padding.bottom + 29, class: 'be-chart__x-label', 'text-anchor': tick.day === maxDay ? 'end' : tick.day === 0 ? 'start' : 'middle' }, tick.text);
      if (tick.day !== 0 && tick.day !== maxDay) addSvgLabel(axis, { x: position, y: height - padding.bottom + 48, class: 'be-chart__x-sub-label', 'text-anchor': 'middle' }, `روز ${formatNumber(tick.day)}`);
    }
    svg.append(axis);
    return svg;
  }

  function addMetric(parent, label, value, hint, tone = 'neutral') {
    const card = htmlNode('article', `westo-break-even__metric is-${tone}`);
    const labelNode = htmlNode('span', 'westo-break-even__metric-label', label);
    const valueNode = htmlNode('strong', 'westo-break-even__metric-value', value);
    const hintNode = htmlNode('small', 'westo-break-even__metric-hint', hint);
    card.append(labelNode, valueNode, hintNode);
    parent.append(card);
  }

  function buildEmptyState(host, model) {
    const missing = Array.isArray(model.raw?.missing) ? model.raw.missing : [];
    const status = String(model.raw?.dashboardStatus || model.status || '').toLowerCase();
    const reason = String(model.raw?.reason || '').toLowerCase();
    const message = String(model.raw?.message || '').trim();
    let title = 'دادهٔ کافی برای محاسبهٔ رسمی نقطهٔ سربه‌سر وجود ندارد.';
    let copy = 'فروش خالص و بهای موادِ همان فروش، به‌همراه هزینهٔ ثابت و ددلاین تأییدشده لازم است؛ تا آن زمان هیچ خط عبور یا سودی تخمین زده نمی‌شود.';
    if (status === 'needs_plan') {
      title = 'برنامه و ددلاین سوددهی هنوز تأیید نشده است.';
      copy = 'مبالغ پیشنهادی صرفاً برای بازبینی‌اند و تا ذخیرهٔ برنامه وارد محاسبه و دفتر مالی نمی‌شوند.';
    } else if (status === 'needs_branch') {
      title = 'برای تحلیل سودآوری ابتدا شعبه را مشخص کنید.';
      copy = 'محاسبهٔ شعبه‌ها با یکدیگر مخلوط نمی‌شود و بدون شعبه نموداری نمایش داده نخواهد شد.';
    } else if (missing.includes('variable_cost') || reason === 'actual_contribution_data_missing') {
      title = 'بهای موادِ فروش‌شده هنوز پوشش کافی ندارد.';
      copy = 'حاشیهٔ مشارکت با هزینهٔ متغیر صفر، صددرصد فرض نمی‌شود؛ دستور تهیه و ثبت بهای تمام‌شده را کامل کنید.';
    }
    const state = htmlNode('section', 'westo-break-even westo-break-even--empty');
    state.setAttribute('dir', 'rtl');
    state.setAttribute('role', 'status');
    state.setAttribute('aria-live', 'polite');
    state.append(
      htmlNode('p', 'westo-break-even__eyebrow', 'تحلیل سودآوری'),
      htmlNode('h2', 'westo-break-even__title', model.title),
      htmlNode('p', 'westo-break-even__empty-title', title),
      htmlNode('p', 'westo-break-even__empty-copy', message || copy),
    );
    host.replaceChildren(state);
  }

  function renderInto(host, input, options) {
    const model = getModel(input, options);
    if (!model.ready) {
      buildEmptyState(host, model);
      return;
    }

    const identifier = `westo-break-even-${++uid}`;
    const series = normalizeSeries(model, options);
    const section = htmlNode('section', 'westo-break-even');
    section.setAttribute('dir', 'rtl');
    section.setAttribute('role', 'region');
    section.setAttribute('aria-labelledby', `${identifier}-title`);
    section.setAttribute('data-break-even-chart', 'ready');
    String(options.className || '').split(/\s+/).filter((name) => /^[a-zA-Z0-9_-]+$/.test(name)).forEach((name) => section.classList.add(name));

    const header = htmlNode('header', 'westo-break-even__header');
    const headCopy = htmlNode('div', 'westo-break-even__head-copy');
    headCopy.append(
      htmlNode('p', 'westo-break-even__eyebrow', 'تحلیل سودآوری'),
      Object.assign(htmlNode('h2', 'westo-break-even__title', model.title), { id: `${identifier}-title` }),
      htmlNode('p', 'westo-break-even__subtitle', model.subtitle),
    );
    const passed = model.realizedSales >= model.breakEvenSales;
    const status = htmlNode('div', `westo-break-even__status ${passed ? 'is-success' : 'is-warning'}`);
    status.append(
      htmlNode('span', 'westo-break-even__status-dot'),
      htmlNode('strong', '', passed ? 'از سربه‌سر عبور کرده‌اید' : 'تا سربه‌سر فاصله دارید'),
      htmlNode('small', '', passed ? 'فروش از هزینهٔ تجمعی جلوتر است' : `${formatMoney(model.gap, { unit: model.unit })} فروش دیگر لازم است`),
    );
    header.append(headCopy, status);
    section.append(header);

    const metrics = htmlNode('div', 'westo-break-even__metrics');
    metrics.setAttribute('role', 'list');
    addMetric(metrics, 'فروش محقق‌شده', formatMoney(model.realizedSales, { unit: model.unit }), 'فروش تجمعی تا امروز', 'info');
    addMetric(metrics, 'فروش سربه‌سر', formatMoney(model.breakEvenSales, { unit: model.unit }), 'جایی که فروش و هزینه برابر می‌شوند', passed ? 'success' : 'warning');
    addMetric(metrics, 'فاصله تا هدف', model.gap > 0 ? formatMoney(model.gap, { unit: model.unit }) : 'پوشش داده شده', model.gap > 0 ? 'فروش باقی‌مانده تا عبور از مرز' : 'فروش محقق‌شده از هدف عبور کرده است', model.gap > 0 ? 'danger' : 'success');
    addMetric(metrics, 'حاشیهٔ مشارکت', formatPercent(model.contributionMarginRatio), 'پس از هزینهٔ متغیر، برای پوشش هزینه ثابت', 'neutral');
    if (model.requiredDailySales != null || model.remainingDays != null) {
      addMetric(metrics, 'شتاب لازم', model.requiredDailySales != null ? formatMoney(model.requiredDailySales, { unit: model.unit }) : '—', model.remainingDays != null ? `${formatNumber(model.remainingDays)} روز تا ددلاین` : 'روز باقی‌مانده تعریف نشده', 'info');
    }
    section.append(metrics);

    const progress = htmlNode('section', 'westo-break-even__progress');
    progress.setAttribute('aria-label', 'پیشرفت تا فروش سربه‌سر');
    const progressCopy = htmlNode('div', 'westo-break-even__progress-copy');
    progressCopy.append(
      htmlNode('strong', '', 'مسیر تا هدف'),
      htmlNode('span', '', model.deadlineLabel ? `ددلاین: ${model.deadlineLabel}` : 'ددلاین برای این تحلیل ثبت نشده است'),
    );
    const ratio = model.targetSales > 0 ? clamp(model.realizedSales / model.targetSales, 0, 1) : 0;
    const bar = htmlNode('div', 'westo-break-even__progress-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(Math.round(model.targetSales || 0)));
    bar.setAttribute('aria-valuenow', String(Math.round(model.realizedSales || 0)));
    bar.setAttribute('aria-valuetext', `${formatPercent(ratio)} مسیر تا هدف پوشش داده شده`);
    const fill = htmlNode('span', 'westo-break-even__progress-fill');
    fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
    bar.append(fill);
    const progressValue = htmlNode('strong', 'westo-break-even__progress-value', formatPercent(ratio));
    progress.append(progressCopy, bar, progressValue);
    section.append(progress);

    const body = htmlNode('div', 'westo-break-even__body');
    const figure = htmlNode('figure', 'westo-break-even__figure');
    const figureHead = htmlNode('figcaption', 'westo-break-even__figure-head');
    const figureText = htmlNode('div', '');
    figureText.append(
      htmlNode('strong', '', 'روند تجمعی تا ددلاین'),
      htmlNode('span', '', 'خط پیوسته: عملکرد ثبت‌شده · خط نقطه‌چین: مسیر پیش‌بینی‌شده'),
    );
    const legend = htmlNode('ul', 'westo-break-even__legend');
    [['sales', 'فروش تجمعی'], ['cost', 'هزینه تجمعی'], ['loss', 'زیان'], ['profit', 'سود']].forEach(([kind, label]) => {
      const item = htmlNode('li', `is-${kind}`);
      item.append(htmlNode('i', ''), htmlNode('span', '', label));
      legend.append(item);
    });
    figureHead.append(figureText, legend);
    figure.append(figureHead, createChart(model, series, identifier));
    body.append(figure);

    const insights = htmlNode('aside', 'westo-break-even__insights');
    insights.setAttribute('aria-label', 'توضیح وضعیت نقطه سربه‌سر');
    insights.append(htmlNode('h3', '', 'برداشت سریع'));
    const messages = htmlNode('ul', 'westo-break-even__insight-list');
    const fixedHint = model.fixedCosts > 0 ? `هزینهٔ ثابت دوره ${formatMoney(model.fixedCosts, { unit: model.unit })} است.` : 'هزینهٔ ثابت جداگانه در داده ثبت نشده است.';
    const actionHint = passed
      ? 'کسب‌وکار از مرز سربه‌سر عبور کرده؛ تمرکز بعدی روی حفظ حاشیهٔ سود و کنترل هزینه متغیر است.'
      : model.requiredDailySales != null
        ? `برای رسیدن به هدف، میانگین فروش روزانه باید دست‌کم ${formatMoney(model.requiredDailySales, { unit: model.unit })} باشد.`
        : 'برای رسیدن به هدف، فروش باقی‌مانده را بین روزهای بازِ ددلاین تقسیم کنید.';
    [
      fixedHint,
      model.contributionMarginRatio != null ? `از هر فروش، ${formatPercent(model.contributionMarginRatio)} برای پوشش هزینهٔ ثابت و سود باقی می‌ماند.` : 'حاشیهٔ مشارکت در داده ثبت نشده است؛ نمودار از هزینه‌های تجمعی موجود استفاده می‌کند.',
      actionHint,
    ].forEach((message) => messages.append(htmlNode('li', '', message)));
    insights.append(messages);
    const source = model.raw?.source && typeof model.raw.source === 'object' ? model.raw.source : null;
    const sourceCopy = source?.label
      ? `منبع: ${source.label}${source.official ? ' (دفتر مالی قطعی)' : ' (منبع عملیاتی هم‌مبنا)'}. اعداد فقط خواندنی‌اند و تغییری در داده‌های مالی ایجاد نمی‌کنند.`
      : 'منبع مالی هم‌مبنا برای این محاسبه ثبت شده است. اعداد فقط خواندنی‌اند و تغییری در داده‌های مالی ایجاد نمی‌کنند.';
    const sourceNote = htmlNode('p', 'westo-break-even__source-note', sourceCopy);
    insights.append(sourceNote);
    body.append(insights);
    section.append(body);
    host.replaceChildren(section);
  }

  function resolveTarget(target) {
    if (target instanceof Element) return target;
    if (typeof target === 'string') return document.querySelector(target);
    return null;
  }

  function mount(target, data = {}, options = {}) {
    const root = resolveTarget(target);
    if (!root) throw new Error('عنصر مقصد نمودار نقطهٔ سربه‌سر پیدا نشد.');
    const previous = INSTANCES.get(root);
    if (previous) previous.destroy();
    const host = document.createElement('div');
    host.className = 'westo-break-even-host';
    root.replaceChildren(host);
    const instance = {
      element: host,
      root,
      data,
      options: { ...options },
      update(nextData = data, nextOptions = {}) {
        this.data = nextData;
        this.options = { ...this.options, ...nextOptions };
        renderInto(host, this.data, this.options);
        return this;
      },
      destroy() {
        if (INSTANCES.get(root) === this) INSTANCES.delete(root);
        host.remove();
      },
    };
    INSTANCES.set(root, instance);
    instance.update(data, options);
    return instance;
  }

  function update(targetOrInstance, data, options) {
    if (targetOrInstance && typeof targetOrInstance.update === 'function') return targetOrInstance.update(data, options);
    const root = resolveTarget(targetOrInstance);
    const instance = root && INSTANCES.get(root);
    if (!instance) throw new Error('نمونهٔ نمودار نقطهٔ سربه‌سر برای به‌روزرسانی پیدا نشد.');
    return instance.update(data, options);
  }

  function destroy(targetOrInstance) {
    if (targetOrInstance && typeof targetOrInstance.destroy === 'function') return targetOrInstance.destroy();
    const root = resolveTarget(targetOrInstance);
    const instance = root && INSTANCES.get(root);
    if (instance) instance.destroy();
  }

  window.WestoBreakEvenChart = Object.freeze({
    version: '1.0.0',
    mount,
    render: mount,
    update,
    destroy,
    formatMoney,
  });
})();
