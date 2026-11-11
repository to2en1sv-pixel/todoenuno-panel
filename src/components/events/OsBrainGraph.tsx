import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Cpu, 
  Bot, 
  ShoppingBag, 
  ShieldCheck, 
  Clock, 
  Truck, 
  Store, 
  PackageCheck, 
  FileText, 
  Zap, 
  Sparkles, 
  Activity, 
  Wallet,
  LayoutDashboard,
  Megaphone,
  Inbox,
  PieChart,
  TrendingUp,
  Layers,
  Server,
  Play, 
  Pause, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  X, 
  ExternalLink, 
  ChevronRight, 
  ChevronLeft,
  CheckCircle2, 
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Radio,
  Send
} from 'lucide-react';
import { 
  INITIAL_BRAIN_NODES, 
  INITIAL_BRAIN_CONNECTIONS, 
  COD_SIMULATION_STEPS,
  BRAIN_CANVAS_WIDTH,
  BRAIN_CANVAS_HEIGHT,
  BRAIN_CENTER_X,
  BRAIN_CENTER_Y
} from '@/lib/osBrainData';
import type { BrainNode, BrainConnection, NodeStatus, SimulationStep, BrainFlowType } from '@/types/brain';
import type { OsEvent } from '@/types/events';
import { emitOsEvent } from '@/lib/osEvents';

// Map icon strings to Lucide components
const ICON_MAP: Record<string, React.ElementType> = {
  Cpu,
  Bot,
  ShoppingBag,
  ShieldCheck,
  Clock,
  Truck,
  Store,
  PackageCheck,
  FileText,
  Zap,
  Sparkles,
  Activity,
  Wallet,
  LayoutDashboard,
  Megaphone,
  Inbox,
  PieChart,
  TrendingUp,
  Layers,
  Server
};

