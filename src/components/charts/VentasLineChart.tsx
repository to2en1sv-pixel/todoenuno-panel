import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PuntoVentas } from '@/types/rentabilidad'
import { formatCurrency } from '@/lib/rentabilidad'

interface VentasLineChartProps {
  data: PuntoVentas[]
  height?: number
}

export function VentasLineChart({ data, height = 320 }: VentasLineChartProps) {
  if (!data.length) {
    return (
      <p className="py-12 text-center text-sm text-slate-500">
        Sin datos para el período seleccionado.
      </p>
    )
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="etiqueta"
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(value: number) => formatCurrency(value)}
          />
          <Tooltip
            formatter={(value) => [formatCurrency(Number(value)), 'Ventas']}
            labelFormatter={(label) => `Día ${String(label)}`}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="ventas"
            stroke="#4f46e5"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
