import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Layout } from "@/components/Layout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import GateMonitor from "./pages/GateMonitor";
import Weighbridge from "./pages/Weighbridge";
import Reports from "./pages/Reports";
import DeviceConfig from "./pages/DeviceConfig";
import CompanySettings from "./pages/CompanySettings";
import UserManagement from "./pages/UserManagement";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CompanyProvider>
            <Routes>
              {/* Public Auth Route */}
              <Route path="/login" element={<Login />} />

              {/* Protected Operational Routes */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Routes>
                        {/* Core Operations */}
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/gate-monitor" element={<GateMonitor />} />
                        <Route path="/weighbridge" element={<Weighbridge />} />
                        <Route path="/reports" element={<Reports />} />

                        {/* System & Configuration */}
                        <Route path="/device-config" element={<DeviceConfig />} />
                        <Route path="/settings" element={<CompanySettings />} />
                        <Route path="/company-settings" element={<CompanySettings />} />
                        <Route path="/users" element={<UserManagement />} />

                        {/* Fallback */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Layout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </CompanyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
