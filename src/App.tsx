import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { HoyPage } from '@/pages/Hoy';
import { CatalogoPage } from '@/pages/Catalogo';
import { ColaPage } from '@/pages/Cola';
import { SistemaPage } from '@/pages/Sistema';
import { UniChatPage } from '@/pages/UniChat';
import { PagosPage } from '@/pages/Pagos'; // <-- NUEVA PÁGINA
import { ProveedoresPage } from '@/pages/Proveedores';
import { DocsPage } from '@/pages/Docs';
import { PedidosPage } from '@/pages/Pedidos'; // <-- NUEVA PÁGINA

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HoyPage />} />
        <Route path="/unichat" element={<UniChatPage />} />
        <Route path="/catalogo" element={<CatalogoPage />} />
        <Route path="/cola" element={<ColaPage />} />
        <Route path="/pagos" element={<PagosPage />} /> {/* <-- NUEVA RUTA */}
        <Route path="/sistema" element={<SistemaPage />} />
        <Route path="/proveedores" element={<ProveedoresPage />} />
        <Route path="/pedidos" element={<PedidosPage />} /> {/* <-- NUEVA RUTA */}
        <Route path="/docs" element={<DocsPage />} />
      </Route>
    </Routes>
  );
}
