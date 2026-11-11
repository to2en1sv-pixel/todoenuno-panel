import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  Play, 
  Pause, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Filter, 
  X, 
  ExternalLink, 
  ChevronRight, 
  ChevronLeft,
  CheckCircle2, 
  AlertCircle, 
  Radio,
  Layers,
  Info
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
import type { BrainNode, BrainConnection, NodeStatus, SimulationStep } from '@/types/brain';
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
  Wallet
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
  const [flowFilter, setFlowFilter] = useState<'all' | 'sales_flow' | 'fulfillment_flow' | 'retention_flow' | 'supply_flow'>('all');

  // Modo Simulación COD Paso a Paso
  const [simulationActive, setSimulationActive] = useState(false);
  const [simulationStepIndex, setSimulationStepIndex] = useState(0);
  const [simulationAutoPlay, setSimulationAutoPlay] = useState(false);
  const [simulationPulseTrigger, setSimulationPulseTrigger] = useState(0);

  // Pulso temporal por eventos entrantes
  const [activePulseEdgeId, setActivePulseEdgeId] = useState<string | null>(null);

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
            return 0; // Loop or stay at last
          }
          return prev + 1;
        });
        setSimulationPulseTrigger((c) => c + 1);
      }, 3500);
    }
    return () => clearInterval(timer);
  }, [simulationActive, simulationAutoPlay]);

  // Reaccionar a eventos recientes en el stream encendiendo conexiones
  useEffect(() => {
    if (recentEvents.length > 0 && !simulationActive) {
      const latest = recentEvents[0];
      const type = latest.type;

      // Buscar si algún nodo tiene este evento
      const target = nodes.find((n) => n.supportedEvents.includes(type));
      if (target) {
        const edge = connections.find((c) => c.to === target.id || c.from === target.id);
        if (edge) {
          setActivePulseEdgeId(edge.id);
          const t = setTimeout(() => setActivePulseEdgeId(null), 2500);
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
    setSimulationPulseTrigger((c) => c + 1);
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

  // Emitir pulso manual
  const handleTriggerNodePulse = async (node: BrainNode) => {
    const eventType = node.supportedEvents[0] || 'system.heartbeat';
    await emitOsEvent({
      type: eventType,
      source_table: 'os_brain_graph',
      source_id: node.id,
      payload: {
        node_id: node.id,
        node_label: node.label,
        domain: node.domain,
        message: `Pulso sináptico emitido manualmente desde OS Brain para ${node.label}`,
        timestamp: new Date().toISOString()
      }
    });

    const edge = connections.find((c) => c.to === node.id || c.from === node.id);
    if (edge) {
      setActivePulseEdgeId(edge.id);
      setTimeout(() => setActivePulseEdgeId(null), 2500);
    }
  };

  // Status colors & labels
  const getStatusVisuals = (status: NodeStatus) => {
    switch (status) {
      case 'completed':
        return {
          color: '#10b981', // emerald
          badgeText: 'Completed',
          glow: 'rgba(16, 185, 129, 0.45)',
          stroke: '#059669',
          bg: 'rgba(6, 78, 59, 0.35)'
        };
      case 'in_progress':
        return {
          color: '#f59e0b', // amber
          badgeText: 'In Progress',
          glow: 'rgba(245, 158, 11, 0.45)',
          stroke: '#d97706',
          bg: 'rgba(120, 53, 15, 0.35)'
        };
      case 'active_dev':
        return {
          color: '#06b6d4', // cyan
          badgeText: 'Active Dev',
          glow: 'rgba(6, 182, 212, 0.45)',
          stroke: '#0891b2',
          bg: 'rgba(22, 78, 99, 0.35)'
        };
      case 'future':
      default:
        return {
          color: '#94a3b8', // slate
          badgeText: 'Future',
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
      <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-400">
            <Cpu size={18} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wide text-white">
                TODOENUNO OS
              </span>
              <span className="text-xs text-slate-400 font-normal">
                · El Salvador · Knowledge Graph · Digital Twin
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
              <span className="font-mono text-slate-300">12 Nodos · 24 Sinapsis</span>
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
              <option value="all">⚡ Todos los Flujos</option>
              <option value="sales_flow">🛒 Flujo Venta & Despacho COD</option>
              <option value="retention_flow">🎯 Flujo Retención & LTV</option>
              <option value="supply_flow">📦 Flujo Cadena de Suministro</option>
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
      <div className="relative w-full h-[620px] overflow-hidden bg-gradient-to-b from-[#060911] via-[#090d18] to-[#04060b] cursor-grab active:cursor-grabbing">
        
        {/* Subtle Background Grid & Star Dust */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.25) 1px, transparent 0)`,
            backgroundSize: '36px 36px'
          }}
        />

        {/* Central Core Ambient Glow */}
        <div 
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full pointer-events-none opacity-30 blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.4) 0%, rgba(59, 130, 246, 0.2) 45%, transparent 70%)'
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

            {/* Filtro de Núcleo Central */}
            <filter id="core-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="10" result="blur" />
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 0.8 1 0 0  0 0.4 1 0 0  0 0 0 2 0" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Marcadores de flecha en conexiones */}
            <marker id="arrow" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="rgba(148, 163, 184, 0.5)" />
            </marker>

            <marker id="arrow-active" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#8b5cf6" />
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
                const isSimActiveEdge = currentSimStep && (
                  (currentSimStep.sourceNodeId === conn.from && currentSimStep.targetNodeId === conn.to) ||
                  (currentSimStep.sourceNodeId === conn.to && currentSimStep.targetNodeId === conn.from)
                );
                const isPulsing = activePulseEdgeId === conn.id || isSimActiveEdge;

                // Cálculo de curva bezier suave
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const cx1 = source.x + dx * 0.4;
                const cy1 = source.y;
                const cx2 = source.x + dx * 0.6;
                const cy2 = target.y;
                const pathD = `M ${source.x} ${source.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${target.x} ${target.y}`;

                return (
                  <g key={conn.id}>
                    {/* Línea base de sinapsis */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke={
                        isPulsing
                          ? '#a855f7'
                          : isConnectedToSelected
                          ? '#38bdf8'
                          : isConnectedToHovered
                          ? '#94a3b8'
                          : conn.flowType === 'core_sync'
                          ? 'rgba(99, 102, 241, 0.22)'
                          : 'rgba(71, 85, 105, 0.35)'
                      }
                      strokeWidth={isPulsing ? 3 : isConnectedToHovered || isConnectedToSelected ? 2.2 : 1.2}
                      strokeDasharray={conn.flowType === 'core_sync' ? '4 3' : undefined}
                      filter={isPulsing ? 'url(#glow)' : undefined}
                      className="transition-colors duration-300"
                    />

                    {/* Partícula de pulso animada que viaja por la sinapsis */}
                    {(conn.animated || isPulsing) && (
                      <circle r={isPulsing ? 4.5 : 2.5} fill={isPulsing ? '#ec4899' : '#818cf8'} filter="url(#glow)">
                        <animateMotion
                          path={pathD}
                          dur={isPulsing ? '1.4s' : conn.bandwidth === 'high' ? '2.8s' : '4.5s'}
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}

                    {/* Etiqueta de flujo en hovering */}
                    {(isConnectedToHovered || isPulsing) && conn.label && (
                      <text
                        x={(source.x + target.x) / 2}
                        y={(source.y + target.y) / 2 - 8}
                        fill="#cbd5e1"
                        fontSize="10"
                        fontFamily="monospace"
                        textAnchor="middle"
                        className="pointer-events-none select-none bg-slate-900 px-1"
                      >
                        {conn.label}
                      </text>
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
                        strokeWidth={isCore ? 2.5 : 1.5}
                        strokeDasharray={isCore ? '6 4' : '4 3'}
                        opacity="0.8"
                        filter="url(#glow)"
                        className="animate-spin"
                        style={{ animationDuration: isCore ? '12s' : '6s' }}
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
                          size={isCore ? 22 : 18} 
                          color={isCore ? '#c084fc' : visuals.color} 
                        />
                      </div>
                    </foreignObject>

                    {/* Etiqueta del Nodo (debajo del círculo) */}
                    <g transform={`translate(0, ${node.radius + 16})`} className="pointer-events-none">
                      <rect
                        x="-60"
                        y="-10"
                        width="120"
                        height="20"
                        rx="10"
                        fill="rgba(15, 23, 42, 0.85)"
                        stroke="rgba(51, 65, 85, 0.6)"
                        strokeWidth="1"
                      />
                      <text
                        x="0"
                        y="4"
                        fill="#f8fafc"
                        fontSize="11"
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

        {/* 2.4 Leyenda Inferior & Medidor de Cobertura */}
        <div className="absolute bottom-4 left-5 bg-slate-950/80 backdrop-blur-md border border-slate-800/80 rounded-xl px-3 py-2 flex items-center gap-4 text-[11px] text-slate-400 pointer-events-auto">
          <span className="font-bold text-slate-300">Estados:</span>
          <button 
            onClick={() => setStatusFilter(statusFilter === 'completed' ? 'all' : 'completed')}
            className={`flex items-center gap-1.5 hover:text-emerald-300 transition-colors ${statusFilter === 'completed' ? 'text-emerald-400 font-bold' : ''}`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Completed (100%)</span>
          </button>
          <button 
            onClick={() => setStatusFilter(statusFilter === 'in_progress' ? 'all' : 'in_progress')}
            className={`flex items-center gap-1.5 hover:text-amber-300 transition-colors ${statusFilter === 'in_progress' ? 'text-amber-400 font-bold' : ''}`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>In Progress</span>
          </button>
          <button 
            onClick={() => setStatusFilter(statusFilter === 'active_dev' ? 'all' : 'active_dev')}
            className={`flex items-center gap-1.5 hover:text-cyan-300 transition-colors ${statusFilter === 'active_dev' ? 'text-cyan-400 font-bold' : ''}`}
          >
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
            <span>Active Dev</span>
          </button>
          <button 
            onClick={() => setStatusFilter(statusFilter === 'future' ? 'all' : 'future')}
            className={`flex items-center gap-1.5 hover:text-slate-200 transition-colors ${statusFilter === 'future' ? 'text-slate-300 font-bold' : ''}`}
          >
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span>Future</span>
          </button>
        </div>

        {/* Cobertura Global Badge (Derecha Abajo) */}
        <div className="absolute bottom-4 right-5 bg-slate-950/80 backdrop-blur-md border border-slate-800/80 rounded-xl px-3.5 py-2 flex items-center gap-3 text-xs pointer-events-auto">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 font-mono block">Cobertura Digital Twin</span>
            <span className="font-black text-emerald-400 font-mono">82% Automatizado</span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-xs font-mono">
            82%
          </div>
        </div>
      </div>

      {/* 3. Panel Lateral: Node Inspector Drawer (Slide-Over) */}
      {selectedNode && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-slate-950/95 backdrop-blur-xl border-l border-slate-800 p-6 shadow-2xl z-50 flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-300 text-slate-200">
          <div>
            {/* Cabecera del Drawer */}
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-white">
                  {React.createElement(ICON_MAP[selectedNode.iconName] || Activity, {
                    size: 20,
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
                Rol en la Operación COD
              </span>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/40 p-3 rounded-xl border border-slate-800/60">
                {selectedNode.description}
              </p>
            </div>

            {/* Lista de Sub-Acciones del Módulo */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">
                  Sub-Acciones & Capacidades ({selectedNode.subActions.length})
                </span>
              </div>
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

            {/* Eventos en Vivo Registrados para este Nodo */}
            <div className="mb-5">
              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider block mb-2">
                Últimos Eventos en Vivo ({nodeEvents.length})
              </span>
              {nodeEvents.length === 0 ? (
                <div className="text-center p-4 bg-slate-900/30 rounded-xl border border-slate-800/40 text-xs text-slate-500">
                  Sin eventos recientes registrados en este buffer
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
