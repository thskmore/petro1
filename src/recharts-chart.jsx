import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

/* -------------------------------------------------------------
 * 1. DAILY FUEL RECHARTS LINE CHART (Total & Moving Avg)
 * ------------------------------------------------------------- */
const DailySalesTooltip = ({ active, payload, label, metric, viewMode }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isLitres = metric === 'vol';
    return (
      <div
        style={{
          background: 'var(--card, #ffffff)',
          border: '1px solid var(--line, #cbd5e1)',
          padding: '10px 12px',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
          fontSize: '12px',
          lineHeight: '1.4',
          color: 'var(--ink, #16262b)',
          minWidth: '175px',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontWeight: 700, borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '4px', marginBottom: '6px' }}>
          {data.formattedDate || label} {data.dayOfWeek ? `(${data.dayOfWeek})` : ''}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '3px' }}>
          <span style={{ color: 'var(--mute, #64748b)' }}>Total Volume:</span>
          <b>{Math.round(data.litres || 0).toLocaleString('en-IN')} L</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '3px' }}>
          <span style={{ color: 'var(--mute, #64748b)' }}>Sales Revenue:</span>
          <b style={{ color: 'var(--ok, #0b7a5f)' }}>₹{Math.round(data.revenue || 0).toLocaleString('en-IN')}</b>
        </div>
        {viewMode !== 'byfuel' && data.ma7 > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '3px', color: '#b45309' }}>
            <span>7-Day Moving Avg:</span>
            <b>{isLitres ? `${Math.round(data.ma7).toLocaleString('en-IN')} L` : `₹${Math.round(data.ma7).toLocaleString('en-IN')}`}</b>
          </div>
        )}
        {data.hsdLitres > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11px', marginTop: '4px', color: '#2563eb' }}>
            <span>Diesel (HSD):</span>
            <b>{Math.round(data.hsdLitres).toLocaleString('en-IN')} L</b>
          </div>
        )}
        {data.msLitres > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11px', color: '#059669' }}>
            <span>Petrol (MS):</span>
            <b>{Math.round(data.msLitres).toLocaleString('en-IN')} L</b>
          </div>
        )}
        {data.powerLitres > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '11px', color: '#d97706' }}>
            <span>Power petrol:</span>
            <b>{Math.round(data.powerLitres).toLocaleString('en-IN')} L</b>
          </div>
        )}
      </div>
    );
  }
  return null;
};

