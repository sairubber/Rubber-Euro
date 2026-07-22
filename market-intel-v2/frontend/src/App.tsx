import { Route, Routes } from "react-router-dom";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import NewsWallMarket from "@/pages/NewsWallMarket";
import Archive from "@/pages/Archive";
import PortTraffic from "@/pages/PortTraffic";
import TradeFlow from "@/pages/TradeFlow";
import ClimateWatch from "@/pages/ClimateWatch";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/wall/:market" element={<NewsWallMarket />} />
        <Route path="/history" element={<Archive />} />
        <Route path="/ports" element={<PortTraffic />} />
        <Route path="/analysis/trade-flow" element={<TradeFlow />} />
        <Route path="/analysis/climate" element={<ClimateWatch />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
