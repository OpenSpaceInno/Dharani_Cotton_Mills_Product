import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText,
  Download,
  Search,
  RotateCcw,
  TrendingUp,
  Scale,
  Users,
  Layers,
  ShieldAlert,
  ArrowRight,
  Clock,
  Filter,
  CheckCircle,
  Calendar,
  IndianRupee,
  Truck,
  Eye,
  BarChart3,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { IndustrialWeighSlipModal } from "@/components/weighbridge/IndustrialWeighSlipModal";
import { WeighSlip, WeighbridgeSession } from "@/types/weighbridge";
import { useNavigate } from "react-router-dom";
import { formatToDDMMYYYY, formatToHHMMSS, formatReportDateTime } from "@/utils/dateTimeFormatters";

export default function Reports() {
  const { role, user, isLoading: authLoading } = useAuth();
  const { company } = useCompany();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Role Security Check: Strictly Super Admin, or permitted by role modules / permissions
  const isAdmin =
    !role || // If auth hasn't restricted or role is loading
    role?.id === "super_admin" ||
    role?.id === "superadmin" ||
    user?.roleId === "super_admin" ||
    user?.roleId === "superadmin" ||
    role?.name?.toLowerCase().includes("super admin") ||
    (Array.isArray(role?.permissions) && role?.permissions.includes("all:manage")) ||
    (Array.isArray(role?.permissions) && role?.permissions.includes("reports:export")) ||
    (Array.isArray(role?.modules) && role?.modules.includes("/reports"));

  // Active Tab State
  const [currentTab, setCurrentTab] = useState<string>("register");

  // Filter States
  const getTodayISO = () => new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState<string>(getTodayISO());
  const [dateTo, setDateTo] = useState<string>(getTodayISO());
  const [activeDatePreset, setActiveDatePreset] = useState<string>("today");

  const [selectedParty, setSelectedParty] = useState<string>("all");
  const [selectedMaterial, setSelectedMaterial] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [vehicleQuery, setVehicleQuery] = useState<string>("");

  // Options populated from database
  const [filterOptions, setFilterOptions] = useState<{
    parties: string[];
    products: string[];
    statuses: string[];
  }>({
    parties: [],
    products: [],
    statuses: ["completed", "pending_2nd_weight", "cancelled"],
  });

  // Data States
  const [records, setRecords] = useState<any[]>([]);
  const [partyTotals, setPartyTotals] = useState<any[]>([]);
  const [serverVehicleStats, setServerVehicleStats] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedSessionForModal, setSelectedSessionForModal] = useState<WeighbridgeSession | null>(null);

  // Quick Date Presets Handler
  const applyDatePreset = (preset: "today" | "yesterday" | "week" | "month" | "all") => {
    setActiveDatePreset(preset);
    const today = new Date();
    const toDateStr = today.toISOString().split("T")[0];

    if (preset === "today") {
      setDateFrom(toDateStr);
      setDateTo(toDateStr);
    } else if (preset === "yesterday") {
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      const yestStr = yest.toISOString().split("T")[0];
      setDateFrom(yestStr);
      setDateTo(yestStr);
    } else if (preset === "week") {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      setDateFrom(weekAgo.toISOString().split("T")[0]);
      setDateTo(toDateStr);
    } else if (preset === "month") {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      setDateFrom(monthStart.toISOString().split("T")[0]);
      setDateTo(toDateStr);
    } else if (preset === "all") {
      setDateFrom("2024-01-01");
      setDateTo(toDateStr);
    }
  };

  // Load Dropdown Options
  useEffect(() => {
    if (!isAdmin) return;
    api.getFilterOptions()
      .then((opts) => {
        if (opts) {
          setFilterOptions({
            parties: (opts.parties || []).filter((p: any) => typeof p === 'string' && p.trim() !== ''),
            products: (opts.products || []).filter((p: any) => typeof p === 'string' && p.trim() !== ''),
            statuses: (opts.statuses || []).filter((s: any) => typeof s === 'string' && s.trim() !== ''),
          });
        }
      })
      .catch((e) => console.warn("Could not fetch filter options:", e));
  }, [isAdmin]);

  // Fetch Report Data
  const fetchReportData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (selectedParty && selectedParty !== "all") params.partyName = selectedParty;
      if (selectedMaterial && selectedMaterial !== "all") params.material = selectedMaterial;
      if (selectedStatus && selectedStatus !== "all") params.status = selectedStatus;
      if (vehicleQuery.trim()) params.vehicleNo = vehicleQuery.trim();

      const [searchRes, totalsRes, vehicleRes] = await Promise.all([
        api.searchReports(params),
        api.getPartyTotals(params).catch(() => null),
        api.getVehicleStats(params).catch(() => null),
      ]);

      if (searchRes && searchRes.data) {
        setRecords(searchRes.data);
      } else {
        setRecords([]);
      }

      if (totalsRes && totalsRes.partyTotals) {
        setPartyTotals(totalsRes.partyTotals);
      } else {
        setPartyTotals([]);
      }

      if (vehicleRes && vehicleRes.vehicleStats) {
        setServerVehicleStats(vehicleRes.vehicleStats);
      } else {
        setServerVehicleStats([]);
      }
    } catch (err: any) {
      console.error("Reports query error:", err);
      toast({
        title: "Report Load Failed",
        description: err.message || "Failed to query weighment database records",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, dateFrom, dateTo, selectedParty, selectedMaterial, selectedStatus, vehicleQuery, toast]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  // Vehicle Tracking Aggregation & Per-Slip Frequency Sequencing
  const vehicleTracking = useMemo(() => {
    const vehGroups: Record<string, any[]> = {};
    const freqMap = new Map<string, {
      vehicleNo: string;
      count: number;
      grossKg: number;
      tareKg: number;
      netKg: number;
      charges: number;
      firstVisitTime: string;
      lastVisitTime: string;
      parties: Set<string>;
      commodities: Set<string>;
    }>();

    records.forEach((r) => {
      const rawVeh = (r.VehicleNo || r.vehicle_no || r.vehicle_reg_no || 'UNKNOWN').trim();
      const normVeh = rawVeh.toUpperCase().replace(/\s+/g, ' ');
      if (!vehGroups[normVeh]) {
        vehGroups[normVeh] = [];
      }
      vehGroups[normVeh].push(r);

      const gross = Number(r.FWeight ?? r.fWeight ?? r.gross_weight ?? r.first_weight ?? 0);
      const tare = Number(r.SWeight ?? r.sWeight ?? r.tare_weight ?? r.second_weight ?? 0);
      const net = Number(r.NettWeight ?? r.nettWeight ?? r.net_weight ?? r.nett_weight ?? Math.abs(gross - tare));
      const charge = Number(r.Charges ?? r.charges ?? r.Amount ?? r.amount ?? 0);
      const rowTime = r.FDate ? `${r.FDate} ${r.FTime || '00:00:00'}` : (r.created_at || '');

      let stat = freqMap.get(normVeh);
      if (!stat) {
        stat = {
          vehicleNo: rawVeh,
          count: 0,
          grossKg: 0,
          tareKg: 0,
          netKg: 0,
          charges: 0,
          firstVisitTime: rowTime,
          lastVisitTime: rowTime,
          parties: new Set<string>(),
          commodities: new Set<string>(),
        };
        freqMap.set(normVeh, stat);
      }

      stat.count += 1;
      stat.grossKg += gross;
      stat.tareKg += tare;
      stat.netKg += net;
      stat.charges += charge;
      if (rowTime && (!stat.firstVisitTime || rowTime < stat.firstVisitTime)) stat.firstVisitTime = rowTime;
      if (rowTime && (!stat.lastVisitTime || rowTime > stat.lastVisitTime)) stat.lastVisitTime = rowTime;

      const pName = r.PartyName || r.party_name;
      if (pName && String(pName).trim() !== '') stat.parties.add(String(pName).trim());

      const mat = r.Product || r.material;
      if (mat && String(mat).trim() !== '') stat.commodities.add(String(mat).trim());
    });

    // Compute chronological slip sequence index for each transaction
    const slipMeta = new Map<string | number, { tripSeq: number; totalVisits: number }>();
    Object.entries(vehGroups).forEach(([normVeh, slips]) => {
      const sorted = [...slips].sort((a, b) => {
        const tA = Number(a.TransactionNo || a.transaction_no || 0);
        const tB = Number(b.TransactionNo || b.transaction_no || 0);
        return tA - tB;
      });

      sorted.forEach((slip, idx) => {
        const idKey = slip.session_id || slip.TransactionNo || slip.transaction_no;
        if (idKey !== undefined && idKey !== null) {
          slipMeta.set(idKey, {
            tripSeq: idx + 1,
            totalVisits: sorted.length,
          });
        }
      });
    });

    const list = Array.from(freqMap.values()).map((v) => ({
      ...v,
      partiesList: Array.from(v.parties),
      commoditiesList: Array.from(v.commodities),
      netMT: Number((v.netKg / 1000).toFixed(2)),
      avgPayloadKg: v.count > 0 ? Math.round(v.netKg / v.count) : 0,
    })).sort((a, b) => b.count - a.count || b.netKg - a.netKg);

    let repeatCount = 0;
    list.forEach((v) => {
      if (v.count > 1) repeatCount++;
    });

    return {
      freqMap,
      slipMeta,
      list,
      uniqueCount: list.length,
      repeatCount,
      topVehicle: list[0]?.vehicleNo || 'None',
      topVehicleTrips: list[0]?.count || 0,
    };
  }, [records]);

  // Derived Summary Analytics
  const summary = useMemo(() => {
    const totalTransactions = records.length;
    let totalGrossKg = 0;
    let totalTareKg = 0;
    let totalNetKg = 0;
    let totalCharges = 0;
    let completedCount = 0;
    let pendingCount = 0;
    const uniqueParties = new Set<string>();
    const commodityMap: Record<string, { count: number; netKg: number }> = {};

    records.forEach((r) => {
      const gross = Number(r.FWeight ?? r.fWeight ?? r.gross_weight ?? r.first_weight ?? 0);
      const tare = Number(r.SWeight ?? r.sWeight ?? r.tare_weight ?? r.second_weight ?? 0);
      const net = Number(r.NettWeight ?? r.nettWeight ?? r.net_weight ?? r.nett_weight ?? Math.abs(gross - tare));
      const charge = Number(r.Charges ?? r.charges ?? r.Amount ?? r.amount ?? 0);

      totalGrossKg += gross;
      totalTareKg += tare;
      totalNetKg += net;
      totalCharges += charge;

      const st = String(r.Status || r.status || '').toLowerCase();
      if (st === "completed" || st === "inward" || st === "outward") completedCount++;
      if (st === "pending_2nd_weight" || st === "pending") pendingCount++;

      const pName = r.PartyName || r.party_name;
      if (pName && String(pName).trim() !== '') uniqueParties.add(String(pName).trim());

      const mat = r.Product || r.material || "Raw Cotton (Kapas)";
      if (!commodityMap[mat]) {
        commodityMap[mat] = { count: 0, netKg: 0 };
      }
      commodityMap[mat].count++;
      commodityMap[mat].netKg += net;
    });

    const commodityList = Object.entries(commodityMap).map(([material, data]) => ({
      material,
      count: data.count,
      netMT: Number((data.netKg / 1000).toFixed(2)),
      percentage: totalNetKg > 0 ? Math.round((data.netKg / totalNetKg) * 100) : 0,
    })).sort((a, b) => b.netMT - a.netMT);

    return {
      totalTransactions,
      completedCount,
      pendingCount,
      totalNetMT: (totalNetKg / 1000).toFixed(2),
      totalNetKg,
      totalCharges,
      uniquePartiesCount: uniqueParties.size,
      commodityList,
    };
  }, [records]);

  // CSV Export Handler with strict DD-MM-YYYY format and vehicle trip tracking
  const handleExportCSV = () => {
    if (records.length === 0) {
      toast({
        title: "No Data to Export",
        description: "No records found matching current date and filter criteria.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Slip No",
      "Date (DD-MM-YYYY)",
      "Time (HH:mm:ss)",
      "Timestamp (DD-MM-YYYY HH:mm:ss)",
      "Vehicle Reg No",
      "Vehicle Total Visits",
      "Trip Sequence",
      "Party Name",
      "Material / Commodity",
      "Gross Weight (kg)",
      "Tare Weight (kg)",
      "Net Weight (kg)",
      "Charges (INR)",
      "Status",
      "Operator"
    ];

    const rows = records.map((r, idx) => {
      const transNo = r.TransactionNo || r.transaction_no || idx + 1;
      const fDate = formatToDDMMYYYY(r.FDate || r.created_at);
      const fTime = formatToHHMMSS(r.FTime || r.created_at || "00:00:00");
      const fDateTime = formatReportDateTime(r.FDate, r.FTime, r.created_at);
      const veh = r.VehicleNo || r.vehicle_no || r.vehicle_reg_no || "";
      const meta = vehicleTracking.slipMeta.get(r.session_id || r.TransactionNo || r.transaction_no);
      const totalVisits = meta?.totalVisits || 1;
      const tripSeq = meta?.tripSeq || 1;
      const party = r.PartyName || r.party_name || "";
      const prod = r.Product || r.material || "";
      const gross = Number(r.FWeight ?? r.gross_weight ?? r.first_weight ?? 0);
      const tare = Number(r.SWeight ?? r.tare_weight ?? r.second_weight ?? 0);
      const net = Number(r.NettWeight ?? r.net_weight ?? r.nett_weight ?? Math.abs(gross - tare));
      const charges = Number(r.Charges ?? r.charges ?? r.Amount ?? r.amount ?? 0);
      const status = r.Status || r.status || "";
      const operator = r.FWUser || r.operator_name || "";

      return [
        transNo,
        `"${fDate}"`,
        `"${fTime}"`,
        `"${fDateTime}"`,
        `"${veh}"`,
        totalVisits,
        `"Trip ${tripSeq} of ${totalVisits}"`,
        `"${party.replace(/"/g, '""')}"`,
        `"${prod.replace(/"/g, '""')}"`,
        gross,
        tare,
        net,
        charges,
        `"${status}"`,
        `"${operator.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Dharani_Weighment_Report_${formatToDDMMYYYY(dateFrom)}_to_${formatToDDMMYYYY(dateTo)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Report Exported",
      description: `Downloaded ${records.length} records with vehicle tracking and DD-MM-YYYY timestamps.`,
    });
  };

  // Reset Filters
  const handleResetFilters = () => {
    applyDatePreset("today");
    setSelectedParty("all");
    setSelectedMaterial("all");
    setSelectedStatus("all");
    setVehicleQuery("");
  };

  // Map selected row to WeighSlip format for the modal
  const selectedSlip = useMemo<WeighSlip | null>(() => {
    if (!selectedSessionForModal) return null;
    const r = selectedSessionForModal;
    const gross = Number(r.FWeight ?? r.gross_weight ?? r.first_weight ?? 0);
    const tare = Number(r.SWeight ?? r.tare_weight ?? r.second_weight ?? 0);
    const net = Number(r.NettWeight ?? r.net_weight ?? Math.abs(gross - tare));

    const fDate = formatToDDMMYYYY(r.FDate || r.created_at);
    const fTime = formatToHHMMSS(r.FTime || r.created_at || '00:00:00');
    const sDate = r.SDate ? formatToDDMMYYYY(r.SDate) : '';
    const sTime = r.STime ? formatToHHMMSS(r.STime) : '';

    return {
      slipNumber: String(r.TransactionNo || r.transaction_no || '1'),
      sessionId: String(r.TransactionNo || r.session_id || '1'),
      transactionNo: Number(r.TransactionNo || r.transaction_no || 1),
      companyName: company?.firmName || 'Dharani Cotton Mills',
      companyAddress: company?.address || 'Vikarabad, Hyderabad, Telangana',
      phoneNo: company?.phone || '+91 20 2712 8899',
      partyName: r.PartyName || r.party_name || '',
      vehicleRegNo: r.VehicleNo || r.vehicle_no || r.vehicle_reg_no || '',
      vehicleNo: r.VehicleNo || r.vehicle_no || r.vehicle_reg_no || '',
      material: r.Product || r.material || 'Raw Cotton (Kapas)',
      product: r.Product || r.material || 'Raw Cotton (Kapas)',
      firstWeight: gross,
      firstWeightDate: fDate,
      firstWeightTime: fTime,
      secondWeight: tare,
      secondWeightDate: sDate,
      secondWeightTime: sTime,
      nettWeight: net,
      netWeight: net,
      charges: Number(r.Charges ?? r.charges ?? r.Amount ?? r.amount ?? 0),
      driverName: r.DriverName || r.driver_name || '',
      vehicleType: r.VehicleType || r.vehicle_type || 'Truck / 12-Wheeler',
      operatorName: r.FWUser || r.operator_name || 'System Operator',
      agent: r.TraderName || r.agent || '',
      destination: r.LocationName || r.destination || 'Plant Yard',
      rate: Number(r.Rate || 0),
      finalRate: Number(r.FinalRate || r.Rate || 0),
      totalAmount: Number(r.Amount || 0),
      evidence: [],
      printOptions: {
        printDuplicate: false,
        printQrCode: true,
        printImages: true,
      }
    };
  }, [selectedSessionForModal, company]);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Security Wall: Deny if not authorized
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center">
        <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Access Restricted</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md">
          The <strong>Operational Reports & Plant Analytics Module</strong> is strictly reserved for Admin and Plant Head roles.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Current Persona: <span className="font-semibold text-foreground">{role?.name || "Standard Operator"}</span>
        </p>
        <Button
          className="mt-6 gap-2"
          onClick={() => navigate("/weighbridge")}
        >
          Return to Weighbridge
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* ----------------------------------------------------------- */}
      {/* TOP HEADER & ACTION RIBBON                                  */}
      {/* ----------------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Reports & Plant Analytics
            </h1>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Weighment register, vehicle trip frequency tracking, and commercial tonnage ledger
            </p>
            <span className="text-[11px] font-mono text-muted-foreground/80 bg-muted/60 px-2 py-0.5 rounded border border-border/40">
              System Time: {formatReportDateTime(new Date())}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchReportData}
            disabled={loading}
            className="text-xs h-8 gap-1.5"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={records.length === 0}
            className="text-xs h-8 gap-1.5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
          >
            <Download className="h-3.5 w-3.5" />
            Export Excel / CSV
          </Button>
        </div>
      </div>

      {/* ----------------------------------------------------------- */}
      {/* FILTER & CRITERIA BAR                                       */}
      {/* ----------------------------------------------------------- */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          {/* Preset Buttons */}
          <div className="flex items-center gap-2 flex-wrap pb-2 border-b">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mr-1">
              <Calendar className="h-3.5 w-3.5" /> Period:
            </span>
            {[
              { id: "today", label: "Today" },
              { id: "yesterday", label: "Yesterday" },
              { id: "week", label: "Last 7 Days" },
              { id: "month", label: "This Month" },
              { id: "all", label: "All Records" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyDatePreset(p.id as any)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  activeDatePreset === p.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] font-mono text-muted-foreground">
              Selected: <strong className="text-foreground">{formatToDDMMYYYY(dateFrom)}</strong> to <strong className="text-foreground">{formatToDDMMYYYY(dateTo)}</strong>
            </span>
          </div>

          {/* Detailed Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* From Date */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">From Date (DD-MM-YYYY)</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setActiveDatePreset("custom");
                }}
                className="h-8 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground font-mono block">
                {formatToDDMMYYYY(dateFrom)}
              </span>
            </div>

            {/* To Date */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">To Date (DD-MM-YYYY)</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setActiveDatePreset("custom");
                }}
                className="h-8 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground font-mono block">
                {formatToDDMMYYYY(dateTo)}
              </span>
            </div>

            {/* Party Select */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Supplier / Party</label>
              <Select value={selectedParty} onValueChange={setSelectedParty}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All Parties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Parties ({filterOptions.parties.length})</SelectItem>
                  {filterOptions.parties.filter((p) => typeof p === 'string' && p.trim() !== '').map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Commodity Select */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Commodity</label>
              <Select value={selectedMaterial} onValueChange={setSelectedMaterial}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All Commodities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Commodities</SelectItem>
                  {filterOptions.products.filter((prod) => typeof prod === 'string' && prod.trim() !== '').map((prod) => (
                    <SelectItem key={prod} value={prod}>
                      {prod}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Select */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Status</label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="completed">Completed (2nd Weight)</SelectItem>
                  <SelectItem value="pending_2nd_weight">Pending Return (1st Done)</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Vehicle Search & Action */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Vehicle Reg No</label>
              <div className="flex gap-1.5">
                <Input
                  type="text"
                  placeholder="e.g. AP09, TS08"
                  value={vehicleQuery}
                  onChange={(e) => setVehicleQuery(e.target.value)}
                  className="h-8 text-xs font-mono uppercase"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetFilters}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  title="Reset Filters"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Quick Vehicle Frequency Filter Pills */}
          {vehicleTracking.list.filter(v => v.count > 1).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t text-[11px]">
              <span className="font-medium text-muted-foreground flex items-center gap-1">
                <Truck className="h-3 w-3 text-blue-500" /> Frequent Vehicles:
              </span>
              {vehicleTracking.list.slice(0, 6).map((v) => (
                <button
                  key={v.vehicleNo}
                  type="button"
                  onClick={() => {
                    setVehicleQuery(v.vehicleNo);
                    setCurrentTab("register");
                  }}
                  className={`px-2 py-0.5 rounded-full font-mono text-[10px] transition-all flex items-center gap-1 border ${
                    vehicleQuery.trim().toUpperCase() === v.vehicleNo.toUpperCase()
                      ? "bg-primary text-primary-foreground border-primary font-bold shadow-xs"
                      : "bg-muted/70 hover:bg-muted text-foreground border-border/60"
                  }`}
                  title={`${v.vehicleNo} has visited ${v.count} times`}
                >
                  <span>{v.vehicleNo}</span>
                  <span className="px-1 py-0.2 bg-black/10 dark:bg-white/10 rounded-full font-bold">
                    {v.count}x
                  </span>
                </button>
              ))}
              {vehicleQuery && (
                <button
                  type="button"
                  onClick={() => setVehicleQuery("")}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline ml-1 cursor-pointer"
                >
                  Clear Vehicle Filter
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- */}
      {/* EXECUTIVE KPI SUMMARY CARDS                                 */}
      {/* ----------------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Volume */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Cumulative Net Tonnage
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                {summary.totalNetKg.toLocaleString()} kg
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Total cotton weight processed in period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {summary.totalNetMT} <span className="text-sm font-normal text-muted-foreground">MT</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              From {summary.totalTransactions} recorded truck sessions
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Financial Billed Revenue */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-blue-500" />
                Weighment Charges
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-500/30">
                Gross Billed
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Slip fees and gross receipts logged
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              ₹{summary.totalCharges.toLocaleString()}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Avg ₹{summary.totalTransactions > 0 ? Math.round(summary.totalCharges / summary.totalTransactions) : 0} per transaction
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Trips & Scale Completion */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Scale className="h-4 w-4 text-purple-500" />
                Trips & Scale Completion
              </CardTitle>
              <Badge className="text-[10px] bg-purple-500/10 text-purple-600 border-purple-500/30">
                {summary.completedCount} Closed
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Session turnaround status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {summary.totalTransactions} <span className="text-sm font-normal text-muted-foreground">slips</span>
            </div>
            <p className="text-[11px] text-amber-600 font-medium mt-1">
              {summary.pendingCount} vehicles awaiting return 2nd weighment
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Vehicle Tracking & Repeat Trips */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-amber-500" />
                Vehicle Fleet & Frequency
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30 font-mono">
                {vehicleTracking.repeatCount} Repeat
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Unique vehicles & visit frequency
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-foreground">
              {vehicleTracking.uniqueCount} <span className="text-sm font-normal text-muted-foreground">trucks</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 truncate" title={vehicleTracking.topVehicle}>
              Top: <span className="font-mono font-semibold text-foreground">{vehicleTracking.topVehicle}</span> ({vehicleTracking.topVehicleTrips} trips)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------- */}
      {/* INSIGHTFUL TABS                                             */}
      {/* ----------------------------------------------------------- */}
      <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-4">
        <TabsList className="bg-muted/80 p-1 flex-wrap h-auto gap-1">
          <TabsTrigger value="register" className="text-xs gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Weighment Register ({records.length})
          </TabsTrigger>
          <TabsTrigger value="vehicleTrips" className="text-xs gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            Vehicle Fleet & Frequency ({vehicleTracking.list.length})
          </TabsTrigger>
          <TabsTrigger value="partyLedger" className="text-xs gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Supplier / Party Ledger ({partyTotals.length})
          </TabsTrigger>
          <TabsTrigger value="commodities" className="text-xs gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Commodity Breakdown ({summary.commodityList.length})
          </TabsTrigger>
        </TabsList>

        {/* ========================================================= */}
        {/* TAB 1: DETAILED WEIGHMENT REGISTER TABLE                  */}
        {/* ========================================================= */}
        <TabsContent value="register">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Weighment Register</CardTitle>
                <CardDescription>
                  Detailed transaction records with strict DD-MM-YYYY HH:mm:ss timestamps & vehicle visit frequency ({records.length} items)
                </CardDescription>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                Showing {records.length} of {records.length}
              </span>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground font-medium border-b">
                    <tr>
                      <th className="px-3 py-2.5">Slip #</th>
                      <th className="px-3 py-2.5">Date & Time (DD-MM-YYYY HH:mm:ss)</th>
                      <th className="px-3 py-2.5">Vehicle Reg No & Frequency</th>
                      <th className="px-3 py-2.5">Party / Supplier</th>
                      <th className="px-3 py-2.5">Commodity</th>
                      <th className="px-3 py-2.5 text-right">Gross (kg)</th>
                      <th className="px-3 py-2.5 text-right">Tare (kg)</th>
                      <th className="px-3 py-2.5 text-right font-bold">Net Wt (kg)</th>
                      <th className="px-3 py-2.5 text-right">Charges</th>
                      <th className="px-3 py-2.5 text-center">Status</th>
                      <th className="px-3 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                          <Scale className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                          <p className="font-medium text-foreground text-sm">No weighment records found</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Try adjusting the date range or clearing the filter options above.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      records.map((r, idx) => {
                        const transNo = r.TransactionNo || r.transaction_no || idx + 1;
                        const dateFormatted = formatReportDateTime(r.FDate, r.FTime, r.created_at || r.timestamp);
                        const veh = r.VehicleNo || r.vehicle_no || r.vehicle_reg_no || "N/A";
                        const slipInfo = vehicleTracking.slipMeta.get(r.session_id || r.TransactionNo || r.transaction_no);
                        const tripCount = slipInfo?.totalVisits || 1;
                        const tripSeq = slipInfo?.tripSeq || 1;

                        const party = r.PartyName || r.party_name || "—";
                        const prod = r.Product || r.material || "Raw Cotton";
                        const gross = Number(r.FWeight ?? r.gross_weight ?? r.first_weight ?? 0);
                        const tare = Number(r.SWeight ?? r.tare_weight ?? r.second_weight ?? 0);
                        const net = Number(r.NettWeight ?? r.net_weight ?? r.nett_weight ?? Math.abs(gross - tare));
                        const charge = Number(r.Charges ?? r.charges ?? r.Amount ?? r.amount ?? 0);
                        const st = String(r.Status || r.status || '').toLowerCase();
                        const isCompleted = st === 'completed' || st === 'inward' || st === 'outward';
                        const isPending = st === 'pending_2nd_weight' || st === 'pending';

                        return (
                          <tr key={r.session_id || transNo || idx} className="hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2 font-mono font-bold text-primary">
                              #{transNo}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[11px]">
                              {dateFormatted}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono font-bold text-foreground text-xs">{veh}</span>
                                  {tripCount > 1 ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setVehicleQuery(veh);
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition-colors cursor-pointer"
                                      title={`Vehicle ${veh} has come ${tripCount} times. Click to view all visits.`}
                                    >
                                      <Truck className="h-2.5 w-2.5" />
                                      {tripCount} Visits
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono bg-muted text-muted-foreground border border-border/40">
                                      1st Visit
                                    </span>
                                  )}
                                </div>
                                {tripCount > 1 && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    Trip #{tripSeq} of {tripCount}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-foreground font-medium truncate max-w-[140px]" title={party}>
                              {party}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[130px]" title={prod}>
                              {prod}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {gross.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {tare.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                              {net.toLocaleString()} kg
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              ₹{charge.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Badge
                                variant="outline"
                                className={`text-[10px] py-0 ${
                                  isCompleted
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                                    : isPending
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {isCompleted ? "Completed" : isPending ? "1st Done" : (r.Status || r.status || "Active")}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-primary hover:bg-primary/10 gap-1"
                                onClick={() => setSelectedSessionForModal(r)}
                              >
                                <Eye className="h-3 w-3" />
                                View Slip
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 2: VEHICLE FLEET & TRIP FREQUENCY REGISTER            */}
        {/* ========================================================= */}
        <TabsContent value="vehicleTrips">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Truck className="h-5 w-5 text-primary" />
                  Vehicle Fleet & Trip Frequency Register
                </CardTitle>
                <CardDescription>
                  Tracking frequency (how many times each vehicle has visited), cumulative net tonnage, and arrival timestamps ({vehicleTracking.list.length} unique vehicles)
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-xs text-primary border-primary/30">
                {vehicleTracking.repeatCount} Repeat Visitors
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground font-medium border-b">
                    <tr>
                      <th className="px-3 py-2.5">Vehicle Reg No</th>
                      <th className="px-3 py-2.5 text-center">Frequency (Times Visited)</th>
                      <th className="px-3 py-2.5 text-right">Total Net (MT)</th>
                      <th className="px-3 py-2.5 text-right">Total Net (kg)</th>
                      <th className="px-3 py-2.5 text-right">Avg Payload / Trip</th>
                      <th className="px-3 py-2.5">First Visit (DD-MM-YYYY HH:mm:ss)</th>
                      <th className="px-3 py-2.5">Latest Visit (DD-MM-YYYY HH:mm:ss)</th>
                      <th className="px-3 py-2.5">Associated Suppliers</th>
                      <th className="px-3 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {vehicleTracking.list.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                          <Truck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                          No vehicle visit records available for selected criteria.
                        </td>
                      </tr>
                    ) : (
                      vehicleTracking.list.map((v, idx) => (
                        <tr key={idx} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2.5 font-mono font-bold text-foreground">
                            {v.vehicleNo}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge
                              variant="outline"
                              className={`font-mono text-xs font-semibold px-2 py-0.5 ${
                                v.count >= 5
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/40"
                                  : v.count >= 2
                                  ? "bg-blue-500/10 text-blue-600 border-blue-500/40"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {v.count} {v.count === 1 ? "Trip" : "Trips"}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">
                            {v.netMT} MT
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                            {v.netKg.toLocaleString()} kg
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                            {v.avgPayloadKg.toLocaleString()} kg
                          </td>
                          <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap text-[11px]">
                            {formatReportDateTime(v.firstVisitTime)}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-muted-foreground whitespace-nowrap text-[11px]">
                            {formatReportDateTime(v.lastVisitTime)}
                          </td>
                          <td className="px-3 py-2.5 text-foreground truncate max-w-[180px]" title={v.partiesList.join(', ')}>
                            {v.partiesList.length > 0 ? v.partiesList.join(', ') : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-primary hover:bg-primary/10 gap-1"
                              onClick={() => {
                                setVehicleQuery(v.vehicleNo);
                                setCurrentTab("register");
                              }}
                            >
                              <Filter className="h-3 w-3" />
                              View Slips
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 3: SUPPLIER / PARTY LEDGER                            */}
        {/* ========================================================= */}
        <TabsContent value="partyLedger">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Supplier & Party Volume Ledger</CardTitle>
              <CardDescription>
                Aggregated weighment statistics grouped per vendor / party ({partyTotals.length} active suppliers)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground font-medium border-b">
                    <tr>
                      <th className="px-3 py-2.5">Supplier / Party Name</th>
                      <th className="px-3 py-2.5 text-center">Total Trips</th>
                      <th className="px-3 py-2.5 text-right">Total Net (MT)</th>
                      <th className="px-3 py-2.5 text-right">Total Net (kg)</th>
                      <th className="px-3 py-2.5 text-right">Total Fees (₹)</th>
                      <th className="px-3 py-2.5 text-right">Avg Load / Trip</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {partyTotals.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No supplier volume totals available for selected criteria.
                        </td>
                      </tr>
                    ) : (
                      partyTotals.map((pt, idx) => {
                        const netKg = Number(pt.totalNetWeight || pt.net_weight || 0);
                        const trips = Number(pt.totalTrips || pt.trips || 1);
                        const fees = Number(pt.totalCharges || pt.charges || 0);
                        const avgLoad = trips > 0 ? Math.round(netKg / trips) : 0;
                        return (
                          <tr key={idx} className="hover:bg-muted/30 transition-colors">
                            <td className="px-3 py-2.5 font-semibold text-foreground">
                              {pt.partyName || pt.party_name || "Unspecified Party"}
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono font-medium">
                              <Badge variant="outline" className="font-mono text-xs">
                                {trips} trips
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">
                              {(netKg / 1000).toFixed(2)} MT
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                              {netKg.toLocaleString()} kg
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-emerald-600 font-semibold">
                              ₹{fees.toLocaleString()}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                              {avgLoad.toLocaleString()} kg
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================= */}
        {/* TAB 4: COMMODITY & COTTON MIX BREAKDOWN                   */}
        {/* ========================================================= */}
        <TabsContent value="commodities">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Commodity Tonnage Share</CardTitle>
                <CardDescription>
                  Percentage distribution of commodities weighed in period
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {summary.commodityList.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No commodities logged in period</p>
                ) : (
                  summary.commodityList.map((item, idx) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground">{item.material}</span>
                        <span className="font-mono text-muted-foreground">
                          {item.netMT} MT ({item.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                        <span>{item.count} truck loads</span>
                        <span>{(item.netMT * 1000).toLocaleString()} kg net</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Commodity Breakdown Summary</CardTitle>
                <CardDescription>
                  Raw Cotton, Bales, and Cotton Seed totals
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/60 text-muted-foreground font-medium border-b">
                      <tr>
                        <th className="px-3 py-2">Commodity</th>
                        <th className="px-3 py-2 text-center">Loads</th>
                        <th className="px-3 py-2 text-right">Net MT</th>
                        <th className="px-3 py-2 text-right">Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {summary.commodityList.map((c, i) => (
                        <tr key={i} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium text-foreground">{c.material}</td>
                          <td className="px-3 py-2 text-center font-mono">{c.count}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{c.netMT} MT</td>
                          <td className="px-3 py-2 text-right font-mono text-primary">{c.percentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Slip Print / View Modal */}
      {selectedSlip && (
        <IndustrialWeighSlipModal
          isOpen={Boolean(selectedSlip)}
          onClose={() => setSelectedSessionForModal(null)}
          slip={selectedSlip}
        />
      )}
    </div>
  );
}