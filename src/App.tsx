import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { HoyPage } from '@/pages/Hoy';
import { CatalogoPage } from '@/pages/Catalogo';
import { InventarioPage } from '@/pages/Inventario';
import { ColaPage } from '@/pages/Cola';
import { SistemaPage } from '@/pages/Sistema';
import { UniChatPage } from '@/pages/UniChat';
import { PagosPage } from '@/pages/Pagos';
import { ProveedoresPage } from '@/pages/Proveedores';
import { DocsPage } from '@/pages/Docs';
import { PedidosPage } from '@/pages/Pedidos';
import { RentabilidadPage } from '@/pages/Rentabilidad';
import { AnaliticaPage } from '@/pages/Analitica';
import { MarketingPage } from '@/pages/Marketing';
import { SocialInbox } from '@/pages/SocialInbox';
import { ConfirmarEntregaPage } from "@/pages/ConfirmarEntrega";
import { EventStreamPage } from '@/pages/EventStreamPage';
import { FinanzasPage } from '@/pages/FinanzasPage';
import { LtvPage } from '@/pages/LtvPage';
import { OfflineIndicator } from '@/components/pwa/PWAComponents';

export default function App() {
  return (
    <>
      <OfflineIndicator />
      <Routes>
      {/* 👇 RUTAS PARA REPARTIDORES MÓVILES (SIN SIDEBAR) */}
      <Route path="/entregar/:id" element={<ConfirmarEntregaPage />} />
      <Route path="/entregar" element={<ConfirmarEntregaPage />} />
      <Route path="/repartidor" element={<ConfirmarEntregaPage />} />

      {/* 👇 ESTAS RUTAS ESTÁN ADENTRO, POR ESO SÍ TIENEN SIDEBAR */}
      <Route element={<Layout />}>
        <Route path="/" element={<HoyPage />} />
        <Route path="/event-stream" element={<EventStreamPage />} />
        <Route path="/os-brain" element={<EventStreamPage />} />
        <Route path="/finanzas" element={<FinanzasPage />} />
        <Route path="/pagos" element={<FinanzasPage />} />
        <Route path="/unichat" element={<UniChatPage />} />
        <Route path="/catalogo" element={<CatalogoPage />} />
        <Route path="/inventario" element={<InventarioPage />} />
        <Route path="/cola" element={<ColaPage />} />
        <Route path="/proveedores" element={<ProveedoresPage />} />
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/sistema" element={<SistemaPage />} />
        <Route path="/marketing" element={<MarketingPage />} />
        <Route path="/social-inbox" element={<SocialInbox />} />
        <Route path="/rentabilidad" element={<RentabilidadPage />} />
        <Route path="/analitica" element={<AnaliticaPage />} />
        <Route path="/ltv" element={<LtvPage />} />
      </Route>
      </Routes>
    </>
  );
}
