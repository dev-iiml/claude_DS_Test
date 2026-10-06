/** Preview-only specimens for tokens.viz-palette. Never imported by the app. */
import * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SERIES = [
  {
    name: "Instagram",
    v: [12, 14, 15, 18, 21, 24, 26, 29, 31, 33, 36, 40],
    cls: "stroke-viz-1",
    dot: "fill-viz-1",
    key: "bg-viz-1",
  },
  {
    name: "YouTube",
    v: [4, 5, 5, 6, 7, 7, 8, 9, 10, 11, 11, 12],
    cls: "stroke-viz-2",
    dot: "fill-viz-2",
    key: "bg-viz-2",
  },
  { name: "Moj", v: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4], cls: "stroke-viz-3", dot: "fill-viz-3", key: "bg-viz-3" },
];
const X = (i: number) => 40 + i * 38;
const Y = (v: number) => 160 - v * 3.2;

export const SHARED = {};
export const AFTER = {
  VizAfter: () => (
    <div className="min-h-full bg-paper p-5 text-ink">
      <Card>
        <CardHeader>
          <CardTitle>Combined audience (K)</CardTitle>
          <CardDescription>About your creator business — not a credit score.</CardDescription>
        </CardHeader>
        <CardContent>
          <svg viewBox="0 0 560 190" className="w-full" role="img" aria-label="Audience by platform, last 12 months">
            {[0, 10, 20, 30, 40].map((t) => (
              <g key={t}>
                <line x1="40" x2="458" y1={Y(t)} y2={Y(t)} className="stroke-line" strokeWidth="1" />
                <text x="32" y={Y(t) + 4} textAnchor="end" className="fill-ink-subtle text-caption-2">
                  {t}
                </text>
              </g>
            ))}
            {SERIES.map((s) => (
              <g key={s.name}>
                <polyline
                  fill="none"
                  className={s.cls}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  points={s.v.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
                />
                <circle cx={X(11)} cy={Y(s.v[11]!)} r="4" className={s.dot} />
                <text x={X(11) + 8} y={Y(s.v[11]!) + 4} className="fill-ink text-caption">
                  {s.name}
                </text>
              </g>
            ))}
          </svg>
          <div className="mt-3 flex flex-wrap gap-4">
            {["bg-viz-1", "bg-viz-2", "bg-viz-3", "bg-viz-4"].map((c, i) => (
              <span key={c} className="flex items-center gap-1.5 text-footnote text-ink-muted">
                <span className={`size-3 rounded-sm ${c}`} /> viz-{i + 1}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  ),
};
