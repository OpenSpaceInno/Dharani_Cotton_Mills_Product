import React, { useState } from 'react';
import {
  Building2,
  Image as ImageIcon,
  KeyRound,
  Save,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  Globe,
  Phone,
  Mail,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/hooks/useAuth';
import { isAdminRole } from '@/types/auth';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { CompanySettings as CompanySettingsType } from '@/types/company';

export const CompanySettings: React.FC = () => {
  const { company, isLoading, updateCompany, setGlobalPrintImages, uploadLogo, refreshCompany } = useCompany();
  const { user, role } = useAuth();
  const isAdmin = isAdminRole(user, role);
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'profile' | 'branding' | 'security'>('profile');

  // Local form state
  const [formData, setFormData] = useState<CompanySettingsType>(company);
  const [logoInputUrl, setLogoInputUrl] = useState('');

  // Change password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);

  // Sync state if context company updates
  React.useEffect(() => {
    setFormData(company);
  }, [company]);

  const handleChange = <K extends keyof CompanySettingsType>(field: K, value: CompanySettingsType[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await updateCompany(formData);
  };

  // Logo file upload handler (converts file to optimized Base64 Data URL)
  const handleLogoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid File',
        description: 'Please select an image file (PNG, JPG, SVG, or WEBP).',
        variant: 'destructive',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const MAX_DIM = 1200;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(mime, 0.92);
          setFormData((prev) => ({ ...prev, logoUrl: dataUrl }));
          await uploadLogo(dataUrl);
        } else {
          const rawUrl = reader.result as string;
          setFormData((prev) => ({ ...prev, logoUrl: rawUrl }));
          await uploadLogo(rawUrl);
        }
      };
      img.onerror = async () => {
        const rawUrl = reader.result as string;
        setFormData((prev) => ({ ...prev, logoUrl: rawUrl }));
        await uploadLogo(rawUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Change password submit handler
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({
        title: 'Missing Fields',
        description: 'Please fill in all password fields.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: 'Password Too Short',
        description: 'New password must be at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: 'Passwords Do Not Match',
        description: 'New password and confirmation must match exactly.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsChangingPass(true);
      const res = await api.changePassword({
        userId: user?.id,
        currentPassword,
        newPassword,
      });

      if (res && res.success) {
        toast({
          title: 'Password Changed Successfully',
          description: 'Your login credentials have been securely updated.',
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: any) {
      toast({
        title: 'Password Change Failed',
        description: err.message || 'Incorrect current password or server error.',
        variant: 'destructive',
      });
    } finally {
      setIsChangingPass(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 rounded-xl border border-teal-200 dark:border-teal-800">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white">
                Company & System Settings
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                {formData.plantCode || 'PLANT_001'}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Configure company information, branding and logos for tickets, and account security.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshCompany()}
            disabled={isLoading}
            className="px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
          <button
            onClick={() => handleSaveProfile()}
            disabled={isLoading}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs rounded-lg shadow flex items-center gap-2 transition-transform active:scale-95"
          >
            <Save className="w-4 h-4" />
            <span>Save All Changes</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 rounded-t-xl gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('profile')}
          className={`py-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'profile'
              ? 'border-teal-600 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Company Profile</span>
        </button>

        <button
          onClick={() => setActiveTab('branding')}
          className={`py-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'branding'
              ? 'border-teal-600 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>Branding & Logo</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`py-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'security'
              ? 'border-teal-600 text-teal-600 dark:text-teal-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Change Password & Security</span>
        </button>
      </div>

      {/* TAB CONTENT PANELS */}
      <div className="bg-white dark:bg-slate-900 border border-t-0 border-slate-200 dark:border-slate-800 rounded-b-xl p-6 shadow-sm">
        {/* ========================================================= */}
        {/* TAB 1: COMPANY PROFILE */}
        {/* ========================================================= */}
        {activeTab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Organization & Plant */}
              <div className="space-y-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b pb-2 border-slate-200 dark:border-slate-800">
                  <Building2 className="w-4 h-4 text-teal-600" />
                  <span>Company Identity</span>
                </h3>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Full Legal Company Name *
                  </label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => handleChange('companyName', e.target.value)}
                    placeholder="e.g. Dharani Cotton Mills / Aparna RMC Ltd."
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Printed at the top of formal tax invoices, gate passes, and legal dockets.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Short / Firm Name (Weighbridge Header) *
                  </label>
                  <input
                    type="text"
                    value={formData.firmName}
                    onChange={(e) => handleChange('firmName', e.target.value)}
                    placeholder="e.g. Dharani Cotton Mills"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Appears directly in the Weighbridge form, indicator banner, and ticket header.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Plant / Unit Name
                    </label>
                    <input
                      type="text"
                      value={formData.plantName}
                      onChange={(e) => handleChange('plantName', e.target.value)}
                      placeholder="e.g. Main Batching Yard"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Plant Code
                    </label>
                    <input
                      type="text"
                      value={formData.plantCode}
                      onChange={(e) => handleChange('plantCode', e.target.value)}
                      placeholder="e.g. PLANT_001"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tagline / Operational Subtitle
                  </label>
                  <input
                    type="text"
                    value={formData.tagline}
                    onChange={(e) => handleChange('tagline', e.target.value)}
                    placeholder="e.g. Certified Electronic Weighbridge & Automated Dispatch"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                  />
                </div>

                {/* Global Admin Print Images Policy */}
                <div className="p-3.5 rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50/60 dark:bg-teal-950/20 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Print Camera Images on Weigh Slips (Global — All Roles)
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      When enabled or disabled by Admin, this automatically applies across every user role on Weighbridge & Print previews.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formData.weighbridgeDefaults?.printImages ?? true}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData((prev) => ({
                        ...prev,
                        weighbridgeDefaults: {
                          ...(prev.weighbridgeDefaults || company.weighbridgeDefaults),
                          printImages: checked,
                        },
                      }));
                      if (isAdmin) {
                        setGlobalPrintImages(checked);
                      }
                    }}
                    className="w-4 h-4 rounded text-teal-600 cursor-pointer disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Right Column: Physical Address & Contact */}
              <div className="space-y-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b pb-2 border-slate-200 dark:border-slate-800">
                  <MapPin className="w-4 h-4 text-teal-600" />
                  <span>Plant Location & Statutory Info</span>
                </h3>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Plant Street Address
                  </label>
                  <textarea
                    rows={2}
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    placeholder="Plot / Survey No., Industrial Area, Street"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      State
                    </label>
                    <input
                      type="text"
                      value={formData.state}
                      onChange={(e) => handleChange('state', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      PIN Code
                    </label>
                    <input
                      type="text"
                      value={formData.pincode}
                      onChange={(e) => handleChange('pincode', e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Official Phone
                    </label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => handleChange('phone', e.target.value)}
                      placeholder="+91 20 2712 8899"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Official Email
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      placeholder="weighbridge@dharanimills.com"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      GSTIN / Tax ID
                    </label>
                    <input
                      type="text"
                      value={formData.gstin}
                      onChange={(e) => handleChange('gstin', e.target.value.toUpperCase())}
                      placeholder="27AAAAA0000A1Z5"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-mono font-bold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Weighbridge License No
                    </label>
                    <input
                      type="text"
                      value={formData.weighbridgeLicense}
                      onChange={(e) => handleChange('weighbridgeLicense', e.target.value)}
                      placeholder="WB/2026/RMC-449"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-mono font-bold text-teal-600 dark:text-teal-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-lg shadow flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Save Profile Settings</span>
              </button>
            </div>
          </form>
        )}

        {/* ========================================================= */}
        {/* TAB 2: BRANDING & LOGO */}
        {/* ========================================================= */}
        {activeTab === 'branding' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
              {/* Left Column: Logo Uploader (5 cols) */}
              <div className="md:col-span-5 space-y-4">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-teal-600" />
                  <span>Upload Corporate Logo</span>
                </h3>
                <p className="text-xs text-slate-500">
                  This logo will dynamically render in the Weighbridge terminal ribbon, on printed weigh slips, invoices, and in the application sidebar.
                </p>

                {/* File Upload Drop Area */}
                <label className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-teal-500 dark:hover:border-teal-500 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer bg-slate-50 dark:bg-slate-950 transition-colors group">
                  <Upload className="w-8 h-8 text-slate-400 group-hover:text-teal-600 mb-2 transition-colors" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Click to browse or drop logo file
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">
                    Supports SVG, PNG, JPG, or WEBP (Max 2MB)
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoFileUpload}
                    className="hidden"
                  />
                </label>

                {/* Direct URL Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Or Enter Image URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="https://example.com/logo.png"
                      value={logoInputUrl}
                      onChange={(e) => setLogoInputUrl(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (logoInputUrl.trim()) {
                          setFormData((prev) => ({ ...prev, logoUrl: logoInputUrl }));
                          uploadLogo(logoInputUrl);
                          setLogoInputUrl('');
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Previews (7 cols) */}
              <div className="md:col-span-7 space-y-5">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>Live Dynamic Previews</span>
                </h3>

                {/* Preview 1: Weighbridge Screen Header */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    Weighbridge Terminal Banner Preview
                  </span>
                  <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-2.5 rounded-md flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                      {formData.logoUrl ? (
                        <img
                          src={formData.logoUrl}
                          alt="Logo"
                          className="h-9 w-auto max-w-[130px] object-contain rounded"
                        />
                      ) : (
                        <div className="h-9 w-9 bg-teal-600 text-white font-bold flex items-center justify-center rounded text-xs">
                          RMC
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-black text-slate-900 dark:text-white uppercase font-mono">
                          {formData.firmName || formData.companyName}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {formData.tagline || 'Electronic Weighbridge Terminal'}
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-900 px-3 py-1 rounded text-cyan-400 font-mono font-black text-lg">
                      024580 <span className="text-xs text-cyan-500">KG</span>
                    </div>
                  </div>
                </div>

                {/* Preview 2: Electronic Weigh Slip Printed Docket Preview */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    Printed Weigh Slip Docket Header Preview
                  </span>
                  <div className="bg-white text-slate-900 border border-slate-300 p-4 rounded-md shadow-sm font-sans text-center">
                    <div className="flex items-center justify-center gap-3 mb-2">
                      {formData.logoUrl && (
                        <img
                          src={formData.logoUrl}
                          alt="Docket Logo"
                          className="h-10 w-auto max-w-[140px] object-contain"
                        />
                      )}
                      <div>
                        <h4 className="text-sm font-black uppercase text-slate-900 tracking-wider">
                          {formData.firmName || formData.companyName}
                        </h4>
                        <p className="text-[10px] text-slate-600">
                          {formData.address}, {formData.city} - {formData.pincode}
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-b border-slate-300 py-1 flex justify-between text-[10px] font-mono text-slate-600">
                      <span>GSTIN: <strong>{formData.gstin}</strong></span>
                      <span>License: <strong>{formData.weighbridgeLicense}</strong></span>
                      <span>Scale: <strong>{formData.scaleModel}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Preview 3: Application Sidebar Preview */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3 bg-slate-50 dark:bg-slate-950">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    Sidebar Brand Card Preview
                  </span>
                  <div className="w-64 bg-slate-900 text-white p-3 rounded-lg flex items-center gap-3">
                    {formData.logoUrl ? (
                      <img
                        src={formData.logoUrl}
                        alt="Sidebar Logo"
                        className="h-8 w-auto max-w-[80px] object-contain"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded bg-teal-600 flex items-center justify-center font-bold text-xs">
                        RMC
                      </div>
                    )}
                    <div className="overflow-hidden">
                      <div className="text-xs font-bold truncate">
                        {formData.firmName}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {formData.plantName}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: CHANGE PASSWORD & USER SECURITY */}
        {/* ========================================================= */}
        {activeTab === 'security' && (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Current User Card */}
            <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-teal-600 text-white font-black text-lg flex items-center justify-center">
                  {user?.name?.charAt(0) || 'U'}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                    {user?.name || 'Current User'}
                  </h4>
                  <p className="text-xs text-slate-500 font-mono">
                    {user?.email || 'user@rmc.com'} · User ID: {user?.id}
                  </p>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                    Active Role: {role?.name || user?.roleName || 'Operator'}
                  </span>
                </div>
              </div>

              <div className="text-right text-xs text-slate-400 font-mono hidden sm:block">
                <div>Session Active</div>
                <div className="text-emerald-500 font-semibold flex items-center gap-1 justify-end">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Authenticated
                </div>
              </div>
            </div>

            {/* Change Password Form */}
            <form onSubmit={handleChangePassword} className="space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-xl shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                <KeyRound className="w-5 h-5 text-teal-600" />
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    Change Password
                  </h3>
                  <p className="text-xs text-slate-500">
                    Update your account credentials to keep plant operations secure.
                  </p>
                </div>
              </div>

              {/* Current Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Current Password *
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter existing password"
                    className="w-full pl-3 pr-10 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  New Password * (Min 6 characters)
                </label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter secure new password"
                    className="w-full pl-3 pr-10 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass(!showNewPass)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Confirm New Password *
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full pl-3 pr-10 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass(!showConfirmPass)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password Quality Checklist */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-1 text-slate-500">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                  <span>Security Recommendations:</span>
                </div>
                <div className={newPassword.length >= 6 ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                  • Minimum 6 characters ({newPassword.length}/6 entered)
                </div>
                <div className={/[0-9]/.test(newPassword) ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                  • Contains numeric digits
                </div>
                <div className={newPassword && newPassword === confirmPassword ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                  • Passwords match
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isChangingPass}
                  className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-lg shadow flex items-center justify-center gap-2 transition-transform active:scale-95"
                >
                  {isChangingPass ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <KeyRound className="w-4 h-4" />
                  )}
                  <span>Update Password</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanySettings;

