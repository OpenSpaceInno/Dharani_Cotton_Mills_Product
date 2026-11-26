import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { CompanySettings } from '@/types/company';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

const STORAGE_KEY_COMPANY = 'rmc_company_settings';

const defaultCompany: CompanySettings = {
  id: 'default_company',
  companyName: 'Dharani Cotton Mills',
  firmName: 'Dharani Cotton Mills',
  plantName: 'Plant 1 - Main Yard',
  plantCode: 'PLANT_001',
  tagline: 'Certified Electronic Weighbridge & Industrial Cotton Management',
  logoUrl: '/logo.png',
  address: 'Vikarabad',
  city: 'Hyderabad',
  state: 'Telangana',
  pincode: '500033',
  phone: '+91 20 2712 8899',
  email: 'weighbridge@dharani.com',
  website: 'https://www.dharani.com',
  gstin: '27AAAAA0000A1Z5',
  weighbridgeLicense: 'WB/2026/RMC-449',
  scaleModel: 'VENTEK VMS-WB',
  scaleCapacity: '50,000 kg (50 MT)',
  scaleDivision: '10 kg',
  currency: '₹',
  weighbridgeDefaults: {
    defaultRate: 7520,
    defaultMoisture: 8,
    defaultDeduction: 50,
    defaultCharges: 250,
    printDuplicate: false,
    printQrCode: true,
    printImages: true,
    autoWeighInterval: 600,
    minTareWeight: 5000,
    maxGrossWeight: 60000,
    ftp: {
      enabled: false,
      host: '192.168.0.15',
      port: 21,
      user: 'weighbridge',
      password: '',
      secure: false,
      remoteDir: '/snapshots',
    },
    thirdPartyScale: {
      enabled: true,
      mode: 'file_monitor',
      protocol: 'standard_ascii',
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      filePath: 'C:\\Weighbridge\\live_weight.txt',
      tcpHost: '127.0.0.1',
      tcpPort: 4001,
      pollIntervalMs: 500,
    },
  },
  invoiceTerms: '1. Payment due within 15 days of invoice date. 2. Interest @ 18% p.a. charged on overdue bills. 3. Subject to Pune jurisdiction.',
  weighSlipNotes: 'Computer generated electronic ticket.',
};

interface CompanyContextType {
  company: CompanySettings;
  isLoading: boolean;
  updateCompany: (data: Partial<CompanySettings>) => Promise<boolean>;
  setGlobalPrintImages: (enabled: boolean) => Promise<boolean>;
  uploadLogo: (logoUrl: string) => Promise<boolean>;
  refreshCompany: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toast } = useToast();
  const [company, setCompany] = useState<CompanySettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_COMPANY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.companyName) return parsed;
      }
    } catch (e) {}
    return defaultCompany;
  });

  const [isLoading, setIsLoading] = useState(false);

  const fetchLatestCompany = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setIsLoading(true);
      const res = await api.getCompanySettings();
      if (res && res.companyName) {
        setCompany(res);
        try {
          localStorage.setItem(STORAGE_KEY_COMPANY, JSON.stringify(res));
        } catch (e) {}
      }
    } catch (err) {
      if (showSpinner) {
        console.warn('Failed to fetch company settings from server, using cached:', err);
      }
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }, []);

  const refreshCompany = useCallback(async () => {
    await fetchLatestCompany(true);
  }, [fetchLatestCompany]);

  useEffect(() => {
    fetchLatestCompany(true);

    // Silently keep global Admin settings (e.g. Print Images) synchronized across all logged-in roles
    const timer = setInterval(() => {
      fetchLatestCompany(false);
    }, 10000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchLatestCompany(false);
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [fetchLatestCompany]);

  const updateCompany = async (data: Partial<CompanySettings>): Promise<boolean> => {
    try {
      setIsLoading(true);
      const res = await api.updateCompanySettings(data);
      if (res && res.settings) {
        setCompany(res.settings);
        try {
          localStorage.setItem(STORAGE_KEY_COMPANY, JSON.stringify(res.settings));
        } catch (e) {}
        toast({
          title: 'Settings Saved',
          description: 'Company information and module configurations updated successfully.',
        });
        return true;
      }
      return false;
    } catch (err: any) {
      toast({
        title: 'Save Failed',
        description: err.message || 'Could not save company settings.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const setGlobalPrintImages = async (enabled: boolean): Promise<boolean> => {
    try {
      const mergedDefaults = {
        ...(company.weighbridgeDefaults || defaultCompany.weighbridgeDefaults),
        printImages: enabled,
      };
      const res = await api.updateCompanySettings({ weighbridgeDefaults: mergedDefaults });
      if (res && res.settings) {
        setCompany(res.settings);
        try {
          localStorage.setItem(STORAGE_KEY_COMPANY, JSON.stringify(res.settings));
        } catch (e) {}
        toast({
          title: enabled ? 'Print Images Enabled (All Roles)' : 'Print Images Disabled (All Roles)',
          description: `Camera snapshots on weigh slips are now ${enabled ? 'enabled' : 'disabled'} across all user roles.`,
        });
        return true;
      }
      return false;
    } catch (err: any) {
      toast({
        title: 'Update Failed',
        description: err.message || 'Could not update global Print Images setting.',
        variant: 'destructive',
      });
      return false;
    }
  };

  const uploadLogo = async (logoUrl: string): Promise<boolean> => {
    try {
      const res = await api.uploadCompanyLogo(logoUrl);
      if (res && res.success) {
        setCompany((prev) => {
          const updated = { ...prev, logoUrl };
          try {
            localStorage.setItem(STORAGE_KEY_COMPANY, JSON.stringify(updated));
          } catch (e) {}
          return updated;
        });
        toast({
          title: 'Logo Updated',
          description: 'Company logo has been updated across all modules.',
        });
        return true;
      }
      return false;
    } catch (err: any) {
      toast({
        title: 'Logo Upload Failed',
        description: err.message || 'Could not update logo.',
        variant: 'destructive',
      });
      return false;
    }
  };

  return (
    <CompanyContext.Provider
      value={{
        company,
        isLoading,
        updateCompany,
        setGlobalPrintImages,
        uploadLogo,
        refreshCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
};

