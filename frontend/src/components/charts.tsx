import ReactECharts from 'echarts-for-react'
import { fmtInt, fmtPercent } from '../format'
import { useTheme } from '../theme'
import type { ObjectRow, OwnershipRow, TsPoint } from '../types'

interface ChartPalette {
  axis: string
  grid: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  green: string
  red: string
  blue: string
  purple: string
  palette: string[]
  others: string
  tileLabel: string
  tileBorder: string
  zoomFill: string
  zoomHandle: string
}

const DARK_PALETTE: ChartPalette = {
  axis: '#8b99a8',
  grid: '#1b2634',
  tooltipBg: '#16202c',
  tooltipBorder: '#223041',
  tooltipText: '#e6edf3',
  green: '#3fb950',
  red: '#f85149',
  blue: '#4f8cff',
  purple: '#a371f7',
  palette: ['#a371f7', '#4f8cff', '#3fb950', '#d29922', '#f778ba', '#39c5cf', '#ffa657', '#8b99a8'],
  others: '#39475a',
  tileLabel: '#ffffff',
  tileBorder: '#121a23',
  zoomFill: 'rgba(79, 140, 255, 0.14)',
  zoomHandle: '#4a5b6e',
}

const LIGHT_PALETTE: ChartPalette = {
  axis: '#5a6875',
  grid: '#e3e7ec',
  tooltipBg: '#ffffff',
  tooltipBorder: '#d3dae2',
  tooltipText: '#1b2430',
  green: '#1a7f37',
  red: '#cf222e',
  blue: '#2563eb',
  purple: '#8250df',
  palette: ['#8250df', '#2563eb', '#1a7f37', '#bf8700', '#bf3989', '#1b7c83', '#bc4c00', '#5a6875'],
  others: '#a9b4c0',
  tileLabel: '#ffffff',
  tileBorder: '#ffffff',
  zoomFill: 'rgba(37, 99, 235, 0.12)',
  zoomHandle: '#b7c2ce',
}

function useChartPalette(): ChartPalette {
  const { theme } = useTheme()
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE
}

function tooltipStyle(palette: ChartPalette) {
  return {
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.tooltipText, fontSize: 12 },
  }
}