// Flow type label & color mappings
const FLOW_METADATA: Record<BrainFlowType, { label: string; color: string; badge: string }> = {
  sales_flow: { label: 'Venta & Checkout COD', color: '#38bdf8', badge: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  fulfillment_flow: { label: 'Almacén & Despacho', color: '#10b981', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  finance_flow: { label: 'Finanzas & Rentabilidad', color: '#f59e0b', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  retention_flow: { label: 'Retención & Ciclo LTV', color: '#a855f7', badge: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  supply_flow: { label: 'Cadena de Suministro', color: '#ec4899', badge: 'bg-pink-500/10 text-pink-400 border-pink-500/30' },
  marketing_flow: { label: 'Marketing & Adquisición', color: '#06b6d4', badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' },
  system_flow: { label: 'Gobernanza & Sistema', color: '#94a3b8', badge: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
  core_sync: { label: 'OS Kernel Sync', color: '#6366f1', badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' }
};

interface OsBrainGraphProps {
  recentEvents?: OsEvent[];
  onEmitEvent?: (type: string) => void;
}

export function OsBrainGraph({ recentEvents = [] }: OsBrainGraphProps) {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Estados de vista y manipulación
  const [nodes, setNodes] = useState<BrainNode[]>(INITIAL_BRAIN_NODES);
  const [connections] = useState<BrainConnection[]>(INITIAL_BRAIN_CONNECTIONS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  
  // Transformación del viewport (zoom y pan)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Arrastre de nodo individual
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Filtros
  const [statusFilter, setStatusFilter] = useState<'all' | NodeStatus>('all');
  const [flowFilter, setFlowFilter] = useState<'all' | BrainFlowType>('all');

  // Modo Simulación COD Paso a Paso
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationStepIndex, setSimulationStepIndex] = useState(0);
  const [simulationAutoPlay, setSimulationAutoPlay] = useState(false);

  // Pulso temporal por eventos entrantes
  const [activePulseEdgeId, setActivePulseEdgeId] = useState<string | null>(null);
  const [pulsingEventName, setPulsingEventName] = useState<string | null>(null);

  // Nodo seleccionado actual
  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Paso de simulación actual
  const currentSimStep: SimulationStep | null = useMemo(() => {
    if (!simulationActive) return null;
    return COD_SIMULATION_STEPS[simulationStepIndex] || null;
  }, [simulationActive, simulationStepIndex]);

  // Autoplay de la simulación
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (simulationActive && simulationAutoPlay) {
      timer = setInterval(() => {
        setSimulationStepIndex((prev) => {
          if (prev >= COD_SIMULATION_STEPS.length - 1) {
            return 0; // Rebobinar al inicio o mantener
          }
          return prev + 1;
        });
      }, 4000);
    }
    return () => clearInterval(timer);
  }, [simulationActive, simulationAutoPlay]);

  // Reaccionar a eventos recientes en el stream encendiendo conexiones
  useEffect(() => {
    if (recentEvents.length > 0 && !simulationActive) {
      const latest = recentEvents[0];
      const type = latest.type;

      // Buscar si algún nodo soporta o emite este evento
      const target = nodes.find((n) => n.supportedEvents.includes(type));
      if (target) {
        // Encontrar una conexión que use este evento o que esté vinculada a ese nodo
        const edgeWithEvent = connections.find((c) => c.eventType === type);
        const edge = edgeWithEvent || connections.find((c) => c.to === target.id || c.from === target.id);
        if (edge) {
          setActivePulseEdgeId(edge.id);
          setPulsingEventName(type);
          const t = setTimeout(() => {
            setActivePulseEdgeId(null);
            setPulsingEventName(null);
          }, 3000);
          return () => clearTimeout(t);
        }
      }
    }
  }, [recentEvents, nodes, connections, simulationActive]);

  // Manejo de drag de nodos y pan del canvas
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).closest('.brain-node')) {
      return; // El nodo maneja su propio click
    }
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    if (draggingNodeId) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const rawX = (e.clientX - rect.left - pan.x) / zoom;
      const rawY = (e.clientY - rect.top - pan.y) / zoom;

      setNodes((prev) =>
        prev.map((n) =>
          n.id === draggingNodeId
            ? { ...n, x: Math.max(50, Math.min(BRAIN_CANVAS_WIDTH - 50, rawX - dragOffset.x)), y: Math.max(50, Math.min(BRAIN_CANVAS_HEIGHT - 50, rawY - dragOffset.y)) }
            : n
        )
      );
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  const handleNodePointerDown = (e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - pan.x) / zoom;
    const mouseY = (e.clientY - rect.top - pan.y) / zoom;

    setDraggingNodeId(nodeId);
    setDragOffset({
      x: mouseX - node.x,
      y: mouseY - node.y
    });
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNodes(INITIAL_BRAIN_NODES);
  };

  const handleStartSimulation = () => {
    setSimulationActive(true);
    setSimulationStepIndex(0);
    setSimulationAutoPlay(true);
  };

  const handleStopSimulation = () => {
    setSimulationActive(false);
    setSimulationAutoPlay(false);
  };

  // Helper de posición de nodos
  const nodeMap = useMemo(() => {
    const map = new Map<string, BrainNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  // Conexiones filtradas
  const visibleConnections = useMemo(() => {
    return connections.filter((conn) => {
      if (flowFilter !== 'all' && conn.flowType !== flowFilter && conn.flowType !== 'core_sync') {
        return false;
      }
      return true;
    });
  }, [connections, flowFilter]);

  // Sinapsis salientes y entrantes del nodo seleccionado
  const outgoingSynapses = useMemo(() => {
    if (!selectedNodeId) return [];
    return connections.filter((c) => c.from === selectedNodeId);
  }, [selectedNodeId, connections]);

  const incomingSynapses = useMemo(() => {
    if (!selectedNodeId) return [];
    return connections.filter((c) => c.to === selectedNodeId);
  }, [selectedNodeId, connections]);

  // Emitir pulso manual de un evento específico
  const handleTriggerNodePulse = async (node: BrainNode, specificEvent?: string) => {
    const eventType = specificEvent || node.supportedEvents[0] || 'system.heartbeat';
    await emitOsEvent({
      type: eventType,
      source_table: 'os_brain_graph',
      source_id: node.id,
      payload: {
        node_id: node.id,
        node_label: node.label,
        domain: node.domain,
        message: `Pulso sináptico emitido en vivo desde OS Brain para ${node.label} (${eventType})`,
        timestamp: new Date().toISOString()
      }
    });

    // Encender la conexión asociada
    const edge = connections.find((c) => c.eventType === eventType || c.from === node.id || c.to === node.id);
    if (edge) {
      setActivePulseEdgeId(edge.id);
      setPulsingEventName(eventType);
      setTimeout(() => {
        setActivePulseEdgeId(null);
        setPulsingEventName(null);
      }, 2500);
    }
  };

  // Status colors & labels
  const getStatusVisuals = (status: NodeStatus) => {
    switch (status) {
      case 'completed':
        return {
          color: '#10b981', // emerald
          badgeText: 'Operativo',
          glow: 'rgba(16, 185, 129, 0.45)',
          stroke: '#059669',
          bg: 'rgba(6, 78, 59, 0.35)'
        };
      case 'in_progress':
        return {
          color: '#f59e0b', // amber
          badgeText: 'En Progreso',
          glow: 'rgba(245, 158, 11, 0.45)',
          stroke: '#d97706',
          bg: 'rgba(120, 53, 15, 0.35)'
        };
      case 'active_dev':
        return {
          color: '#06b6d4', // cyan
          badgeText: 'Dev Activo',
          glow: 'rgba(6, 182, 212, 0.45)',
          stroke: '#0891b2',
          bg: 'rgba(22, 78, 99, 0.35)'
        };
      case 'future':
      default:
        return {
          color: '#94a3b8', // slate
          badgeText: 'Planificado',
          glow: 'rgba(148, 163, 184, 0.25)',
          stroke: '#64748b',
          bg: 'rgba(30, 41, 59, 0.4)'
        };
    }
  };

  // Eventos filtrados para el nodo seleccionado
  const nodeEvents = useMemo(() => {
    if (!selectedNode) return [];
    return recentEvents.filter((e) => selectedNode.supportedEvents.includes(e.type)).slice(0, 8);
  }, [selectedNode, recentEvents]);

  return (
    <div className="relative w-full rounded-2xl border border-[var(--bd)] overflow-hidden bg-[#070b14] text-slate-100 shadow-2xl flex flex-col select-none">
      
      {/* 1. Header Bar: Digital Twin Title & Telemetry */}
      <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-400">
            <Cpu size={18} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wide text-white">
                TODOENUNO OS · GEMELO DIGITAL
              </span>
              <span className="text-xs text-slate-400 font-normal hidden sm:inline">
                · Red Neuronal Operativa · El Salvador
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Live Synapses
              </span>
              <span>·</span>
              <span>San Salvador, SV</span>
              <span>·</span>
              <span className="font-mono text-slate-300">
                {nodes.length} Módulos · {connections.length} Sinapsis Reales
              </span>
              {pulsingEventName && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-mono text-[10px] border border-pink-500/40 animate-pulse">
                  ⚡ {pulsingEventName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Controles de Vista & Simulación */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Botón Simulación COD */}
          {!simulationActive ? (
            <button
              onClick={handleStartSimulation}
              className="px-3.5 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-violet-600/25 transition-all"
            >
              <Play size={13} fill="currentColor" /> Simular Flujo Pedido COD
            </button>
          ) : (
            <div className="flex items-center gap-1.5 bg-violet-950/80 border border-violet-500/50 rounded-xl p-1">
              <button
                onClick={() => setSimulationAutoPlay(!simulationAutoPlay)}
                className="px-2.5 py-1 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1 transition-colors"
              >
                {simulationAutoPlay ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
                {simulationAutoPlay ? 'Pausar' : 'Reanudar'}
              </button>
              <button
                onClick={handleStopSimulation}
                className="px-2 py-1 text-xs font-semibold rounded-lg hover:bg-white/10 text-slate-300 transition-colors"
                title="Detener simulación"
              >
                <X size={13} /> Salir
              </button>
            </div>
          )}

          {/* Selector de Flujos Operativos */}
          <div className="relative">
            <select
              value={flowFilter}
              onChange={(e) => setFlowFilter(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 outline-none hover:border-slate-500 transition-colors cursor-pointer"
            >
              <option value="all">⚡ Todos los Flujos ({connections.length} Sinapsis)</option>
              <option value="sales_flow">🛒 Venta & Checkout COD</option>
              <option value="fulfillment_flow">🚚 Almacén, Picking & Despacho</option>
              <option value="finance_flow">💰 Finanzas, Caja & Rentabilidad</option>
              <option value="retention_flow">🎯 Retención & Ciclo LTV</option>
              <option value="supply_flow">📦 Cadena de Suministro B2B</option>
              <option value="marketing_flow">📣 Marketing & Adquisición</option>
              <option value="system_flow">⚙️ Gobernanza & Sistema</option>
            </select>
          </div>

          {/* Zoom & Reset */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
            <button
              onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))}
              className="p-1 hover:bg-slate-800 rounded text-slate-300"
              title="Acercar (+)"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))}
              className="p-1 hover:bg-slate-800 rounded text-slate-300"
              title="Alejar (-)"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={handleResetView}
              className="p-1 hover:bg-slate-800 rounded text-slate-300"
              title="Restablecer posición inicial"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Neural Network Interactive Canvas */}
      <div className="relative w-full h-[660px] overflow-hidden bg-gradient-to-b from-[#060911] via-[#090d18] to-[#04060b] cursor-grab active:cursor-grabbing">
        
        {/* Subtle Background Grid */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.25) 1px, transparent 0)`,
            backgroundSize: '36px 36px'
          }}
        />

        {/* Central Core Ambient Glow */}
        <div 
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[580px] h-[580px] rounded-full pointer-events-none opacity-30 blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.45) 0%, rgba(59, 130, 246, 0.22) 45%, transparent 70%)'
          }}
        />

        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox={`0 0 ${BRAIN_CANVAS_WIDTH} ${BRAIN_CANVAS_HEIGHT}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Filtro de Resplandor Neon */}
            <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Marcadores de flecha en conexiones */}
            <marker id="arrow" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="rgba(148, 163, 184, 0.4)" />
            </marker>

            <marker id="arrow-active" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#a855f7" />
            </marker>
          </defs>

          {/* Contenedor transformable (Zoom + Pan) */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            
            {/* 2.1 CONEXIONES / SINAPSIS */}
            <g className="connections-layer">
              {visibleConnections.map((conn) => {
                const source = nodeMap.get(conn.from);
                const target = nodeMap.get(conn.to);
                if (!source || !target) return null;

                const isConnectedToHovered = hoveredNodeId === conn.from || hoveredNodeId === conn.to;
                const isConnectedToSelected = selectedNodeId === conn.from || selectedNodeId === conn.to;
                const isHoveredConnection = hoveredConnectionId === conn.id;

                const isSimActiveEdge = currentSimStep && (
                  (currentSimStep.sourceNodeId === conn.from && currentSimStep.targetNodeId === conn.to) ||
                  (currentSimStep.sourceNodeId === conn.to && currentSimStep.targetNodeId === conn.from)
                );
                const isPulsing = activePulseEdgeId === conn.id || isSimActiveEdge;

                // Color por tipo de flujo
                const flowColor = FLOW_METADATA[conn.flowType || 'core_sync']?.color || '#94a3b8';

                // Cálculo de curva bezier suave
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const cx1 = source.x + dx * 0.4;
                const cy1 = source.y;
                const cx2 = source.x + dx * 0.6;
                const cy2 = target.y;
                const pathD = `M ${source.x} ${source.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${target.x} ${target.y}`;

                return (
                  <g 
                    key={conn.id} 
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredConnectionId(conn.id)}
                    onMouseLeave={() => setHoveredConnectionId(null)}
                  >
                    {/* Línea invisible más gruesa para facilitar hover */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                    />

                    {/* Línea base de sinapsis */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={
                        isPulsing
                          ? '#ec4899'
                          : isHoveredConnection
                          ? '#38bdf8'
                          : isConnectedToSelected
                          ? flowColor
                          : isConnectedToHovered
                          ? '#cbd5e1'
                          : conn.flowType === 'core_sync'
                          ? 'rgba(99, 102, 241, 0.20)'
                          : 'rgba(71, 85, 105, 0.38)'
                      }
                      strokeWidth={
                        isPulsing 
                          ? 3.2 
                          : isHoveredConnection 
                          ? 2.8 
                          : isConnectedToSelected 
                          ? 2.4 
                          : isConnectedToHovered 
                          ? 1.8 
                          : 1.1
                      }
                      strokeDasharray={conn.flowType === 'core_sync' ? '4 3' : undefined}
                      filter={isPulsing || isHoveredConnection ? 'url(#glow)' : undefined}
                      className="transition-colors duration-200"
                    />

                    {/* Partícula de pulso animada que viaja por la sinapsis */}
                    {(conn.animated || isPulsing || isConnectedToSelected) && (
                      <circle 
                        r={isPulsing ? 5 : isHoveredConnection ? 3.5 : 2.5} 
                        fill={isPulsing ? '#ec4899' : isHoveredConnection ? '#38bdf8' : flowColor} 
                        filter="url(#glow)"
                      >
                        <animateMotion
                          path={pathD}
                          dur={isPulsing ? '1.4s' : conn.bandwidth === 'high' ? '2.8s' : '4.6s'}
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}

                    {/* Etiqueta de flujo en hovering o simulación */}
                    {(isConnectedToHovered || isHoveredConnection || isPulsing) && conn.label && (
                      <g 
                        transform={`translate(${(source.x + target.x) / 2}, ${(source.y + target.y) / 2 - 10})`} 
                        className="pointer-events-none select-none"
                      >
                        <rect
                          x="-85"
                          y="-9"
                          width="170"
                          height="18"
                          rx="9"
                          fill="rgba(15, 23, 42, 0.95)"
                          stroke={isPulsing ? '#ec4899' : flowColor}
                          strokeWidth="1"
                        />
                        <text
                          x="0"
                          y="3"
                          fill="#f8fafc"
                          fontSize="9.5"
                          fontWeight="600"
                          fontFamily="system-ui, sans-serif"
                          textAnchor="middle"
                        >
                          {conn.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* 2.2 NODOS DE LA RED NEURONAL */}
            <g className="nodes-layer">
              {nodes.map((node) => {
                const isSelected = selectedNodeId === node.id;
                const isHovered = hoveredNodeId === node.id;
                const isSimSource = currentSimStep?.sourceNodeId === node.id;
                const isSimTarget = currentSimStep?.targetNodeId === node.id;
                const isCore = node.id === 'core_memory';
                const IconComponent = ICON_MAP[node.iconName] || Activity;
                const visuals = getStatusVisuals(node.status);

                // Conexiones de este nodo para calcular grado
                const connectedCount = connections.filter((c) => c.from === node.id || c.to === node.id).length;

                // Ocultar si no coincide con filtro de estado
                if (statusFilter !== 'all' && node.status !== statusFilter) {
                  return null;
                }

                return (
                  <g
                    key={node.id}
                    className="brain-node cursor-pointer transition-transform"
                    transform={`translate(${node.x}, ${node.y})`}
                    onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                    onClick={() => setSelectedNodeId(node.id)}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    {/* Halo de energía exterior si está activo o en simulación */}
                    {(isSimSource || isSimTarget || isSelected || isCore) && (
                      <circle
                        r={node.radius + (isCore ? 20 : 12)}
                        fill="none"
                        stroke={isSimSource ? '#ec4899' : isSimTarget ? '#10b981' : visuals.color}
                        strokeWidth={isCore ? 2.5 : 1.6}
                        strokeDasharray={isCore ? '6 4' : '4 3'}
                        opacity="0.85"
                        filter="url(#glow)"
                        className="animate-spin"
                        style={{ animationDuration: isCore ? '14s' : '6s' }}
                      />
                    )}

                    {/* Resplandor suave de fondo */}
                    <circle
                      r={node.radius + 6}
                      fill={visuals.glow}
                      opacity={isSelected || isSimSource ? 0.9 : 0.4}
                      filter="url(#glow)"
                    />

                    {/* Cuerpo del Nodo (Vidrio oscuro) */}
                    <circle
                      r={node.radius}
                      fill={isCore ? '#0f172a' : '#0b1120'}
                      stroke={
                        isSimSource
                          ? '#ec4899'
                          : isSimTarget
                          ? '#10b981'
                          : isSelected
                          ? '#38bdf8'
                          : visuals.stroke
                      }
                      strokeWidth={isSelected || isSimSource ? 2.8 : 1.8}
                      className="transition-all duration-200"
                    />

                    {/* Ícono Centrado */}
                    <foreignObject
                      x={-14}
                      y={-14}
                      width={28}
                      height={28}
                      className="pointer-events-none"
                    >
                      <div className="w-full h-full flex items-center justify-center text-white">
                        <IconComponent 
                          size={isCore ? 24 : 18} 
                          color={isCore ? '#c084fc' : visuals.color} 
                        />
                      </div>
                    </foreignObject>

                    {/* Badge contador de sinapsis conectadas (arriba a la derecha del círculo) */}
                    {!isCore && (
                      <g transform={`translate(${node.radius - 8}, ${-node.radius + 8})`} className="pointer-events-none">
                        <circle r="8" fill="#1e293b" stroke="#475569" strokeWidth="1" />
                        <text
                          x="0"
                          y="3"
                          fill="#94a3b8"
                          fontSize="8.5"
                          fontWeight="700"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {connectedCount}
                        </text>
                      </g>
                    )}

                    {/* Etiqueta del Nodo (debajo del círculo) */}
                    <g transform={`translate(0, ${node.radius + 16})`} className="pointer-events-none">
                      <rect
                        x="-65"
                        y="-10"
                        width="130"
                        height="20"
                        rx="10"
                        fill="rgba(15, 23, 42, 0.92)"
                        stroke="rgba(51, 65, 85, 0.7)"
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="4"
                        fill="#f8fafc"
                        fontSize="10.5"
                        fontWeight="700"
                        textAnchor="middle"
                        fontFamily="system-ui, sans-serif"
                      >
                        {node.label}
                      </text>
                    </g>

                    {/* Badge de Estado sutil */}
                    <g transform={`translate(0, ${node.radius + 33})`} className="pointer-events-none">
                      <text
                        x="0"
                        y="0"
                        fill={visuals.color}
                        fontSize="9"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="monospace"
                      >
                        {visuals.badgeText}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* 2.3 Floating HUD de Simulación COD (Paso a Paso) */}
        {simulationActive && currentSimStep && (
          <div className="absolute bottom-5 left-5 right-5 max-w-3xl mx-auto bg-slate-900/95 backdrop-blur-xl border border-violet-500/50 rounded-2xl p-4 shadow-2xl z-20 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-ping" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-violet-400">
                  Simulación de Ciclo Operativo COD · Paso {currentSimStep.step} de {COD_SIMULATION_STEPS.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSimulationStepIndex((i) => Math.max(0, i - 1))}
                  disabled={simulationStepIndex === 0}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setSimulationStepIndex((i) => Math.min(COD_SIMULATION_STEPS.length - 1, i + 1))}
                  disabled={simulationStepIndex === COD_SIMULATION_STEPS.length - 1}
                  className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={handleStopSimulation}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white ml-2"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="pt-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold text-white">
                    {currentSimStep.title}
                  </h4>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                    Evento: {currentSimStep.eventType}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  {currentSimStep.description}
                </p>
                <div className="mt-2 text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2.5 py-1 rounded-lg inline-block">
                  {currentSimStep.dataSummary}
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                <div className="text-right">
                  <div className="text-[10px] text-slate-400 uppercase font-mono">Impacto en el Negocio</div>
                  <div className="text-xs font-semibold text-slate-200 max-w-[220px]">
                    {currentSimStep.impact}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2.4 Leyenda Inferior */}
        <div className="absolute bottom-4 left-5 bg-slate-950/80 backdrop-blur-md border border-slate-800/80 rounded-xl px-3 py-2 flex items-center gap-4 text-[11px] text-slate-400 pointer-events-auto">
          <span className="font-bold text-slate-300">Filtro Estado:</span>
          <button 
            onClick={() => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed')}
            className={`flex items-center gap-1.5 hover:text-emerald-300 transition-colors ${statusFilter === 'completed' ? 'text-emerald-400 font-bold' : ''}`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Operativo</span>
          </button>
          <button 
            onClick={() => setStatusFilter(statusFilter === 'in_progress' ? 'all' : 'in_progress')}
            className={`flex items-center gap-1.5 hover:text-amber-300 transition-colors ${statusFilter === 'in_progress' ? 'text-amber-400 font-bold' : ''}`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>En Progreso</span>
          </button>
        </div>

        {/* Cobertura Global Badge (Derecha Abajo) */}
        <div className="absolute bottom-4 right-5 bg-slate-950/80 backdrop-blur-md border border-slate-800/80 rounded-xl px-3.5 py-2 flex items-center gap-3 text-xs pointer-events-auto">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 font-mono block">Cobertura Digital Twin</span>
            <span className="font-black text-emerald-400 font-mono">100% Sincronizado</span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-xs font-mono">
            18
          </div>
        </div>
      </div>

      {/* 3. Panel Lateral: Node Inspector Drawer (Slide-Over Completo) */}
      {selectedNode && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[460px] bg-slate-950/95 backdrop-blur-xl border-l border-slate-800 p-6 shadow-2xl z-50 flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-300 text-slate-200">
          <div>
            {/* Cabecera del Drawer */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-white shrink-0">
                  {React.createElement(ICON_MAP[selectedNode.iconName] || Activity, {
                    size: 22,
                    color: getStatusVisuals(selectedNode.status).color
                  })}
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-white">
                    {selectedNode.label}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedNode.subtitle}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedNodeId(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Estado & Métricas de Salud */}
            <div className="grid grid-cols-2 gap-3 my-4">
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-mono block">Madurez Módulo</span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full" 
                      style={{ width: `${selectedNode.completionPercentage}%` }} 
                    />
                  </div>
                  <span className="text-xs font-mono font-bold text-white">
                    {selectedNode.completionPercentage}%
                  </span>
                </div>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-mono block">Salud Operativa</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {selectedNode.health}% Nominal
                  </span>
                </div>
              </div>
            </div>

            {/* Descripción Arquitectónica */}
            <div className="mb-5">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block mb-1.5">
                Rol en TODOENUNO OS
              </span>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/40 p-3 rounded-xl border border-slate-800/60">
                {selectedNode.description}
              </p>
            </div>

            {/* Sinapsis Activas Reales (Entrantes y Salientes) */}
            <div className="mb-5">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block mb-2">
                Sinapsis Reales del Módulo ({outgoingSynapses.length + incomingSynapses.length})
              </span>

              {/* Salientes */}
              {outgoingSynapses.length > 0 && (
                <div className="mb-3">
                  <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1 mb-1.5">
                    <ArrowUpRight size={13} className="text-sky-400" /> Sinapsis Salientes (Emite Datos)
                  </span>
                  <div className="space-y-1.5">
                    {outgoingSynapses.map((syn) => {
                      const target = nodeMap.get(syn.to);
                      return (
                        <div
                          key={syn.id}
                          className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-200">{syn.label}</span>
                            {syn.eventType && (
                              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-800/40">
                                {syn.eventType}
                              </span>
                            )}
                          </div>
                          {syn.description && (
                            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                              {syn.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Hacia:</span>
                            <button
                              onClick={() => target && setSelectedNodeId(target.id)}
                              className="font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1"
                            >
                              {target?.label || syn.to} ➔
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Entrantes */}
              {incomingSynapses.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1 mb-1.5">
                    <ArrowDownRight size={13} className="text-emerald-400" /> Sinapsis Entrantes (Recibe Datos)
                  </span>
                  <div className="space-y-1.5">
                    {incomingSynapses.map((syn) => {
                      const source = nodeMap.get(syn.from);
                      return (
                        <div
                          key={syn.id}
                          className="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-200">{syn.label}</span>
                            {syn.eventType && (
                              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/40">
                                {syn.eventType}
                              </span>
                            )}
                          </div>
                          {syn.description && (
                            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                              {syn.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">Desde:</span>
                            <button
                              onClick={() => source && setSelectedNodeId(source.id)}
                              className="font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                            >
                              ← {source?.label || syn.from}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Eventos Soportados & Disparadores Rápidos */}
            <div className="mb-5">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block mb-2">
                Eventos del Catálogo Asociados ({selectedNode.supportedEvents.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedNode.supportedEvents.map((ev) => (
                  <button
                    key={ev}
                    onClick={() => handleTriggerNodePulse(selectedNode, ev)}
                    title={`Pulsar para emitir prueba de ${ev}`}
                    className="group px-2 py-1 rounded-lg bg-slate-900 hover:bg-violet-950/70 border border-slate-800 hover:border-violet-600/50 text-[11px] font-mono text-slate-300 hover:text-violet-200 flex items-center gap-1.5 transition-colors"
                  >
                    <span>{ev}</span>
                    <Send size={10} className="text-slate-400 group-hover:text-violet-400" />
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-Acciones del Módulo */}
            <div className="mb-5">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block mb-2">
                Sub-Acciones & Capacidades ({selectedNode.subActions.length})
              </span>
              <div className="space-y-2">
                {selectedNode.subActions.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 flex items-start gap-2.5 text-xs"
                  >
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-100">{sub.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{sub.description}</div>
                      {sub.outputEvent && (
                        <span className="inline-block mt-1 text-[9px] font-mono px-1.5 py-0.5 bg-violet-950/60 text-violet-300 border border-violet-800/40 rounded">
                          Emite: {sub.outputEvent}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Eventos en Vivo Recientes para este Nodo */}
            <div className="mb-5">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block mb-2">
                Eventos Recientes en Memoria ({nodeEvents.length})
              </span>
              {nodeEvents.length === 0 ? (
                <div className="text-center p-4 bg-slate-900/30 rounded-xl border border-slate-800/40 text-xs text-slate-400">
                  Sin eventos recientes registrados para este nodo
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto font-mono text-[11px]">
                  {nodeEvents.map((ev) => (
                    <div
                      key={ev.id || ev.idempotency_key}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2"
                    >
                      <span className="text-violet-300 truncate">{ev.type}</span>
                      <span className="text-slate-400 text-[10px] shrink-0">
                        {new Date(ev.occurred_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Botones de Acción al Fondo */}
          <div className="pt-4 border-t border-slate-800 space-y-2">
            {selectedNode.route && (
              <button
                onClick={() => navigate(selectedNode.route!)}
                className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-600/30 transition-colors"
              >
                <ExternalLink size={14} /> Abrir Módulo {selectedNode.label}
              </button>
            )}

            <button
              onClick={() => handleTriggerNodePulse(selectedNode)}
              className="w-full py-2 px-4 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
            >
              <Zap size={14} className="text-amber-400" /> Emitir Pulso Sináptico de Prueba
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
