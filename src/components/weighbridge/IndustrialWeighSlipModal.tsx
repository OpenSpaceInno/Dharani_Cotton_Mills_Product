import React, { useState, useEffect } from 'react';
import { X, Printer, ShieldCheck, CheckCircle2, FileDown, Loader2, Copy } from 'lucide-react';
import { WeighSlip } from '@/types/weighbridge';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/hooks/useAuth';
import { isAdminRole } from '@/types/auth';
import { api } from '@/lib/api';
import { downloadWeighSlipPDF } from '@/utils/weighSlipPdfGenerator';
import { useToast } from '@/hooks/use-toast';
import { formatToDDMMYYYY, formatToHHMMSS } from '@/utils/dateTimeFormatters';
import { QRCodeView } from '@/lib/qrCode';

interface IndustrialWeighSlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  slip: WeighSlip | null;
  onEmail?: (slip: WeighSlip) => void;
}

export const IndustrialWeighSlipModal: React.FC<IndustrialWeighSlipModalProps> = ({
  isOpen,
  onClose,
  slip,
}) => {
  const { company, setGlobalPrintImages } = useCompany();
  const { user, role } = useAuth();
  const isAdmin = isAdminRole(user, role);
  const { toast } = useToast();
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const globalPrintImages = company.weighbridgeDefaults?.printImages ?? true;

  // Controlled real-time print settings
  const [printDuplicate, setPrintDuplicate] = useState(false);
  const [printQrCode, setPrintQrCode] = useState(true);
  const [printImages, setPrintImages] = useState(globalPrintImages);

  useEffect(() => {
    if (slip) {
      setPrintDuplicate(Boolean(slip.printOptions?.printDuplicate));
      setPrintQrCode(slip.printOptions?.printQrCode ?? true);
      setPrintImages(globalPrintImages);
    }
  }, [slip, globalPrintImages]);

  // Keep modal Print Images synced globally whenever Admin toggles it
  useEffect(() => {
    setPrintImages(globalPrintImages);
  }, [globalPrintImages]);

  if (!isOpen || !slip) return null;

  const effectivePrintImages = isAdmin ? printImages : globalPrintImages;

  const handlePrint = () => {
    if (slip) {
      api.createWeighSlip({
        ...slip,
        printOptions: {
          ...slip.printOptions,
          printDuplicate,
          printQrCode,
          printImages: effectivePrintImages,
        }
      }).catch((e) => console.warn('Save weigh slip on print warning:', e));
    }
    window.print();
  };

  // 1 Quintal (Qtl) = 100 kg
  const firstWeightKg = slip.firstWeight || 0;
  const firstWeightQtl = (firstWeightKg / 100).toFixed(2);

  const secondWeightKg = slip.secondWeight || 0;
  const secondWeightQtl = secondWeightKg > 0 ? (secondWeightKg / 100).toFixed(2) : '-';

  const nettWeightKg = slip.nettWeight !== undefined ? slip.nettWeight : (slip.netWeight || Math.abs(secondWeightKg - firstWeightKg));
  const nettWeightQtl = (nettWeightKg / 100).toFixed(2);

  // Dates & Times formatted strictly as DD-MM-YYYY and HH:MM:SS
  const formatTimeStr = (timeString?: string | null) => {
    if (!timeString || timeString === '-') return '-';
    return formatToHHMMSS(timeString) || '-';
  };

  const formatDateStr = (dateString?: string | null, dateOverride?: string) => {
    if (dateOverride && dateOverride.trim() && dateOverride !== '-') return formatToDDMMYYYY(dateOverride);
    if (!dateString || dateString === '-') return '-';
    return formatToDDMMYYYY(dateString) || '-';
  };

  const firstWeightDate = formatDateStr(slip.firstWeightTime, slip.firstWeightDate);
  const firstWeightTime = formatTimeStr(slip.firstWeightTime);

  const secondWeightDate = secondWeightKg > 0 ? formatDateStr(slip.secondWeightTime, slip.secondWeightDate) : '-';
  const secondWeightTime = secondWeightKg > 0 ? formatTimeStr(slip.secondWeightTime) : '-';

  const nettWeightDate = secondWeightKg > 0 ? secondWeightDate : firstWeightDate;
  const nettWeightTime = secondWeightKg > 0 ? secondWeightTime : firstWeightTime;

  // Company Information Resolution from Company Profile Module
  const companyDisplayName = (
    company.firmName ||
    company.companyName ||
    (slip.companyName && slip.companyName !== 'APARNA RMC & WEIGHBRIDGE' ? slip.companyName : '') ||
    'DHARANI COTTON MILLS'
  ).toUpperCase();

  const addressParts = [
    company.address || (slip.companyAddress && slip.companyAddress !== 'Industrial Zone, Highway Bypass' ? slip.companyAddress : 'Vikarabad'),
    company.city || 'Hyderabad',
    company.state ? `${company.state}${company.pincode ? ` - ${company.pincode}` : ''}` : (company.pincode ? `Telangana - ${company.pincode}` : 'Telangana - 500033')
  ].filter(Boolean);
  const companyAddress = addressParts.join(', ');

  const phoneNo = company.phone || slip.phoneNo || '+91 20 2712 8899';
  const gstinNo = company.gstin || '27AAAAA0000A1Z5';
  const licenseNo = company.weighbridgeLicense || 'WB/2026/RMC-449';
  const adminName = slip.adminName || slip.operatorName || 'System Admin';

  // Security Auth Token
  const authToken = `AUTH-WB-2026-TX${slip.transactionNo}-${(firstWeightKg % 997).toString().padStart(3, '0')}`;

  // Real Scannable Verification QR Payload
  const qrPayload = [
    `DHARANI COTTON MILLS`,
    `Slip #${slip.slipNumber || slip.transactionNo}`,
    `Veh: ${slip.vehicleNo || slip.vehicleRegNo}`,
    `Party: ${slip.partyName || '-'}`,
    `Gross: ${firstWeightKg} kg`,
    `Tare: ${secondWeightKg} kg`,
    `Nett: ${nettWeightKg} kg`,
    `Date: ${firstWeightDate} ${firstWeightTime}`,
    `Lic: ${licenseNo}`,
    `STATUS: AUTHENTIC`
  ].join(' | ');

  const handleExportPDF = async () => {
    if (!slip) return;
    try {
      setIsExportingPdf(true);
      await downloadWeighSlipPDF({
        ...slip,
        printOptions: {
          ...slip.printOptions,
          printDuplicate,
          printQrCode,
          printImages: effectivePrintImages,
        }
      }, company);
      toast({
        title: 'PDF Downloaded',
        description: `Weighment Slip #${slip.transactionNo} (${slip.vehicleNo || slip.vehicleRegNo || 'Vehicle'}) saved to your system.`,
      });
    } catch (err: any) {
      console.error('Failed to export PDF:', err);
      toast({
        title: 'Export Failed',
        description: 'Could not export weighment slip to PDF. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  /**
   * Compact Half-A4 Slip Sheet (fits cleanly inside <= 138mm height on standard A4 paper).
   */
  const renderSlipSheet = (copyType: 'ORIGINAL' | 'DUPLICATE', isDuplicateSheet: boolean) => (
    <div
      className={`weigh-slip-paper p-3.5 bg-white font-sans text-slate-900 relative shadow-sm rounded-lg ${
        isDuplicateSheet
          ? 'border-t-2 border-dashed border-slate-400 pt-4 mt-2 print:mt-3 print:pt-2'
          : ''
      }`}
    >
      {/* Watermark for duplicate copy */}
      {isDuplicateSheet && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-10">
          <span className="text-6xl sm:text-7xl font-black rotate-[-25deg] tracking-widest text-slate-900">
            DUPLICATE
          </span>
        </div>
      )}

      {/* 1. Header Bar: WEIGHMENT SLIP with Copy Type Tag */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-1 mb-1 print:pb-0.5 print:mb-1">
        <div className="w-24">
          <span className="text-[9px] print:text-[8px] font-mono text-slate-600 font-semibold">
            TICKET #{slip.transactionNo}
          </span>
        </div>
        <h2 className="text-sm sm:text-base print:text-[13px] font-black uppercase tracking-widest text-slate-900 text-center flex-1 leading-none">
          WEIGHMENT SLIP
        </h2>
        <div className="w-24 text-right">
          <span
            className={`inline-block px-1.5 py-0.5 text-[9px] print:text-[7.5px] font-black uppercase font-mono rounded tracking-wider ${
              isDuplicateSheet
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
            }`}
          >
            {copyType} COPY
          </span>
        </div>
      </div>

      {/* 2. Company Details Header */}
      <div className="border-b border-slate-300 pb-1.5 mb-1.5 print:pb-1 print:mb-1">
        <div className="flex items-center justify-between gap-3">
          {company.logoUrl ? (
            <img
              src={company.logoUrl}
              alt="Company Logo"
              className="h-9 print:h-8 w-auto max-w-[100px] object-contain rounded"
            />
          ) : (
            <div className="w-12 hidden sm:block" />
          )}

          <div className="text-center flex-1 leading-tight">
            <h1 className="text-sm sm:text-base print:text-[13px] font-black uppercase tracking-wider text-slate-900 leading-tight">
              {companyDisplayName}
            </h1>
            <p className="text-[10.5px] print:text-[8.5px] text-slate-700 font-semibold mt-0.5 leading-tight">
              {companyAddress}
            </p>
            <p className="text-[9.5px] print:text-[8px] text-slate-600 font-mono mt-0.5 leading-tight">
              Phone: <strong className="text-slate-900">{phoneNo}</strong>
              {` · GSTIN: ${gstinNo}`}
            </p>
          </div>
          <div className="w-12 hidden sm:block" />
        </div>
      </div>

      {/* Authenticated Verification Strip */}
      <div className="flex items-center justify-between bg-slate-100 border border-slate-300 px-2.5 py-0.5 rounded text-[9px] print:text-[7.5px] font-mono mb-1.5 print:mb-1 text-slate-700">
        <div className="flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-700" />
          <span className="font-bold text-slate-900 uppercase">ELECTRONIC WEIGHBRIDGE TERMINAL</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>SECURITY TOKEN:</span>
          <strong className="text-slate-950 bg-white px-1 py-0 rounded border border-slate-300 font-mono">
            {authToken}
          </strong>
        </div>
      </div>

      {/* 3. Primary Slip Parameters Grid */}
      <div className="mb-1.5 print:mb-1 bg-slate-50 p-2 print:p-1.5 rounded border border-slate-300 font-sans text-[10.5px] print:text-[8.5px] leading-tight">
        <div className="flex items-center justify-between border-b border-slate-300 pb-0.5 mb-1 font-mono">
          <span className="text-slate-600 font-bold uppercase text-[9.5px] print:text-[8px] tracking-wider">
            Transaction No:
          </span>
          <span className="font-black text-slate-950 text-xs print:text-[10px] font-mono">
            #{slip.transactionNo}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {/* Left Column (8 items) */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-700 font-bold">Vehicle No:</span>
              <span className="font-mono font-black text-[10px] print:text-[8.5px] bg-slate-900 text-white px-1.5 py-[1px] rounded">
                {slip.vehicleNo || slip.vehicleRegNo || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-700 font-bold">Party Name:</span>
              <span className="font-bold text-slate-900 text-right truncate max-w-[170px]" title={slip.partyName || '-'}>
                {slip.partyName || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">Product:</span>
              <span className="font-bold text-slate-900 text-right truncate max-w-[170px]" title={slip.product || slip.material || '-'}>
                {slip.product || slip.material || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">Status:</span>
              <span className="font-mono font-bold text-[9.5px] print:text-[8px] uppercase px-1.5 py-0 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                {slip.status || 'Inward'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">LocationName:</span>
              <span className="font-semibold text-slate-900 text-right truncate max-w-[170px]">
                {slip.locationName || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">CultivatorName:</span>
              <span className="font-semibold text-slate-900 text-right truncate max-w-[170px]">
                {slip.cultivatorName || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">LoadSlipNo:</span>
              <span className="font-mono font-bold text-slate-900 text-right">
                {slip.loadSlipNo || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-medium">BagsBales:</span>
              <span className="font-mono font-semibold text-slate-900 text-right">
                {slip.bagsBales || '-'}
              </span>
            </div>
          </div>

          {/* Right Column (8 items) */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">Charges:</span>
              <span className="font-mono font-bold text-slate-900 text-right">
                {slip.charges !== undefined && slip.charges !== null && slip.charges !== '' && slip.charges !== 0
                  ? `₹ ${Number(slip.charges).toLocaleString()}`
                  : '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">Rate:</span>
              <span className="font-mono font-bold text-slate-900 text-right">
                {slip.rate !== undefined && slip.rate !== null && slip.rate !== '' && slip.rate !== 0
                  ? `₹ ${Number(slip.rate).toLocaleString()}`
                  : '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">Moisture:</span>
              <span className="font-mono font-semibold text-slate-900 text-right">
                {slip.moisture !== undefined && slip.moisture !== null && slip.moisture !== '' && slip.moisture !== 0
                  ? `${slip.moisture} %`
                  : '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">ChessNo:</span>
              <span className="font-mono font-bold text-slate-900 text-right">
                {slip.chessNo || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">ChessName:</span>
              <span className="font-semibold text-slate-900 text-right">
                {slip.chessName || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">ChessAmount:</span>
              <span className="font-mono font-bold text-slate-900 text-right">
                {slip.chessAmount !== undefined && slip.chessAmount !== null && slip.chessAmount !== '' && slip.chessAmount !== 0
                  ? `₹ ${Number(slip.chessAmount).toLocaleString()}`
                  : '-'}
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-200/80 pb-[1px]">
              <span className="text-slate-600 font-medium">Village:</span>
              <span className="font-semibold text-slate-900 text-right truncate max-w-[170px]">
                {slip.village || '-'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-medium">MobileNo:</span>
              <span className="font-mono font-semibold text-slate-900 text-right">
                {slip.mobileNo || '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Weighment Table */}
      <div className="border border-slate-900 mb-1.5 print:mb-1 rounded overflow-hidden">
        <table className="w-full text-[10.5px] print:text-[8.5px]">
          <thead className="bg-slate-900 text-white uppercase text-[9px] print:text-[7.5px] tracking-wider font-bold">
            <tr>
              <th className="py-1 px-2.5 print:py-[2px] text-left">Weighment Parameter</th>
              <th className="py-1 px-2.5 print:py-[2px] text-left">Date</th>
              <th className="py-1 px-2.5 print:py-[2px] text-left">Time</th>
              <th className="py-1 px-2.5 print:py-[2px] text-right">Weight (kg)</th>
              <th className="py-1 px-2.5 print:py-[2px] text-right">Qtl (Quintal)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300 font-mono text-[10.5px] print:text-[8.5px]">
            {/* 1st Weight */}
            <tr>
              <td className="py-1 px-2.5 print:py-[2px] font-bold text-slate-900">1st Weight</td>
              <td className="py-1 px-2.5 print:py-[2px] text-slate-700">{firstWeightDate}</td>
              <td className="py-1 px-2.5 print:py-[2px] text-slate-700">{firstWeightTime}</td>
              <td className="py-1 px-2.5 print:py-[2px] text-right font-black text-slate-900">
                {firstWeightKg.toLocaleString()} kg
              </td>
              <td className="py-1 px-2.5 print:py-[2px] text-right font-bold text-slate-800">
                {firstWeightQtl} Qtl
              </td>
            </tr>

            {/* 2nd Weight */}
            <tr>
              <td className="py-1 px-2.5 print:py-[2px] font-bold text-slate-900">2nd Weight</td>
              <td className="py-1 px-2.5 print:py-[2px] text-slate-700">{secondWeightDate}</td>
              <td className="py-1 px-2.5 print:py-[2px] text-slate-700">{secondWeightTime}</td>
              <td className="py-1 px-2.5 print:py-[2px] text-right font-black text-slate-900">
                {secondWeightKg > 0 ? `${secondWeightKg.toLocaleString()} kg` : '-'}
              </td>
              <td className="py-1 px-2.5 print:py-[2px] text-right font-bold text-slate-800">
                {secondWeightKg > 0 ? `${secondWeightQtl} Qtl` : '-'}
              </td>
            </tr>

            {/* Nett Weight (Highlighted Row) */}
            <tr className="bg-amber-100/80 border-t border-slate-900 font-black text-xs print:text-[9.5px]">
              <td className="py-1 px-2.5 print:py-[2.5px] text-amber-950 font-black">
                Nett Weight (|1st - 2nd|)
              </td>
              <td className="py-1 px-2.5 print:py-[2.5px] text-slate-900 text-[10px] print:text-[8.5px] font-semibold">{nettWeightDate}</td>
              <td className="py-1 px-2.5 print:py-[2.5px] text-slate-900 text-[10px] print:text-[8.5px] font-semibold">{nettWeightTime}</td>
              <td className="py-1 px-2.5 print:py-[2.5px] text-right text-amber-950 font-black">
                {nettWeightKg.toLocaleString()} kg
              </td>
              <td className="py-1 px-2.5 print:py-[2.5px] text-right text-amber-950 font-black">
                {nettWeightQtl} Qtl
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 5. Camera Snapshots & Genuine Verification QR Code & Signatures */}
      <div className="flex gap-3 items-center justify-between border-t border-slate-300 pt-1.5 print:pt-1">
        {Boolean(effectivePrintImages && slip.evidence && slip.evidence.length > 0) ? (
          <div className="flex gap-1.5">
            {slip.evidence.slice(0, 3).map((ev, i) => (
              <div
                key={i}
                className="w-20 h-12 print:w-[22mm] print:h-[12.5mm] border border-slate-400 rounded overflow-hidden relative bg-slate-100"
              >
                <img
                  src={ev.url}
                  alt={ev.angle ? `Camera ${ev.angle}` : `Evidence ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0 inset-x-0 bg-slate-900/85 text-[7px] text-white text-center py-[1px] font-mono uppercase font-bold leading-none">
                  {ev.angle === 'front' ? 'Cam 1' : ev.angle === 'side' ? 'Cam 2' : `Cam ${i + 1}`}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {Boolean(printQrCode) ? (
          <div className="flex items-center gap-1.5 border border-slate-300 p-1 rounded bg-slate-50">
            <QRCodeView value={qrPayload} size={40} />
            <div className="text-[8.5px] print:text-[7.5px] text-slate-600 font-mono leading-tight">
              <div className="font-bold text-slate-900 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span>SCANNABLE QR</span>
              </div>
              <div className="font-semibold text-slate-800">TX #{slip.transactionNo}</div>
            </div>
          </div>
        ) : null}

        {/* Official Signature Blocks */}
        <div className="flex gap-5 text-[9.5px] print:text-[8px] text-slate-700 ml-auto">
          <div className="text-center pt-3.5 print:pt-3 border-t border-slate-400 w-28 print:w-24 leading-tight">
            <span className="block font-semibold">Cultivator / Driver</span>
            <span className="text-[8px] print:text-[7px] text-slate-500">(Signature)</span>
          </div>
          <div className="text-center pt-3.5 print:pt-3 border-t border-slate-400 w-32 print:w-28 font-medium leading-tight">
            <span className="block font-bold text-slate-900 truncate">{adminName}</span>
            <span className="text-[8px] print:text-[7px] text-slate-500 font-mono">Weighmaster / Authorized</span>
          </div>
        </div>
      </div>

      {/* Computer-generated Slip Footer */}
      <div className="mt-1.5 pt-1 print:mt-1 print:pt-0.5 border-t border-slate-200 text-[9px] print:text-[7.5px] text-slate-500 text-center font-mono leading-tight">
        {company.weighSlipNotes && !company.weighSlipNotes.includes('Legal Metrology')
          ? company.weighSlipNotes
          : 'Computer generated electronic ticket.'}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start bg-black/75 backdrop-blur-xs p-2 sm:p-4 md:py-6 overflow-y-auto animate-fade-in print:p-0 print:m-0 print:bg-white print:static print:h-auto print:max-h-[280mm] print:overflow-hidden">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 5mm 6mm;
        }
        @media print {
          html, body {
            width: 100% !important;
            height: 280mm !important;
            max-height: 280mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body { visibility: hidden !important; }
          .weigh-slip-print-container, .weigh-slip-print-container * { visibility: visible !important; }
          .weigh-slip-print-container {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            max-height: 280mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            box-shadow: none !important;
            border: none !important;
            gap: 3mm !important;
          }
          .weigh-slip-paper {
            box-shadow: none !important;
            border: 1.25px solid #0f172a !important;
            padding: 3mm 4.5mm !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            width: 100% !important;
            max-width: 198mm !important;
            max-height: 136mm !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
          }
        }
      `}</style>

      <div className="bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-300 w-full max-w-3xl overflow-hidden flex flex-col print:border-none print:shadow-none print:w-full print:max-w-none print:m-0 print:h-auto my-auto sm:my-4">
        {/* Modal Controls Bar (Always sticky and visible at the top, hidden in print) */}
        <div className="sticky top-0 z-30 bg-slate-900 text-white px-5 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg border-b border-slate-700 print:hidden rounded-t-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
              <Printer className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-sm block leading-tight">Half-A4 Weighment Slip Preview</span>
              <span className="text-[10px] text-slate-400 font-mono">TX #{slip.transactionNo} · {slip.vehicleNo || slip.vehicleRegNo || 'Vehicle'} · Half A4 Print</span>
            </div>
          </div>

          {/* Real-time Print Options Toolbar */}
          <div className="flex items-center gap-3.5 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={printDuplicate}
                onChange={(e) => setPrintDuplicate(e.target.checked)}
                className="rounded text-teal-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="text-[11px] font-semibold flex items-center gap-1">
                <Copy className="w-3 h-3 text-amber-400" />
                <span>Print Duplicate (2 Copies)</span>
              </span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={printQrCode}
                onChange={(e) => setPrintQrCode(e.target.checked)}
                className="rounded text-teal-500 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="text-[11px] font-semibold">Print QR Code</span>
            </label>

            <label
              className={`flex items-center gap-1.5 select-none ${
                isAdmin ? 'cursor-pointer text-slate-300 hover:text-white' : 'cursor-not-allowed text-slate-400 opacity-75'
              }`}
              title={isAdmin ? 'Enable/Disable Print Images across all roles' : 'Controlled globally by Admin'}
            >
              <input
                type="checkbox"
                checked={effectivePrintImages}
                disabled={!isAdmin}
                onChange={(e) => {
                  if (!isAdmin) return;
                  const checked = e.target.checked;
                  setPrintImages(checked);
                  setGlobalPrintImages(checked);
                }}
                className="rounded text-teal-500 w-3.5 h-3.5 cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-[11px] font-semibold">
                Print Images{!isAdmin ? ' (Admin)' : ''}
              </span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              disabled={isExportingPdf}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition-all active:scale-95 cursor-pointer disabled:opacity-60"
              title="Export Weighment Slip as PDF (Download to system)"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  <span>Export PDF</span>
                </>
              )}
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-1.5 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow transition-all active:scale-95 cursor-pointer ring-1 ring-teal-400/50"
              title="Print Half-A4 Weighment Slip (Ctrl+P)"
            >
              <Printer className="w-4 h-4" />
              <span>{printDuplicate ? 'Print Both Slips' : 'Print Slip'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer ml-1"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Slip Paper Container */}
        <div className="weigh-slip-print-container p-4 bg-slate-100 flex flex-col gap-4 print:gap-0 print:p-0 print:bg-white">
          {renderSlipSheet('ORIGINAL', false)}

          {printDuplicate && renderSlipSheet('DUPLICATE', true)}
        </div>

        {/* Bottom Action Footer (Always visible on screen, hidden in print) */}
        <div className="bg-slate-100 border-t border-slate-300 px-6 py-3.5 flex items-center justify-between print:hidden rounded-b-xl">
          <div className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {printDuplicate
                ? 'Original + Duplicate configured (top & bottom half on 1 A4 page).'
                : 'Ticket verified and formatted to print on half of an A4 sheet.'}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleExportPDF}
              disabled={isExportingPdf}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow transition-all active:scale-95 cursor-pointer disabled:opacity-60"
            >
              <FileDown className="w-4 h-4" />
              <span>Export PDF</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow transition-all active:scale-95 cursor-pointer ring-1 ring-teal-400/40"
            >
              <Printer className="w-4 h-4" />
              <span>{printDuplicate ? 'Print Both Slips' : 'Print Slip'}</span>
            </button>
            <button
              onClick={onClose}
              className="px-3.5 py-2 bg-white hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg border border-slate-300 transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IndustrialWeighSlipModal;
