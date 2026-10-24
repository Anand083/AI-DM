"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPosition } from "@/lib/rank-math";

export type HistoryPoint = { date: string; position: number | null };

/**
 * Position over time. Position 1 is at the top, so the axis is upside down. Days where the
 * keyword was not in the top 100 are left as gaps. A table below the chart has the same numbers.
 */
export function PositionChart({ history, keyword }: { history: HistoryPoint[]; keyword: string }) {
  const ranked = history.filter((h) => h.position !== null).map((h) => h.position as number);
  const latest = history[history.length - 1];
  const best = ranked.length > 0 ? Math.min(...ranked) : null;
  const worst = ranked.length > 0 ? Math.max(...ranked) : 10;
  const bottom = Math.min(100, Math.max(10, Math.ceil((worst + 2) / 10) * 10));
  const summary = `Position history for ${keyword}: ${history.length} days. Latest position ${formatPosition(latest?.position ?? null)}${
    best === null ? "" : `, best ${best}`
  }.`;

  return (
    <figure>
      <div role="img" aria-label={summary} className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis
              reversed
              domain={[1, bottom]}
              allowDecimals={false}
              tick={{ fontSize: 12 }}
              width={36}
            />
            <Tooltip
              formatter={(value) => [
                value === null || value === undefined ? "100+" : String(value),
                "Position",
              ]}
              labelFormatter={(label) => String(label)}
              contentStyle={{ fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="position"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        Position 1 is at the top. Gaps mean the page was not in the top 100.
      </figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">Show the numbers</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left" aria-label={`Position history for ${keyword}`}>
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Position
                </th>
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((h) => (
                <tr key={h.date} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-1.5">{h.date}</td>
                  <td className="px-3 py-1.5 tabular-nums">{formatPosition(h.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