export function ChurnChart({ data, height = 280 }: { data: TsPoint[]; height?: number }) {
  const c = useChartPalette()
  const option = {
    grid: { left: 56, right: 18, top: 34, bottom: data.length > 40 ? 54 : 26 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(c),
      formatter: (params: Array<{ seriesName: string; value: number; axisValueLabel?: string }>) => {
        if (!params?.length) return ''
        const lines = [`<b>${params[0].axisValueLabel ?? ''}</b>`]
        for (const item of params) {
          const value = item.seriesName === 'removed' ? -item.value : item.value
          lines.push(`${item.seriesName}: ${fmtInt(value)}`)
        }
        return lines.join('<br/>')
      },
    },
    legend: { top: 0, textStyle: { color: c.axis, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    xAxis: {
      type: 'category',
      data: data.map((point) => point.bucket),
      axisLabel: { color: c.axis, fontSize: 10 },
      axisLine: { lineStyle: { color: c.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: c.axis, fontSize: 10 },
      splitLine: { lineStyle: { color: c.grid } },
    },
    dataZoom:
      data.length > 40
        ? [
            { type: 'inside' },
            {
              type: 'slider',
              height: 14,
              bottom: 4,
              borderColor: c.grid,
              backgroundColor: 'transparent',
              fillerColor: c.zoomFill,
              handleStyle: { color: c.zoomHandle, borderColor: c.tooltipBorder },
              textStyle: { color: c.axis, fontSize: 9 },
            },
          ]
        : undefined,
    series: [
      {
        name: 'added',
        type: 'bar',
        stack: 'churn',
        itemStyle: { color: c.green, borderRadius: [2, 2, 0, 0] },
        data: data.map((point) => point.added),
      },
      {
        name: 'removed',
        type: 'bar',
        stack: 'churn',
        itemStyle: { color: c.red, borderRadius: [0, 0, 2, 2] },
        data: data.map((point) => -point.removed),
      },
      {
        name: 'growth',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: c.blue, width: 2 },
        itemStyle: { color: c.blue },
        data: data.map((point) => point.growth),
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

export function TopAuthorsChart({
  rows,
  height = 280,
}: {
  rows: { id: string; name: string; churn: number; ownership: number }[]
  height?: number
}) {
  const c = useChartPalette()
  const data = rows.slice(0, 8).slice().reverse()
  const option = {
    grid: { left: 8, right: 60, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(c),
      formatter: (params: Array<{ dataIndex: number }>) => {
        const item = data[params[0]?.dataIndex ?? 0]
        if (!item) return ''
        return `<b>${item.name}</b><br/>churn: ${fmtInt(item.churn)}<br/>ownership: ${fmtPercent(item.ownership)}`
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: c.axis, fontSize: 10 },
      splitLine: { lineStyle: { color: c.grid } },
    },
    yAxis: {
      type: 'category',
      data: data.map((row) => row.name),
      axisLabel: { color: c.axis, fontSize: 11, width: 130, overflow: 'truncate' },
      axisLine: { lineStyle: { color: c.grid } },
    },
    series: [
      {
        name: 'churn',
        type: 'bar',
        barMaxWidth: 15,
        itemStyle: { color: c.purple, borderRadius: [0, 3, 3, 0] },
        label: {
          show: true,
          position: 'right',
          color: c.axis,
          fontSize: 10,
          formatter: (params: { value: number }) => fmtInt(params.value),
        },
        data: data.map((row) => row.churn),
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}

export function DirTreemap({
  rows,
  onDrill,
  height = 280,
}: {
  rows: ObjectRow[]
  onDrill: (path: string) => void
  height?: number
}) {
  const c = useChartPalette()
  const data = rows
    .filter((row) => row.churn > 0)
    .map((row, index) => ({
      name: row.name || row.path,
      value: row.churn,
      path: row.path,
      itemStyle: { color: c.palette[index % c.palette.length], opacity: 0.85 },
    }))
  const option = {
    tooltip: {
      ...tooltipStyle(c),
      formatter: (params: { name?: string; value?: number; data?: { path?: string } }) =>
        `<b>${params.data?.path ?? params.name}</b><br/>churn: ${fmtInt(params.value ?? 0)}<br/><i>click to drill in</i>`,
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false as const,
        breadcrumb: { show: false },
        upperLabel: { show: false },
        label: { color: c.tileLabel, fontSize: 11, overflow: 'truncate' },
        itemStyle: { borderColor: c.tileBorder, borderWidth: 2, gapWidth: 2 },
        data,
      },
    ],
  }
  return (
    <ReactECharts
      option={option}
      style={{ height }}
      notMerge
      onEvents={{
        click: (params: { data?: { path?: string } }) => {
          const path = params?.data?.path
          if (path) onDrill(path)
        },
      }}
    />
  )
}

export function OwnershipDonut({ rows, height = 220 }: { rows: OwnershipRow[]; height?: number }) {
  const c = useChartPalette()
  const top = rows.slice(0, 7)
  const restChurn = rows.slice(7).reduce((sum, row) => sum + row.churn, 0)
  const slice = top.map((row, index) => ({
    name: row.name,
    value: row.churn,
    itemStyle: { color: c.palette[index % c.palette.length] },
  }))
  if (restChurn > 0) {
    slice.push({ name: 'others', value: restChurn, itemStyle: { color: c.others } })
  }
  const option = {
    tooltip: {
      ...tooltipStyle(c),
      formatter: (params: { name?: string; value?: number; percent?: number }) =>
        `<b>${params.name}</b><br/>churn: ${fmtInt(params.value ?? 0)} (${params.percent ?? 0}%)`,
    },
    series: [
      {
        type: 'pie',
        radius: ['54%', '82%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { color: c.axis, fontSize: 10, formatter: '{b} · {d}%' },
        labelLine: { lineStyle: { color: c.grid } },
        data: slice,
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}
