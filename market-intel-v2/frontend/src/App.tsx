import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import NewsWallMarket from "@/pages/NewsWallMarket";
import NotFound from "@/pages/NotFound";

// Heavy pages (Leaflet maps, Recharts) load on demand — they'd otherwise sit
// in the initial bundle and slow down first paint for everyone.
const Archive = lazy(() => import("@/pages/Archive"));
const PortTraffic = lazy(() => import("@/pages/PortTraffic"));
const TradeFlow = lazy(() => import("@/pages/TradeFlow"));
const ClimateWatch = lazy(() => import("@/pages/ClimateWatch"));
const DeskBasis = lazy(() => import("@/pages/DeskBasis"));
const DeskCurve = lazy(() => import("@/pages/DeskCurve"));
const OriginDesk = lazy(() => import("@/pages/OriginDesk"));
const LandedCost = lazy(() => import("@/pages/LandedCost"));
const WarrantStocks = lazy(() => import("@/pages/WarrantStocks"));
const DeskBulletin = lazy(() => import("@/pages/DeskBulletin"));
const DeskRisk = lazy(() => import("@/pages/DeskRisk"));
const DeskVerdict = lazy(() => import("@/pages/DeskVerdict"));
const VesselWatch = lazy(() => import("@/pages/VesselWatch"));

function PageFallback() {
  return (
    <div className="py-16 text-center">
      <p className="kicker text-[11px] text-text-faint">Loading…</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        {/* /prices renders nothing here — Layout keeps the Prices page
            permanently mounted so the TradingView iframe (and whatever the
            user drew on it) survives navigating away and back. */}
        <Route path="/prices" element={null} />
        <Route path="/wall/:market" element={<NewsWallMarket />} />
        <Route
          path="/history"
          element={
            <Suspense fallback={<PageFallback />}>
              <Archive />
            </Suspense>
          }
        />
        <Route
          path="/ports"
          element={
            <Suspense fallback={<PageFallback />}>
              <PortTraffic />
            </Suspense>
          }
        />
        <Route
          path="/analysis/trade-flow"
          element={
            <Suspense fallback={<PageFallback />}>
              <TradeFlow />
            </Suspense>
          }
        />
        <Route
          path="/analysis/climate"
          element={
            <Suspense fallback={<PageFallback />}>
              <ClimateWatch />
            </Suspense>
          }
        />
        <Route
          path="/desk/basis"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeskBasis />
            </Suspense>
          }
        />
        <Route
          path="/desk/curve"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeskCurve />
            </Suspense>
          }
        />
        <Route
          path="/desk/origin"
          element={
            <Suspense fallback={<PageFallback />}>
              <OriginDesk />
            </Suspense>
          }
        />
        <Route
          path="/desk/bulletin"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeskBulletin />
            </Suspense>
          }
        />
        <Route
          path="/desk/vessels"
          element={
            <Suspense fallback={<PageFallback />}>
              <VesselWatch />
            </Suspense>
          }
        />
        <Route
          path="/desk/verdict"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeskVerdict />
            </Suspense>
          }
        />
        <Route
          path="/desk/risk"
          element={
            <Suspense fallback={<PageFallback />}>
              <DeskRisk />
            </Suspense>
          }
        />
        <Route
          path="/desk/stocks"
          element={
            <Suspense fallback={<PageFallback />}>
              <WarrantStocks />
            </Suspense>
          }
        />
        <Route
          path="/desk/landed-cost"
          element={
            <Suspense fallback={<PageFallback />}>
              <LandedCost />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