export function DailyFuelRechartsLineChart({ data, metric = 'vol', viewMode = 'total' }) {
  if (!data || !data.length) {
    return (
      <div style={{ padding: '36px 10px', textAlign: 'center', color: 'var(--mute, #64748b)' }}>
        No sales entries available for this period. Complete shift duties to generate trends.
      </div>
    );
  }

  const isLitres = metric === 'vol';
  const valKey = isLitres ? 'litres' : 'revenue';
  const avgVal = Math.round(data.reduce((sum, d) => sum + (d[valKey] || 0), 0) / data.length);
  const isByFuel = viewMode === 'byfuel';

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 14, left: 2, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" opacity={0.6} />
          <XAxis dataKey="label" stroke="var(--mute, #64748b)" fontSize={11} tickLine={false} dy={4} />
          <YAxis
            stroke="var(--mute, #64748b)"
            fontSize={11}
            tickLine={false}
            dx={-4}
            tickFormatter={(v) =>
              isLitres
                ? v >= 1000 ? `${(v / 1000).toFixed(1)}k L` : `${v} L`
                : v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
            }
          />
          <Tooltip content={<DailySalesTooltip metric={metric} viewMode={viewMode} />} />
          {!isByFuel && (
            <ReferenceLine
              y={avgVal}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{
                value: `30d Avg: ${isLitres ? `${avgVal} L` : `₹${avgVal.toLocaleString('en-IN')}`}`,
                fill: 'var(--mute, #64748b)',
                fontSize: 10,
                position: 'insideTopRight',
              }}
            />
          )}

          {isByFuel ? (
            <>
              <Line
                type="monotone"
                dataKey={isLitres ? "hsdLitres" : "hsdRevenue"}
                name="Diesel (HSD)"
                stroke="#2563eb"
                strokeWidth={2.2}
                dot={{ r: 2.5, fill: '#2563eb' }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey={isLitres ? "msLitres" : "msRevenue"}
                name="Petrol (MS)"
                stroke="#059669"
                strokeWidth={2.2}
                dot={{ r: 2.5, fill: '#059669' }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey={isLitres ? "powerLitres" : "powerRevenue"}
                name="Power petrol"
                stroke="#d97706"
                strokeWidth={2}
                dot={{ r: 2, fill: '#d97706' }}
                activeDot={{ r: 5 }}
              />
            </>
          ) : (
            <>
              <Line
                type="monotone"
                dataKey={valKey}
                name={isLitres ? 'Total Daily Volume (L)' : 'Total Daily Revenue (₹)'}
                stroke="#0b7a5f"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#0b7a5f', stroke: '#ffffff', strokeWidth: 1.5 }}
                activeDot={{ r: 6, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="ma7"
                name="7-Day Moving Avg"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
              />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const rootsMap = new WeakMap();

window.renderRechartsDailySales = function (container, rawDailyData, metric, viewMode) {
  if (!container) return;

  const sorted = (rawDailyData || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const last30 = sorted.slice(-30);

  const data = last30.map((d, idx) => {
    const parts = (d.date || '').split('-');
    const dt = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(d.date);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = `${dt.getDate()} ${monthNames[dt.getMonth()]}`;
    const dayOfWeek = dayNames[dt.getDay()];

    const windowStart = Math.max(0, idx - 6);
    const windowItems = last30.slice(windowStart, idx + 1);
    const maKey = metric === 'rev' ? 'revenue' : 'litres';
    const ma7 = Math.round(windowItems.reduce((acc, curr) => acc + (curr[maKey] || 0), 0) / windowItems.length);

    const hsd = d.byFuel && d.byFuel['Diesel (HSD)'] ? d.byFuel['Diesel (HSD)'] : {};
    const ms = d.byFuel && d.byFuel['Petrol (MS)'] ? d.byFuel['Petrol (MS)'] : {};
    const power = d.byFuel && d.byFuel['Power petrol'] ? d.byFuel['Power petrol'] : {};

    return {
      date: d.date,
      formattedDate: `${dt.getDate()} ${monthNames[dt.getMonth()]} ${dt.getFullYear()}`,
      label,
      dayOfWeek,
      litres: Math.round((d.litres || 0) * 10) / 10,
      revenue: Math.round(d.revenue || 0),
      ma7,
      hsdLitres: Math.round((hsd.litres || 0) * 10) / 10,
      hsdRevenue: Math.round(hsd.revenue || 0),
      msLitres: Math.round((ms.litres || 0) * 10) / 10,
      msRevenue: Math.round(ms.revenue || 0),
      powerLitres: Math.round((power.litres || 0) * 10) / 10,
      powerRevenue: Math.round(power.revenue || 0),
    };
  });

  let root = rootsMap.get(container);
  if (!root) {
    root = ReactDOM.createRoot(container);
    rootsMap.set(container, root);
  }

  root.render(
    React.createElement(DailyFuelRechartsLineChart, {
      data,
      metric: metric || 'vol',
      viewMode: viewMode || 'total',
    })
  );
};


/* -------------------------------------------------------------
 * 2. COMPARATIVE FUEL TREND CHART (Petrol vs. Diesel vs. Others)
 * ------------------------------------------------------------- */
const FUEL_COLORS = {
  'Diesel (HSD)': '#2563eb',
  'Petrol (MS)': '#059669',
  'Power petrol': '#d97706',
  'Power diesel': '#4f46e5',
  'Speed': '#ea580c',
  'Other': '#7c3aed',
};

function getFuelColor(fuelName, index) {
  if (FUEL_COLORS[fuelName]) return FUEL_COLORS[fuelName];
  const lower = (fuelName || '').toLowerCase();
  if (lower.includes('diesel') || lower.includes('hsd')) return '#2563eb';
  if (lower.includes('power') || lower.includes('speed') || lower.includes('turbo')) return '#d97706';
  if (lower.includes('petrol') || lower.includes('ms')) return '#059669';
  const palette = ['#7c3aed', '#ec4899', '#0284c7', '#14b8a6', '#64748b'];
  return palette[index % palette.length];
}

const FuelComparisonTooltip = ({ active, payload, label, metric, fuelKeys }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isLitres = metric === 'vol';
    const total = fuelKeys.reduce((acc, k) => acc + (data[k + '_val'] || 0), 0);

    return (
      <div
        style={{
          background: 'var(--card, #ffffff)',
          border: '1px solid var(--line, #cbd5e1)',
          padding: '10px 14px',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          fontSize: '12px',
          lineHeight: '1.45',
          color: 'var(--ink, #16262b)',
          minWidth: '200px',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontWeight: 700, borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: '4px', marginBottom: '6px' }}>
          {data.formattedDate || label} {data.dayOfWeek ? `(${data.dayOfWeek})` : ''}
        </div>
        {payload.map((entry) => {
          const fuelName = entry.name;
          const val = entry.value || 0;
          const share = total > 0 ? Math.round((val / total) * 100) : 0;
          return (
            <div
              key={fuelName}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '3px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
                <span>{fuelName}:</span>
              </span>
              <span>
                <b>{isLitres ? `${Math.round(val).toLocaleString('en-IN')} L` : `₹${Math.round(val).toLocaleString('en-IN')}`}</b>
                <span style={{ color: 'var(--mute, #64748b)', fontSize: '11px', marginLeft: '5px' }}>({share}%)</span>
              </span>
            </div>
          );
        })}
        <div
          style={{
            borderTop: '1px dashed var(--line, #e2e8f0)',
            marginTop: '6px',
            paddingTop: '5px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11.5px',
          }}
        >
          <span style={{ color: 'var(--mute, #64748b)' }}>Combined Fuel Sales:</span>
          <b>{isLitres ? `${Math.round(total).toLocaleString('en-IN')} L` : `₹${Math.round(total).toLocaleString('en-IN')}`}</b>
        </div>
      </div>
    );
  }
  return null;
};

export function FuelComparisonRechartsChart({ rawData, initialMetric = 'vol' }) {
  const [metric, setMetric] = useState(initialMetric);
  const [chartType, setChartType] = useState('lines'); // 'lines' or 'area'
  const [hiddenFuels, setHiddenFuels] = useState({});

  // 1. Detect all fuel types present
  const fuelList = useMemo(() => {
    const set = new Set();
    (rawData || []).forEach((d) => {
      if (d.byFuel) {
        Object.keys(d.byFuel).forEach((f) => set.add(f));
      }
    });
    const priority = ['Diesel (HSD)', 'Petrol (MS)', 'Power petrol', 'Power diesel'];
    return Array.from(set).sort((a, b) => {
      const ia = priority.indexOf(a);
      const ib = priority.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [rawData]);

  // 2. Format data series
  const data = useMemo(() => {
    const sorted = (rawData || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return sorted.map((d) => {
      const parts = (d.date || '').split('-');
      const dt = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(d.date);
      const label = `${dt.getDate()} ${monthNames[dt.getMonth()]}`;
      const dayOfWeek = dayNames[dt.getDay()];

      const row = {
        date: d.date,
        formattedDate: `${dt.getDate()} ${monthNames[dt.getMonth()]} ${dt.getFullYear()}`,
        label,
        dayOfWeek,
      };

      fuelList.forEach((f) => {
        const fObj = (d.byFuel && d.byFuel[f]) || {};
        const val = metric === 'vol' ? (fObj.litres || 0) : (fObj.revenue || 0);
        row[f + '_val'] = Math.round(val * 10) / 10;
      });

      return row;
    });
  }, [rawData, fuelList, metric]);

  // 3. Compute comparative summary metrics
  const summary = useMemo(() => {
    const totals = {};
    const maxDay = {};
    fuelList.forEach((f) => {
      totals[f] = 0;
      maxDay[f] = { val: 0, date: '' };
    });

    data.forEach((d) => {
      fuelList.forEach((f) => {
        const val = d[f + '_val'] || 0;
        totals[f] += val;
        if (val > maxDay[f].val) {
          maxDay[f] = { val, date: d.date };
        }
      });
    });

    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
    const shares = {};
    fuelList.forEach((f) => {
      shares[f] = grandTotal > 0 ? Math.round((totals[f] / grandTotal) * 1000) / 10 : 0;
    });

    return { totals, shares, maxDay, grandTotal };
  }, [data, fuelList]);

  const toggleFuel = (f) => {
    setHiddenFuels((prev) => ({ ...prev, [f]: !prev[f] }));
  };

  const isLitres = metric === 'vol';
  const activeFuels = fuelList.filter((f) => !hiddenFuels[f]);

  if (!data || !data.length || !fuelList.length) {
    return (
      <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--mute, #64748b)' }}>
        No fuel breakdown data available for comparison yet. Complete shift duties to generate trends.
      </div>
    );
  }

  return (
    <div>
      {/* Sub-controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {fuelList.map((f, idx) => {
            const color = getFuelColor(f, idx);
            const isHidden = !!hiddenFuels[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFuel(f)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  padding: '4px 10px',
                  borderRadius: '16px',
                  border: `1px solid ${isHidden ? 'var(--line, #cbd5e1)' : color}`,
                  background: isHidden ? 'var(--card, #fff)' : `${color}18`,
                  color: isHidden ? 'var(--mute, #64748b)' : 'var(--ink, #16262b)',
                  cursor: 'pointer',
                  opacity: isHidden ? 0.55 : 1,
                  fontWeight: isHidden ? 500 : 700,
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isHidden ? 'var(--mute, #94a3b8)' : color,
                  }}
                />
                <span>{f}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className={chartType === 'lines' ? '' : 'ghost'}
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => setChartType('lines')}
          >
            Lines
          </button>
          <button
            type="button"
            className={chartType === 'area' ? '' : 'ghost'}
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => setChartType('area')}
          >
            Stacked Area
          </button>
          <button
            type="button"
            className={metric === 'vol' ? '' : 'ghost'}
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => setMetric('vol')}
          >
            Litres (L)
          </button>
          <button
            type="button"
            className={metric === 'rev' ? '' : 'ghost'}
            style={{ padding: '4px 8px', fontSize: '11px' }}
            onClick={() => setMetric('rev')}
          >
            Revenue (₹)
          </button>
        </div>
      </div>

      {/* Main Recharts Container */}
      <div style={{ width: '100%', height: 270 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" opacity={0.6} />
              <XAxis dataKey="label" stroke="var(--mute, #64748b)" fontSize={11} tickLine={false} dy={4} />
              <YAxis
                stroke="var(--mute, #64748b)"
                fontSize={11}
                tickLine={false}
                dx={-4}
                tickFormatter={(v) =>
                  isLitres
                    ? v >= 1000 ? `${(v / 1000).toFixed(1)}k L` : `${v} L`
                    : v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                }
              />
              <Tooltip content={<FuelComparisonTooltip metric={metric} fuelKeys={activeFuels} />} />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }} />
              {fuelList.map((f, idx) => {
                if (hiddenFuels[f]) return null;
                const color = getFuelColor(f, idx);
                return (
                  <Area
                    key={f}
                    type="monotone"
                    dataKey={f + '_val'}
                    name={f}
                    stackId="1"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.35}
                  />
                );
              })}
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" opacity={0.6} />
              <XAxis dataKey="label" stroke="var(--mute, #64748b)" fontSize={11} tickLine={false} dy={4} />
              <YAxis
                stroke="var(--mute, #64748b)"
                fontSize={11}
                tickLine={false}
                dx={-4}
                tickFormatter={(v) =>
                  isLitres
                    ? v >= 1000 ? `${(v / 1000).toFixed(1)}k L` : `${v} L`
                    : v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                }
              />
              <Tooltip content={<FuelComparisonTooltip metric={metric} fuelKeys={activeFuels} />} />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }} />
              {fuelList.map((f, idx) => {
                if (hiddenFuels[f]) return null;
                const color = getFuelColor(f, idx);
                return (
                  <Line
                    key={f}
                    type="monotone"
                    dataKey={f + '_val'}
                    name={f}
                    stroke={color}
                    strokeWidth={2.4}
                    dot={{ r: 2.5, fill: color }}
                    activeDot={{ r: 5.5, stroke: '#ffffff', strokeWidth: 1.5 }}
                  />
                );
              })}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Comparative Ratio & Share Insights */}
      <div
        style={{
          marginTop: '12px',
          padding: '10px 12px',
          background: 'var(--bg, #f1f5f9)',
          borderRadius: '8px',
          border: '1px solid var(--line, #cbd5e1)',
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: '11px',
            letterSpacing: '0.4px',
            textTransform: 'uppercase',
            marginBottom: '8px',
            color: 'var(--ink, #16262b)',
          }}
        >
          Product Volume Ratio & Share Breakdown
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
          {fuelList.map((f, idx) => {
            const color = getFuelColor(f, idx);
            const tot = summary.totals[f] || 0;
            const sh = summary.shares[f] || 0;
            const avg = Math.round(tot / (data.length || 1));
            return (
              <div key={f} style={{ background: 'var(--card, #fff)', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--line, #e2e8f0)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                  <span>{f}</span>
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--ink, #16262b)', margin: '2px 0' }}>
                  {isLitres ? `${Math.round(tot).toLocaleString('en-IN')} L` : `₹${Math.round(tot).toLocaleString('en-IN')}`}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--mute, #64748b)' }}>
                  <b>{sh}%</b> share &middot; Avg {isLitres ? `${avg} L/d` : `₹${avg}/d`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const comparisonRootsMap = new WeakMap();

window.renderRechartsFuelComparison = function (container, rawDailyData, options = {}) {
  if (!container) return;

  let root = comparisonRootsMap.get(container);
  if (!root) {
    root = ReactDOM.createRoot(container);
    comparisonRootsMap.set(container, root);
  }

  root.render(
    React.createElement(FuelComparisonRechartsChart, {
      rawData: rawDailyData || [],
      initialMetric: options.metric || 'vol',
    })
  );
};
