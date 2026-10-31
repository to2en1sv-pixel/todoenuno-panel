import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { HoyPage } from '@/pages/Hoy';
import { CatalogoPage } from '@/pages/Catalogo';
import { ColaPage } from '@/pages/Cola';
import { SistemaPage } from '@/pages/Sistema';
import { UniChatPage } from '@/pages/UniChat';
import { PagosPage } from '@/pages/Pagos';
import { ProveedoresPage } from '@/pages/Proveedores';
import { DocsPage } from '@/pages/Docs';
import { PedidosPage } from '@/pages/Pedidos';
import { RentabilidadPage } from '@/pages/Rentabilidad'; // <-- NUEVO
import { AnaliticaPage } from '@/pages/Analitica'; // <-- NUEVO
import { MarketingPage } from '@/pages/Marketing'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HoyPage />} />
        <Route path="/unichat" element={<UniChatPage />} />
        <Route path="/catalogo" element={<CatalogoPage />} />
        <Route path="/cola" element={<ColaPage />} />
        <Route path="/proveedores" element={<ProveedoresPage />} />
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/pagos" element={<PagosPage />} />
        <Route path="/sistema" element={<SistemaPage />} />
        <Route path="/marketing" element={<MarketingPage />} />
        
        {/* NUEVAS RUTAS */}
        <Route path="/rentabilidad" element={<RentabilidadPage />} />
        <Route path="/analitica" element={<AnaliticaPage />} />
      </Route>
    </Routes>
  );
}
