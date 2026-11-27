// API client for MySQL backend
const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // In browser environments (both local Vite dev proxy and production Nginx/Traefik reverse proxy)
  if (typeof window !== 'undefined' && window.location) {
    return '/api';
  }
  return 'http://localhost:3001/api';
};

const API_BASE_URL = getApiBaseUrl();

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const token = typeof window !== 'undefined' ? localStorage.getItem('rmc_auth_token') : null;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }


  // Authentication & RBAC (MySQL API)
  async login(credentials: { username: string; password: string }) {
    return this.request<{ success: boolean; token: string; user: any; role: any; message?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }

  async getMe() {
    return this.request<{ user: any; role: any }>('/auth/me');
  }

  async logout() {
    return this.request<{ success: boolean; message: string }>('/auth/logout', {
      method: 'POST',
    });
  }

  async getUsers() {
    return this.request<any[]>('/auth/users');
  }

  async createUser(data: any) {
    return this.request<{ success: boolean; id: string; message: string }>('/auth/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: string, data: any) {
    return this.request<{ success: boolean; message: string }>('/auth/users/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string) {
    return this.request<{ success: boolean; message: string }>('/auth/users/' + id, {
      method: 'DELETE',
    });
  }

  async getRoles() {
    return this.request<any[]>('/auth/roles');
  }

  async createRole(data: any) {
    return this.request<{ success: boolean; id: string; message: string }>('/auth/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateRole(id: string, data: any) {
    const res = await this.request<{ success: boolean; message: string }>('/auth/roles/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('rmc_auth_refresh'));
    }
    return res;
  }

  async deleteRole(id: string) {
    const res = await this.request<{ success: boolean; message: string }>('/auth/roles/' + id, {
      method: 'DELETE',
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('rmc_auth_refresh'));
    }
    return res;
  }

  // Health check
  async healthCheck() {
    return this.request<{ status: string; message: string }>('/health');
  }

  // Database initialization
  async initDatabase() {
    return this.request<{ success: boolean; message: string }>('/init-db', {
      method: 'POST',
    });
  }

  async checkDatabaseStatus() {
    return this.request<{ initialized: boolean; tables: string[]; message: string }>('/db-status');
  }

  // Camera devices
  async getCameras() {
    return this.request<any[]>('/cameras');
  }

  async getCamera(deviceId: string) {
    return this.request<any>(`/cameras/${deviceId}`);
  }

  async createCamera(data: any) {
    return this.request<{ success: boolean; device_id: string }>('/cameras', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCamera(deviceId: string, data: any) {
    return this.request<{ success: boolean }>(`/cameras/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCamera(deviceId: string) {
    return this.request<{ success: boolean }>(`/cameras/${deviceId}`, {
      method: 'DELETE',
    });
  }

  async checkCameraDiagnostic(ip: string) {
    return this.request<{
      ip: string;
      reachable: boolean;
      ports: { '554': boolean; '80': boolean; '8000': boolean };
      status: string;
      message: string;
    }>(`/cameras/diagnostic/${ip}`);
  }

  async testRtspStream(payload: { ip: string; port?: number; username?: string; password?: string; stream_path?: string }) {
    return this.request<{
      success: boolean;
      status: 'online' | 'unauthorized' | 'not_found' | 'timeout' | 'error' | 'responded';
      statusCode?: number;
      message: string;
    }>('/cameras/test-rtsp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async autoDetectCameraStream(payload: { device_id?: string; ip: string; username?: string; password?: string; auto_apply?: boolean }) {
    return this.request<{
      success: boolean;
      match: any;
      matched_path: string;
      matched_port: number;
      direct_url: string;
      hls_proxy_url: string;
      applied: boolean;
      message: string;
    }>('/cameras/auto-detect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getStreamGatewayStatus() {
    return this.request<{
      gateway_port: number;
      api_online: boolean;
      paths: any[];
      recent_logs: string;
    }>('/cameras/stream-status');
  }

  // RTSP configuration
  async getRTSPConfig(deviceId: string) {
    return this.request<any>(`/rtsp-config/${deviceId}`);
  }

  async saveRTSPConfig(data: any) {
    return this.request<{ success: boolean }>('/rtsp-config', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Network configuration
  async getNetworkConfig(deviceId: string) {
    return this.request<any>(`/network-config/${deviceId}`);
  }

  async saveNetworkConfig(data: any) {
    return this.request<{ success: boolean }>('/network-config', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ==================== WEIGHBRIDGE INDICATOR DEVICES ====================
  async getWeighbridgeDevices() {
    return this.request<any[]>('/weighbridge-devices');
  }

  async createWeighbridgeDevice(data: any) {
    return this.request<{ success: boolean; id: string }>('/weighbridge-devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWeighbridgeDevice(id: string, data: any) {
    return this.request<{ success: boolean }>(`/weighbridge-devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteWeighbridgeDevice(id: string) {
    return this.request<{ success: boolean }>(`/weighbridge-devices/${id}`, {
      method: 'DELETE',
    });
  }

  async activateWeighbridgeDevice(id: string) {
    return this.request<{ success: boolean; message: string }>(`/weighbridge-devices/${id}/activate`, {
      method: 'POST',
    });
  }

  // ==================== PRINTER DEVICES ====================
  async getPrinters() {
    return this.request<any[]>('/printers');
  }

  async createPrinter(data: any) {
    return this.request<{ success: boolean; id: string }>('/printers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePrinter(id: string, data: any) {
    return this.request<{ success: boolean }>(`/printers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePrinter(id: string) {
    return this.request<{ success: boolean }>(`/printers/${id}`, {
      method: 'DELETE',
    });
  }

  async setDefaultPrinter(id: string) {
    return this.request<{ success: boolean }>(`/printers/${id}/default`, {
      method: 'POST',
    });
  }

  async testPrinter(id: string) {
    return this.request<{ success: boolean; message: string }>(`/printers/${id}/test`, {
      method: 'POST',
    });
  }

  // ==================== FTP SERVER CONFIGS ====================
  async getFtpConfigs() {
    return this.request<any[]>('/ftp-configs');
  }

  async createFtpConfig(data: any) {
    return this.request<{ success: boolean; id: string }>('/ftp-configs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFtpConfig(id: string, data: any) {
    return this.request<{ success: boolean }>(`/ftp-configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteFtpConfig(id: string) {
    return this.request<{ success: boolean }>(`/ftp-configs/${id}`, {
      method: 'DELETE',
    });
  }

  async activateFtpConfig(id: string) {
    return this.request<{ success: boolean; message: string }>(`/ftp-configs/${id}/activate`, {
      method: 'POST',
    });
  }

  async testFtpProfile(data: any) {
    return this.request<{ success: boolean; message?: string; error?: string }>('/ftp-configs/test', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ANPR endpoints
  async getANPREvents(params?: { status?: string; limit?: number; offset?: number }) {
    const queryString = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return this.request<any[]>(`/anpr/events${queryString}`);
  }

  async getANPREvent(eventId: string) {
    return this.request<any>(`/anpr/events/${eventId}`);
  }

  async createANPREvent(event: any) {
    return this.request<{ success: boolean; event_id: string }>('/anpr/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async updateANPREvent(eventId: string, updates: any) {
    return this.request<{ success: boolean }>(`/anpr/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async detectPlate(formData: FormData) {
    const url = `${this.baseUrl}/anpr/detect`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Detection failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getANPRConfig(cameraId: string) {
    return this.request<any>(`/anpr/config/${cameraId}`);
  }

  async updateANPRConfig(cameraId: string, config: any) {
    return this.request<{ success: boolean }>(`/anpr/config/${cameraId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
  // Vehicles (MySQL API)
  async getVehicles(status?: string) {
    const query = status && status !== 'all' ? '?status=' + encodeURIComponent(status) : '';
    return this.request<any[]>('/vehicles' + query);
  }

  async getVehicle(id: string) {
    return this.request<any>('/vehicles/' + id);
  }

  async createVehicle(data: any) {
    return this.request<{ success: boolean; id: string; message: string }>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateVehicle(id: string, data: any) {
    return this.request<{ success: boolean; message: string }>('/vehicles/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteVehicle(id: string) {
    return this.request<{ success: boolean; message: string }>('/vehicles/' + id, {
      method: 'DELETE',
    });
  }

  // Drivers (MySQL API)
  async getDrivers(status?: string) {
    const query = status && status !== 'all' ? '?status=' + encodeURIComponent(status) : '';
    return this.request<any[]>('/drivers' + query);
  }

  async getDriver(id: string) {
    return this.request<any>('/drivers/' + id);
  }

  async createDriver(data: any) {
    return this.request<{ success: boolean; id: string; message: string }>('/drivers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDriver(id: string, data: any) {
    return this.request<{ success: boolean; message: string }>('/drivers/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDriver(id: string) {
    return this.request<{ success: boolean; message: string }>('/drivers/' + id, {
      method: 'DELETE',
    });
  }


  // Dashboard
  async getDashboardSummary() {
    return this.request<any>('/dashboard/summary');
  }

  // Weighbridge (Phase 2 MySQL API)
  async getWeighbridgeSessions(status?: string) {
    const query = status && status !== 'all' ? '?status=' + encodeURIComponent(status) : '';
    return this.request<any[]>('/weighbridge/sessions' + query);
  }

  async getWeighbridgeSession(id: string) {
    return this.request<any>('/weighbridge/sessions/' + id);
  }

  async createWeighbridgeSession(data: any) {
    return this.request<{ success: boolean; sessionId: string; message: string }>('/weighbridge/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWeighbridgeSession(id: string, data: any) {
    return this.request<{ success: boolean; message: string }>('/weighbridge/sessions/' + id, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getWeighSlips() {
    return this.request<any[]>('/weighbridge/slips');
  }

  async createWeighSlip(data: any) {
    return this.request<{ success: boolean; slipNumber: string; message: string }>('/weighbridge/slips', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getNextTransactionNo() {
    return this.request<{ nextTransactionNo: number }>('/weighbridge/next-transaction-no');
  }

  async getPendingVehicles() {
    return this.request<any[]>('/weighbridge/pending-vehicles');
  }

  async getPendingVehicleByNo(vehicleNo: string) {
    return this.request<{ success: boolean; session?: any; message?: string }>(
      `/weighbridge/pending-vehicle/${encodeURIComponent(vehicleNo)}`
    );
  }

  async getSavedParties() {
    return this.request<any[]>('/weighbridge/parties');
  }

  async getPartyDetails(partyName: string) {
    return this.request<{ success: boolean; party: any }>(
      `/weighbridge/party-details/${encodeURIComponent(partyName)}`
    );
  }

  async uploadWeighbridgeSnapshots(data: {
    transactionNo?: number;
    vehicleRegNo?: string;
    weight?: number;
    images: Array<{
      camId: string;
      camName?: string;
      angle?: 'front' | 'side' | 'rear' | 'top' | 'load';
      dataUrl: string;
    }>;
  }) {
    return this.request<{
      success: boolean;
      message: string;
      snapshots: Array<{
        id: string;
        type: 'image';
        url: string;
        angle: 'front' | 'side' | 'rear';
        camId: string;
        camName: string;
        timestamp: string;
        fileName: string;
        ftpStatus?: any;
      }>;
      ftpSummary?: any;
    }>('/weighbridge/snapshots/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Third-Party & Ventek Weighbridge Integration
  async getLiveScaleWeight() {
    return this.request<{
      weight: number;
      weightQtl?: number;
      unit: 'kg' | 'ton';
      stable: boolean;
      zero: boolean;
      timestamp: string;
      source: string;
      connected: boolean;
      serialConnected?: boolean;
      serialPort?: string;
      baudRate?: number;
      deviceCode?: string;
      deviceName?: string;
      model?: string;
      unitType?: string;
      capacityKg?: number;
    }>('/weighbridge/live-weight');
  }

  async pushThirdPartyWeight(data: { weight?: number; weightQtl?: number; unit?: 'kg' | 'ton'; stable?: boolean; source?: string }) {
    return this.request<{ success: boolean; message: string; reading: any }>('/weighbridge/third-party/push', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async zeroScale() {
    return this.request<{ success: boolean; message: string; reading: any }>('/weighbridge/third-party/zero', {
      method: 'POST',
    });
  }

  async simulateScaleWeight(data: { weight?: number; weightQtl?: number; stable?: boolean }) {
    return this.request<{ success: boolean; message: string; reading: any }>('/weighbridge/third-party/simulate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async testScaleSource(data: { mode: string; filePath?: string; tcpHost?: string; tcpPort?: number }) {
    return this.request<{ success: boolean; message: string; exists?: boolean; sampleContent?: string; error?: string }>('/weighbridge/third-party/test-source', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWeighbridgeDeviceConfig() {
    return this.request<{
      success: boolean;
      device: import('../types/weighbridge').WeighbridgeDeviceConfig;
      status: {
        connected: boolean;
        lastError: string | null;
        lastReadingTime: string | null;
        lastRawPacket: string;
        currentWeightKg: number;
        currentWeightQtl: number;
      };
    }>('/weighbridge/device/config');
  }

  async updateWeighbridgeDeviceConfig(data: Partial<import('../types/weighbridge').WeighbridgeDeviceConfig>) {
    return this.request<{
      success: boolean;
      message: string;
      config: import('../types/weighbridge').WeighbridgeDeviceConfig;
      connected: boolean;
    }>('/weighbridge/device/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getSerialPorts() {
    return this.request<{
      success: boolean;
      ports: Array<{
        path: string;
        manufacturer: string;
        friendlyName: string;
        pnpId?: string;
        productId?: string;
        vendorId?: string;
      }>;
      activePort: string;
    }>('/weighbridge/ports');
  }

  async testWeighbridgeDevice(data: { port: string; baudRate?: number }) {
    return this.request<{
      success: boolean;
      port: string;
      baudRate: number;
      availableOnSystem: boolean;
      allPorts: string[];
      message: string;
      currentConnected: boolean;
      lastError: string | null;
    }>('/weighbridge/device/test', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Audit Logs (Phase 4 MySQL API)
  async getAuditLogs(params?: { module?: string; severity?: string; limit?: number }) {
    const q = params ? '?' + new URLSearchParams(params as any).toString() : '';
    return this.request<any[]>('/audit-logs' + q);
  }

  async createAuditLog(data: any) {
    return this.request<{ success: boolean; id: string; message: string }>('/audit-logs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Company Settings & Branding API
  async getCompanySettings() {
    return this.request<any>('/company-settings');
  }

  async updateCompanySettings(data: any) {
    return this.request<{ success: boolean; settings: any; message: string }>('/company-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadCompanyLogo(logoUrl: string) {
    return this.request<{ success: boolean; logoUrl: string; message: string }>('/company-settings/logo', {
      method: 'POST',
      body: JSON.stringify({ logoUrl }),
    });
  }

  async changePassword(data: { userId?: string; currentPassword: string; newPassword: string }) {
    return this.request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async testFtpConnection(data: {
    host: string;
    port?: number;
    user?: string;
    password?: string;
    secure?: boolean;
    remoteDir?: string;
  }) {
    return this.request<{ success: boolean; message: string; error?: string }>('/company-settings/test-ftp', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Reports Module (47-Field Registry, Dynamic Filtering & Print)
  async getReportFields(userId: string = 'default', reportType: string = 'weighment_report') {
    return this.request<Array<{ sNo: number; fieldKey: string; fieldName: string; isSelected: boolean; displayOrder: number }>>(
      `/reports/fields?userId=${encodeURIComponent(userId)}&reportType=${encodeURIComponent(reportType)}`
    );
  }

  async saveReportFields(
    fields: Array<{ sNo?: number; fieldKey: string; fieldName?: string; isSelected: boolean; displayOrder?: number }>,
    userId: string = 'default',
    reportType: string = 'weighment_report'
  ) {
    return this.request<{ success: boolean; message: string }>('/reports/fields/config', {
      method: 'POST',
      body: JSON.stringify({ userId, reportType, fields }),
    });
  }

  async getReportFilterOptions() {
    return this.request<{ parties: string[]; products: string[]; statuses: string[]; users: string[] }>('/reports/filter-options');
  }

  async searchReports(params: Record<string, any> = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    return this.request<{ success: boolean; count: number; data: any[] }>(`/reports/search?${query.toString()}`);
  }

  async getPartyTotals(params: Record<string, any> = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    return this.request<{ success: boolean; partyTotals: any[]; grandTotals: any }>(`/reports/party-totals?${query.toString()}`);
  }

  async getVehicleStats(params: Record<string, any> = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        query.append(k, String(v));
      }
    });
    return this.request<{ success: boolean; count: number; vehicleStats: any[] }>(`/reports/vehicle-stats?${query.toString()}`);
  }

  async getFilterOptions() {
    return this.request<{
      parties: string[];
      products: string[];
      statuses: string[];
      users: string[];
    }>('/reports/filter-options');
  }

  async getReportTransactionForPrint(id: string | number) {
    return this.request<{
      success: boolean;
      transaction: any;
      rawSession: any;
      fieldConfigs: Array<{ sNo: number; fieldKey: string; fieldName: string; isSelected: boolean; displayOrder: number }>;
      company: any;
    }>(`/reports/transaction/${id}`);
  }

  // Gate Monitor <-> Weighbridge Vehicle Synchronization
  async getLatestGateVehicle() {
    return this.request<{
      success: boolean;
      vehicleRegNo?: string;
      confidence?: number;
      source?: string;
      timestamp?: string;
      cameraId?: string;
      matchedVehicle?: {
        make?: string;
        model?: string;
        driverName?: string;
        partyName?: string;
        product?: string;
      };
      message?: string;
    }>('/gate/latest-vehicle');
  }

  async postLatestGateVehicle(data: { vehicleRegNo: string; confidence?: number; source?: string; cameraId?: string; imageUrl?: string }) {
    return this.request<{ success: boolean; vehicleRegNo: string; message: string }>('/gate/latest-vehicle', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getRecentGateVehicles() {
    return this.request<{
      success: boolean;
      count: number;
      vehicles: Array<{
        id: number;
        vehicleRegNo: string;
        confidence: number;
        source: string;
        timestamp: string;
        partyName?: string;
        product?: string;
        driverName?: string;
      }>;
    }>('/gate/recent-vehicles');
  }

  async clearGateVehicle() {
    return this.request<{ success: boolean; message: string }>('/gate/clear-vehicle', {
      method: 'POST',
    });
  }

  async getFtpStatus() {
    return this.request<{
      success: boolean;
      running: boolean;
      host: string;
      port: number;
      remoteDir: string;
      totalFilesSeen: number;
      processedCount: number;
      lastPollTime: string | null;
      lastError: string | null;
      latestDetection: any;
    }>('/gate/ftp-status');
  }

  async syncFtpNow(loadLatestExisting = false) {
    return this.request<{
      success: boolean;
      detection: any;
    }>('/gate/ftp-sync-now', {
      method: 'POST',
      body: JSON.stringify({ loadLatestExisting }),
    });
  }

  // ==================== DATABASE SYNCHRONIZATION MONITORING ====================
  async getSyncStatus() {
    return this.request<{
      success: boolean;
      enabled: boolean;
      schedulerActive: boolean;
      mode: string;
      sourceDatabase: string;
      targetDatabase: string;
      plantId: string;
      intervalMs: number;
      intervalMinutes: number;
      isCurrentlySyncing: boolean;
      lastSyncId: string | null;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      nextScheduledAt: string | null;
      status: string;
      channel: string;
      lastCycle: any;
      totals: { inserted: number; updated: number; deleted: number; failed: number };
      recentErrors: string[];
      tables: any[];
      recentLogs: any[];
      eligibleTables: any[];
      excludedTables: Array<{ table: string; reason: string }>;
    }>('/sync/status');
  }

  async getSyncLogs(limit: number = 30) {
    return this.request<{ success: boolean; count: number; logs: any[] }>(`/sync/logs?limit=${encodeURIComponent(limit)}`);
  }

  async triggerManualSync() {
    return this.request<{ success: boolean; message: string; report: any }>('/sync/trigger', {
      method: 'POST',
    });
  }

}

export const api = new ApiClient(API_BASE_URL);

export const apiClient = api;
