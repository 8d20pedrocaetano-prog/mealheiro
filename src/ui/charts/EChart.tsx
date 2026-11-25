import { lazy, Suspense } from 'react';
import type { EChartsCoreOption } from 'echarts/core';

/** ECharts is loaded lazily so the app shell and numbers render before the chart library. */
const Impl = lazy(() => import('./EChartImpl'));

export type EChartsOption = EChartsCoreOption;
export type ChartClick = {
  seriesName?: string;
  name?: string;
  dataIndex: number;
  data?: unknown;
  value?: unknown;
};

export interface EChartProps {
  option: EChartsOption;
  height?: number;
  onClick?: (p: ChartClick) => void;
  ariaLabel: string;
}

export function EChart(props: EChartProps) {
  return (
    <Suspense
      fallback={<div className="skeleton" style={{ height: props.height ?? 240 }} aria-hidden="true" />}
    >
      <Impl {...props} />
    </Suspense>
  );
}
