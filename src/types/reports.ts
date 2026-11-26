export interface ReportFieldConfig {
  sNo: number;
  fieldKey: string;
  fieldName: string;
  isSelected: boolean;
  displayOrder: number;
}

export interface ReportFilterParams {
  dateFrom?: string;
  dateTo?: string;
  partyName?: string;
  material?: string;
  status?: string;
  vehicleNo?: string;
  user?: string;
}

export interface WeighmentReportTransaction {
  session_id?: string;
  transaction_no: number;
  vehicle_reg_no: string;
  party_name: string;
  material: string;
  first_weight: number;
  second_weight?: number;
  net_weight?: number;
  charges?: number;
  status: string;
  operator_name?: string;
  created_at: string;
  updated_at?: string;
  [key: string]: any;
}

export interface PartyTotalsResponse {
  partyTotals: Array<{
    partyName: string;
    totalTrips: number;
    totalNetWeight: number;
    totalCharges: number;
    materials: string[];
    lastWeighed: string;
  }>;
  grandTotals: {
    totalTrips: number;
    totalNetWeight: number;
    totalCharges: number;
  };
}
