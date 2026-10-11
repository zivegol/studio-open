import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import History from "./pages/History";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import Statistics from "./pages/Statistics";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return <DashboardLayout><Switch><Route path={"/"} component={Home} /><Route path={"/history"} component={History} /><Route path={"/statistics"} component={Statistics} /><Route path={"/settings"} component={Settings} /><Route path={"/404"} component={NotFound} /><Route component={NotFound} /></Switch></DashboardLayout>;
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
