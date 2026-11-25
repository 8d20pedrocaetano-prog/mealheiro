import { BarChart, HeatmapChart, LineChart, SankeyChart, TreemapChart } from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import type { ChartClick, EChartProps } from './EChart';

echarts.use([
  BarChart,
  LineChart,
  TreemapChart,
  SankeyChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CalendarComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default function EChartImpl({ option, height = 240, onClick, ariaLabel }: EChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onClick);
  useEffect(() => {
    click.current = onClick;
  });

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => click.current?.(p as unknown as ChartClick));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ height, width: '100%' }} />;
}
