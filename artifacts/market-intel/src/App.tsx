import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Dashboard from '@/pages/Dashboard';
import FlashDesk from '@/pages/FlashDesk';
import WeeklyReview from '@/pages/WeeklyReview';
import Scorecard from '@/pages/Scorecard';
import Archive from '@/pages/Archive';
import AnalysisDetail from '@/pages/AnalysisDetail';
import PortTraffic from '@/pages/PortTraffic';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/flash" component={FlashDesk} />
      <Route path="/weekly" component={WeeklyReview} />
      <Route path="/scorecard" component={Scorecard} />
      <Route path="/ports" component={PortTraffic} />
      <Route path="/history" component={Archive} />
      <Route path="/analysis/:id" component={AnalysisDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
