import ReactECharts from 'echarts-for-react'
import { fmtInt, fmtPercent } from '../format'
import type { ObjectRow, OwnershipRow, TsPoint } from '../types'

const AXIS_COLOR = '#8b99a8'
const GRID_LINE = '#1b2634'
const GREEN = '#3fb950'
const RED = '#f85149'
const BLUE = '#4f8cff'
const PURPLE = '#a371f7'
const PALETTE = [PURPLE, BLUE, GREEN, '#d29922', '#f778ba', '#39c5cf', '#ffa657', '#8b99a8']

const tooltipStyle = {
  backgroundColor: '#16202c',
  borderColor: '#223041',
  textStyle: { color: '#e6edf3', fontSize: 12 },
}

export function ChurnChart({ data, height = 280 }: { data: TsPoint[]; height?: number }) {
  const option = {
    grid: { left: 56, right: 18, top: 34, bottom: data.length > 40 ? 54 : 26 },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle,
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
    legend: { top: 0, textStyle: { color: AXIS_COLOR, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    xAxis: {
      type: 'category',
      data: data.map((point) => point.bucket),
      axisLabel: { color: AXIS_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: GRID_LINE } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: AXIS_COLOR, fontSize: 10 },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    dataZoom: data.length > 40 ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 4 }] : undefined,
    series: [
      {
        name: 'added',
        type: 'bar',
        stack: 'churn',
        itemStyle: { color: GREEN, borderRadius: [2, 2, 0, 0] },
        data: data.map((point) => point.added),
      },
      {
        name: 'removed',
        type: 'bar',
        stack: 'churn',
        itemStyle: { color: RED, borderRadius: [0, 0, 2, 2] },
        data: data.map((point) => -point.removed),
      },
      {
        name: 'growth',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: BLUE, width: 2 },
        itemStyle: { color: BLUE },
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
  const data = rows.slice(0, 8).slice().reverse()
  const option = {
    grid: { left: 8, right: 60, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle,
      formatter: (params: Array<{ dataIndex: number }>) => {
        const item = data[params[0]?.dataIndex ?? 0]
        if (!item) return ''
        return `<b>${item.name}</b><br/>churn: ${fmtInt(item.churn)}<br/>ownership: ${fmtPercent(item.ownership)}`
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: AXIS_COLOR, fontSize: 10 },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    yAxis: {
      type: 'category',
      data: data.map((row) => row.name),
      axisLabel: { color: AXIS_COLOR, fontSize: 11, width: 130, overflow: 'truncate' },
      axisLine: { lineStyle: { color: GRID_LINE } },
    },
    series: [
      {
        name: 'churn',
        type: 'bar',
        barMaxWidth: 15,
        itemStyle: { color: PURPLE, borderRadius: [0, 3, 3, 0] },
        label: {
          show: true,
          position: 'right',
          color: AXIS_COLOR,
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
  const data = rows
    .filter((row) => row.churn > 0)
    .map((row, index) => ({
      name: row.name || row.path,
      value: row.churn,
      path: row.path,
      itemStyle: { color: PALETTE[index % PALETTE.length], opacity: 0.85 },
    }))
  const option = {
    tooltip: {
      ...tooltipStyle,
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
        label: { color: '#e6edf3', fontSize: 11, overflow: 'truncate' },
        itemStyle: { borderColor: '#0b0f14', borderWidth: 2, gapWidth: 2 },
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
  const top = rows.slice(0, 7)
  const restChurn = rows.slice(7).reduce((sum, row) => sum + row.churn, 0)
  const slice = top.map((row, index) => ({
    name: row.name,
    value: row.churn,
    itemStyle: { color: PALETTE[index % PALETTE.length] },
  }))
  if (restChurn > 0) {
    slice.push({ name: 'others', value: restChurn, itemStyle: { color: '#39475a' } })
  }
  const option = {
    tooltip: {
      ...tooltipStyle,
      formatter: (params: { name?: string; value?: number; percent?: number }) =>
        `<b>${params.name}</b><br/>churn: ${fmtInt(params.value ?? 0)} (${params.percent ?? 0}%)`,
    },
    series: [
      {
        type: 'pie',
        radius: ['54%', '82%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        label: { color: AXIS_COLOR, fontSize: 10, formatter: '{b} · {d}%' },
        labelLine: { lineStyle: { color: GRID_LINE } },
        data: slice,
      },
    ],
  }
  return <ReactECharts option={option} style={{ height }} notMerge />
}
