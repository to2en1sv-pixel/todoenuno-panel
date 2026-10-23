import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ResumenPage } from '@/pages/Resumen';
import { CatalogoPage } from '@/pages/Catalogo';
import { ColaPage } from '@/pages/Cola';
import { FeedPage } from '@/pages/Feed';
import { CronsPage } from '@/pages/Crons';
import { SistemaPage } from '@/pages/Sistema';
import { ComingSoon } from '@/pages/ComingSoon';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ResumenPage />} />
        <Route path="/catalogo" element={<CatalogoPage />} />
        <Route path="/cola" element={<ColaPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/crons" element={<CronsPage />} />
        <Route path="/pedidos" element={<ComingSoon module="Pedidos" />} />
        <Route path="/chats" element={<ComingSoon module="Chats (UniChat)" />} />
        <Route path="/sistema" element={<SistemaPage />} />
      </Route>
    </Routes>
  );
}
