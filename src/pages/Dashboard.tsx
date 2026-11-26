import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  LayoutDashboard,
  Scale,
  LogIn,
  Settings,
  Users,
  Camera,
  CheckCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Truck,
  Cpu,
  Layers,
  Activity,
  FileText,
  Radio,
  IndianRupee,
  Eye,
  Server,
  Zap,
} from "lucide-react";
import { useDashboard, PendingQueueItem, ProductBreakdownItem, GateScanItem } from "@/hooks/useDashboard";
import { StatCard } from "@/components/dashboard/StatCard";
import { OperationsChart } from "@/components/dashboard/OperationsChart";
import { useNavigate } from "react-router-dom";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";

const Dashboard: React.FC = () => {
  const {
    stats,
    scale,
    pendingQueue,
    productBreakdown,
    recentScans,
    hourlyData,
    recentTransactions,
    systemHealth,
    loading,
    refresh,
  } = useDashboard();

  const { company } = useCompany();
  const { user, role, canAccessRoute } = useAuth();
  const navigate = useNavigate();

  const isGateOperator =
    role?.id === "gate_operator" ||
    user?.roleId === "gate_operator" ||
    role?.name?.toLowerCase().includes("gate") ||
    role?.name?.toLowerCase().includes("security");
  const canAccessWeighbridge = canAccessRoute("/weighbridge");

  // Role perspective selection (default to user's assigned role, but admin can switch views)
  const defaultPerspective =
    role?.id === "weighbridge_operator" || user?.roleId === "weighbridge_operator"
      ? "weighbridge"
      : isGateOperator
      ? "gate"
      : "admin";

  const [activePerspective, setActivePerspective] = useState<string>(defaultPerspective);

  // Sync default perspective when user or role changes
  useEffect(() => {
    setActivePerspective(defaultPerspective);
  }, [defaultPerspective]);

  const isAdmin =
    role?.id === "super_admin" ||
    role?.id === "superadmin" ||
    user?.roleId === "super_admin" ||
    user?.roleId === "superadmin" ||
    role?.name?.toLowerCase().includes("super admin") ||
    (Array.isArray(role?.permissions) && role?.permissions.includes("all:manage")) ||
    (Array.isArray(role?.permissions) && role?.permissions.includes("users:manage")) ||
    (Array.isArray(role?.modules) && role?.modules.includes("/users"));

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------- */}
      {/* HEADER WITH REAL-TIME CLOCK & USER LOGIN BADGE              */}
      {/* ----------------------------------------------------------- */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 rounded-xl bg-card border shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-inner">
            <LayoutDashboard className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {company.firmName || "Dharani Weighbridge"}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>Logged in as <strong className="text-foreground">{user?.name || "Operator"}</strong></span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <ShieldCheck className="h-3 w-3 text-emerald-500" />
                {role?.name || user?.roleName || "Plant Head / Admin"}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- */}
      {/* TOP STATS KPI CARDS (Hidden for Gate Monitor login)         */}
      {/* ----------------------------------------------------------- */}
      {!isGateOperator && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Today's Weighments"
            value={stats.todayTransactions}
            icon={Scale}
            badge={<Badge variant="secondary">{stats.completedWeighments} Completed</Badge>}
            description="Total sessions logged in database"
            onClick={canAccessWeighbridge ? () => navigate("/weighbridge") : undefined}
          />

          <StatCard
            title="Pending 2nd Weight"
            value={stats.pendingSecondWeight}
            icon={Clock}
            badge={
              stats.pendingSecondWeight > 0 ? (
                <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                  Awaiting Tare/Gross
                </Badge>
              ) : (
                <Badge variant="outline">Queue Clear</Badge>
              )
            }
            description="Vehicles awaiting return weighment"
            onClick={canAccessWeighbridge ? () => navigate("/weighbridge") : undefined}
          />

          <StatCard
            title="Gate ANPR Scans"
            value={stats.gateScansToday}
            icon={LogIn}
            badge={
              <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                Live ANPR
              </Badge>
            }
            description="Plates recorded by gate cameras"
            onClick={() => navigate("/gate-monitor")}
          />

          <StatCard
            title="Net Weighted - QTL"
            value={`${((stats.totalNetKg || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} QTL`}
            icon={TrendingUp}
            badge={<Badge variant="outline">{stats.totalNetKg.toLocaleString()} kg Net</Badge>}
            description="Cumulative net weight weighed"
          />
        </div>
      )}

      {/* ----------------------------------------------------------- */}
      {/* OPERATIONAL INSIGHTS SECTION                                */}
      {/* ----------------------------------------------------------- */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Operational Insights
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Dynamic operational intelligence tailored to your login role and responsibilities
            </p>
          </div>

          {/* Perspective selector for Plant Head / Admin to view any operator's perspective */}
          {isAdmin && (
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border text-xs">
              <span className="text-[11px] font-medium text-muted-foreground px-2">View As:</span>
              <button
                type="button"
                onClick={() => setActivePerspective("admin")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  activePerspective === "admin"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Plant Head (Admin)
              </button>
              <button
                type="button"
                onClick={() => setActivePerspective("weighbridge")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  activePerspective === "weighbridge"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Weighbridge Scale
              </button>
              <button
                type="button"
                onClick={() => setActivePerspective("gate")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  activePerspective === "gate"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Gate Security
              </button>
            </div>
          )}
        </div>

        {/* ========================================================= */}
        {/* VIEW 1: PLANT HEAD / ADMIN INSIGHTS                       */}
        {/* ========================================================= */}
        {activePerspective === "admin" && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Cotton Products & Tonnage Distribution */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2.5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-500" />
                    Cotton Products Mix
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {productBreakdown.length} Products
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Volume breakdown of commodities weighed today
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {productBreakdown.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">No commodities logged today</p>
                ) : (
                  productBreakdown.map((item, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground truncate max-w-[140px]">{item.product}</span>
                        <span className="font-mono text-muted-foreground">
                          {item.count} tickets • {Math.round(item.netKg / 100) / 10} MT
                        </span>
                      </div>
                      <Progress
                        value={stats.totalNetKg > 0 ? (item.netKg / stats.totalNetKg) * 100 : 100}
                        className="h-1.5"
                      />
                    </div>
                  ))
                )}
                <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Gross: {(stats.totalGrossKg / 1000).toFixed(1)} MT</span>
                  <span>Net: {stats.totalWeightMT} MT</span>
                </div>
              </CardContent>
            </Card>

            {/* Card 2: Commercial & Weighment Collections */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2.5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <IndianRupee className="h-4 w-4 text-emerald-500" />
                    Collections & Billing
                  </CardTitle>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                    Collected
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Today's weighbridge service fees and charges
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    ₹{stats.totalCharges.toLocaleString()}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    From {stats.todayTransactions} registered weighment sessions
                  </p>
                </div>

                <div className="rounded-lg bg-muted/40 p-2.5 border text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Fee / Session:</span>
                    <span className="font-semibold text-foreground">
                      ₹{stats.todayTransactions > 0 ? Math.round(stats.totalCharges / stats.todayTransactions) : 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active Suppliers:</span>
                    <span className="font-semibold text-foreground">
                      {new Set(recentTransactions.map((t) => t.party_name)).size} parties
                    </span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-8"
                  onClick={() => navigate("/weighbridge")}
                >
                  View Billable Sessions <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </CardContent>
            </Card>

            {/* Card 3: Yard Vehicle Turnaround & Fleet */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2.5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-amber-500" />
                    Yard Traffic & Turnaround
                  </CardTitle>
                  <Badge
                    className={`text-[10px] ${
                      pendingQueue.length > 0
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                        : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                    }`}
                  >
                    {pendingQueue.length} on Site
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Active vehicles currently inside premises
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {pendingQueue.length === 0 ? (
                  <div className="py-4 text-center">
                    <CheckCircle className="h-8 w-8 text-emerald-500/60 mx-auto mb-1.5" />
                    <p className="text-xs font-medium text-foreground">Yard is clear</p>
                    <p className="text-[11px] text-muted-foreground">All vehicles completed second weighment</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                    {pendingQueue.slice(0, 3).map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/40 border text-xs"
                      >
                        <div>
                          <p className="font-semibold text-foreground font-mono">{item.vehicleNo}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{item.partyName}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                          {item.waitMinutes}m waiting
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>ANPR Gate Reads: {stats.gateScansToday}</span>
                  <span
                    className="text-primary hover:underline cursor-pointer"
                    onClick={() => navigate("/gate-monitor")}
                  >
                    Gate Stream →
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Card 4: System Infrastructure & Cloud Sync */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2.5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Server className="h-4 w-4 text-purple-500" />
                    Plant Edge Connectivity
                  </CardTitle>
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <CardDescription className="text-xs">
                  Hardware bridges and cloud synchronization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Digital Scale:</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                    COM3 @ 2400 baud
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">ANPR Cameras:</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                    {systemHealth.camerasOnline}/{systemHealth.totalCameras} Online
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Edge Cloud Sync:</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      !systemHealth.cloudSyncEnabled
                        ? "text-muted-foreground border-border"
                        : systemHealth.cloudSyncStatus === "offline_queued" || systemHealth.cloudSyncStatus === "failed"
                        ? "text-amber-600 border-amber-500/30"
                        : "text-emerald-600 border-emerald-500/30"
                    }`}
                  >
                    {!systemHealth.cloudSyncEnabled
                      ? "Disabled"
                      : systemHealth.cloudSyncStatus === "offline_queued"
                      ? "Queued (Offline)"
                      : systemHealth.cloudSyncStatus === "failed"
                      ? "Attention Needed"
                      : "Active (5m)"}
                  </Badge>
                </div>

                <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Audit Logs Today: {systemHealth.auditCountToday}</span>
                  <span
                    className="text-primary hover:underline cursor-pointer"
                    onClick={() => navigate("/settings")}
                  >
                    Settings →
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 2: WEIGHBRIDGE OPERATOR INSIGHTS                     */}
        {/* ========================================================= */}
        {activePerspective === "weighbridge" && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Live Scale Indicator Readout */}
            <Card className="border-primary/40 bg-gradient-to-br from-primary/5 via-card to-card hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />
                    Live COM3 Scale Indicator
                  </CardTitle>
                  <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]">
                    Connected
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  {scale.model || "Ventek VMS-WB"} Indicator on {scale.port || "COM3"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 rounded-lg bg-black/90 dark:bg-black/80 text-emerald-400 font-mono text-center border border-emerald-500/30 shadow-inner">
                  <div className="text-3xl font-bold tracking-wider">
                    {scale.liveWeight.toLocaleString()} <span className="text-base text-emerald-500">{scale.unit}</span>
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-1 text-[10px]">
                    <span className={`px-1.5 py-0.5 rounded ${scale.stable ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                      {scale.stable ? "STABLE" : "MOTION"}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded ${scale.zero ? "bg-blue-500/20 text-blue-300" : "bg-muted text-muted-foreground"}`}>
                      {scale.zero ? "ZERO" : "LOADED"}
                    </span>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => navigate("/weighbridge")}
                >
                  <Scale className="h-3.5 w-3.5 mr-1.5" />
                  Capture Scale Weight
                </Button>
              </CardContent>
            </Card>

            {/* Card 2: Vehicles Awaiting 2nd Weight Queue */}
            <Card className="lg:col-span-2 hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-500" />
                      Pending 2nd Weight Queue ({pendingQueue.length})
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Vehicles waiting in the yard for return weighment
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => navigate("/weighbridge")}
                  >
                    View Queue <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {pendingQueue.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground text-xs">
                    <CheckCircle className="h-6 w-6 text-emerald-500/60 mx-auto mb-1" />
                    No vehicles pending 2nd weighment. All scale sessions are closed.
                  </div>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/50 text-muted-foreground text-[11px] font-medium">
                        <tr>
                          <th className="px-3 py-1.5">Vehicle</th>
                          <th className="px-3 py-1.5">Party</th>
                          <th className="px-3 py-1.5 text-right">1st Wt</th>
                          <th className="px-3 py-1.5 text-center">Wait</th>
                          <th className="px-3 py-1.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pendingQueue.slice(0, 3).map((item, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="px-3 py-1.5 font-mono font-bold text-foreground">
                              {item.vehicleNo}
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[120px]">
                              {item.partyName}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono font-medium">
                              {Number(item.firstWeight).toLocaleString()} kg
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                                {item.waitMinutes}m
                              </Badge>
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2 text-primary border-primary/30 hover:bg-primary/10"
                                onClick={() => navigate("/weighbridge")}
                              >
                                Take 2nd Wt
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 3: Shift Productivity & Rapid Controls */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-500" />
                  Shift Scale Performance
                </CardTitle>
                <CardDescription className="text-xs">
                  Operator: {user?.name || "Ramesh Kulkarni"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs">
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Completed Today:</span>
                  <span className="font-bold text-foreground font-mono">{stats.completedWeighments} slips</span>
                </div>
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Pending in Yard:</span>
                  <span className="font-bold text-amber-600 font-mono">{stats.pendingSecondWeight} vehicles</span>
                </div>
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Net Weighed:</span>
                  <span className="font-bold text-foreground font-mono">{stats.totalWeightMT} MT</span>
                </div>

                <div className="pt-1 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[11px] h-7"
                    onClick={() => navigate("/weighbridge")}
                  >
                    New Slip
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[11px] h-7"
                    onClick={() => navigate("/weighbridge")}
                  >
                    Print Slip
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 3: GATE SECURITY INSIGHTS                            */}
        {/* ========================================================= */}
        {activePerspective === "gate" && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Latest Plate Detected */}
            <Card className="border-emerald-500/30 bg-emerald-500/5 hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Camera className="h-4 w-4 text-emerald-500" />
                    Latest ANPR Capture
                  </CardTitle>
                  <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
                    Live Scan
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  Gate Camera 1 (Entry Gate)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="p-3 rounded-lg bg-card border text-center shadow-sm">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">License Plate</p>
                  <p className="text-2xl font-bold font-mono tracking-widest text-foreground mt-0.5">
                    {recentScans[0]?.vehicle_reg_no || "TN15MF2815"}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-1 text-[11px]">
                    <span className="text-muted-foreground">Confidence:</span>
                    <span className="font-semibold text-emerald-600">
                      {Math.round(Number(recentScans[0]?.confidence || 0.98) * 100)}%
                    </span>
                    <span>•</span>
                    <Badge variant="outline" className="text-[10px] py-0 text-emerald-600 border-emerald-500/30">
                      Entry
                    </Badge>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => navigate("/gate-monitor")}
                >
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                  View CCTV Streams
                </Button>
              </CardContent>
            </Card>

            {/* Card 2: Recent ANPR Detections Feed */}
            <Card className="lg:col-span-2 hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <LogIn className="h-4 w-4 text-blue-500" />
                      Recent Gate Passes ({recentScans.length} logged)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Live recognition feed from Camera 1 and Camera 2
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => navigate("/gate-monitor")}
                  >
                    All Detections <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground text-[11px] font-medium">
                      <tr>
                        <th className="px-3 py-1.5">Plate Number</th>
                        <th className="px-3 py-1.5">Direction</th>
                        <th className="px-3 py-1.5">Camera</th>
                        <th className="px-3 py-1.5 text-center">Confidence</th>
                        <th className="px-3 py-1.5 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {recentScans.slice(0, 4).map((scan, idx) => (
                        <tr key={scan.id || idx} className="hover:bg-muted/30">
                          <td className="px-3 py-1.5 font-mono font-bold text-foreground">
                            {scan.vehicle_reg_no || "HR98AA0000"}
                          </td>
                          <td className="px-3 py-1.5">
                            <Badge
                              variant="outline"
                              className={`text-[10px] py-0 ${
                                (scan.direction || "entry").toLowerCase() === "entry"
                                  ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/5"
                                  : "text-blue-600 border-blue-500/30 bg-blue-500/5"
                              }`}
                            >
                              {(scan.direction || "entry").toUpperCase()}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground text-[11px]">
                            {scan.camera_id || "cam_gate_1"}
                          </td>
                          <td className="px-3 py-1.5 text-center font-mono">
                            {Math.round(Number(scan.confidence || 0.98) * 100)}%
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground text-[11px]">
                            {scan.created_at ? new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Card 3: Gate Security Surveillance Health */}
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-purple-500" />
                  Security Gate Status
                </CardTitle>
                <CardDescription className="text-xs">
                  Active gate guard & camera status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs">
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Guard on Duty:</span>
                  <span className="font-semibold text-foreground">{user?.name || "Mahesh Patil"}</span>
                </div>
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Camera 1 (Entry):</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                    Online
                  </Badge>
                </div>
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Camera 2 (Exit):</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                    Online
                  </Badge>
                </div>
                <div className="flex justify-between p-2 rounded-md bg-muted/40 border">
                  <span className="text-muted-foreground">Video Stream Proxy:</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                    Online
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- */}
      {/* CHART & RECENT TRANSACTIONS GRID (Weighbridge/Admin)        */}
      {/* ----------------------------------------------------------- */}
      {!isGateOperator && (
        <div className="grid gap-6 lg:grid-cols-2">
          <OperationsChart data={hourlyData} />

          {/* Recent Transactions List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Live Weighbridge Transactions</CardTitle>
                  <CardDescription>Latest vehicle weighments recorded</CardDescription>
                </div>
                {canAccessWeighbridge && (
                  <Button variant="ghost" size="sm" onClick={() => navigate("/weighbridge")} className="text-xs">
                    View All <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 text-muted-foreground font-medium">
                    <tr>
                      <th className="px-3 py-2">Tx #</th>
                      <th className="px-3 py-2">Vehicle</th>
                      <th className="px-3 py-2">Party</th>
                      <th className="px-3 py-2 text-right">Net Wt (kg)</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          No weighbridge transactions recorded yet today.
                        </td>
                      </tr>
                    ) : (
                      recentTransactions.map((tx: any, idx: number) => (
                        <tr key={tx.session_id || idx} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-mono font-medium">#{tx.transaction_no || idx + 1}</td>
                          <td className="px-3 py-2 font-semibold text-foreground">{tx.vehicle_reg_no || tx.vehicle_no || "N/A"}</td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[130px]">{tx.party_name || "—"}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium">
                            {tx.net_weight || tx.nett_weight ? `${Number(tx.net_weight || tx.nett_weight).toLocaleString()} kg` : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge
                              variant="outline"
                              className={`text-[10px] py-0 ${
                                tx.status === "completed"
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                                  : tx.status === "pending_2nd_weight"
                                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {tx.status === "completed" ? "Completed" : tx.status === "pending_2nd_weight" ? "1st Done" : "Pending"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
