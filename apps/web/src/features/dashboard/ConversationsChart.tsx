import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { format, parseISO, isValid } from 'date-fns';
import { formatNumber } from '@/lib/utils';

const STROKE = '#4f46e5';

function label(date: string, pattern: string) {
  const d = parseISO(date);
  return isValid(d) ? format(d, pattern) : date;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const date = (p.payload as { date: string }).date;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-slate-500">{label(date, 'EEE, MMM d')}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <span className="h-2 w-2 rounded-full" style={{ background: STROKE }} aria-hidden="true" />
        {formatNumber(Number(p.value ?? 0))} conversations
      </p>
    </div>
  );
}

export function ConversationsChart({ series }: { series: { date: string; count: number }[] }) {
  const total = series.reduce((s, x) => s + x.count, 0);
  return (
    <figure className="h-64 w-full" aria-label={`Conversations per day, ${formatNumber(total)} in total`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STROKE} stopOpacity={0.18} />
              <stop offset="100%" stopColor={STROKE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eef2f7" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(d: string) => label(d, 'MMM d')}
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="count"
            stroke={STROKE}
            strokeWidth={2}
            fill="url(#convFill)"
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: STROKE }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Conversations per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Conversations</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.date}>
              <td>{s.date}</td>
              <td>{s.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
