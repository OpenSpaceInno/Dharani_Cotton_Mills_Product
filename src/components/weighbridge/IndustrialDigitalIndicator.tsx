import React, { useState } from 'react';
import { WeightReading } from '@/types/weighbridge';
import { Edit3, Check, X, RotateCcw } from 'lucide-react';

interface IndustrialDigitalIndicatorProps {
  reading: WeightReading;
  mode?: 'GROSS' | 'TARE' | 'NET';
  digitsCount?: number;
  isAdmin?: boolean;
  isManual?: boolean;
  onManualWeightSet?: (weight: number) => void;
  onResetToLive?: () => void;
}

export const IndustrialDigitalIndicator: React.FC<IndustrialDigitalIndicatorProps> = ({
  reading,
  mode = 'GROSS',
  digitsCount = 5,
  isAdmin = false,
  isManual = false,
  onManualWeightSet,
  onResetToLive,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const r = reading || ({} as WeightReading);

  // Format to digitsCount digits (e.g. 00000 or 024580)
  const weightVal = Math.max(0, Math.round(r.weight || 0));
  const formattedDigits = String(weightVal).padStart(digitsCount, '0');

  const handleApplyManual = () => {
    const parsed = parseFloat(manualInput.replace(/[^0-9.]/g, ''));
    if (!isNaN(parsed) && parsed >= 0 && onManualWeightSet) {
      onManualWeightSet(Math.round(parsed));
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleApplyManual();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  return (
    <div className="flex items-center gap-2.5 bg-slate-900 border-2 border-slate-700 px-3 py-1 rounded-md shadow-inner select-none h-11 shrink-0">
      {/* Status Annunciator Flags */}
      <div className="flex flex-col gap-0.5 text-[9px] font-bold font-mono tracking-wider leading-none">
        <span
          className={`px-1 py-0.5 rounded transition-colors ${
            r.stable
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-slate-800 text-slate-500'
          }`}
        >
          STABLE
        </span>
        <span
          className={`px-1 py-0.5 rounded transition-colors ${
            weightVal === 0
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
              : 'bg-slate-800 text-slate-500'
          }`}
        >
          ZERO
        </span>
      </div>

      {/* 5-Digit / 6-Digit 7-Segment Digital Scale Display or Inline Admin Input */}
      {isEditing ? (
        <div className="flex items-center gap-1.5 font-mono">
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={String(weightVal)}
            className="w-28 px-2 py-0.5 bg-slate-950 border border-amber-500 text-amber-400 font-black text-xl tracking-widest text-right rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <button
            type="button"
            onClick={handleApplyManual}
            className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
            title="Apply manual weight"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-baseline gap-1.5 font-mono">
          <div
            onClick={() => {
              if (isAdmin) {
                setManualInput(weightVal > 0 ? String(weightVal) : '');
                setIsEditing(true);
              }
            }}
            className={`text-2xl sm:text-3xl font-black tracking-widest text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)] ${
              isAdmin ? 'cursor-pointer hover:text-cyan-300 transition-colors' : ''
            }`}
            title={isAdmin ? 'Click to manually enter weight (Admin Override)' : undefined}
          >
            {formattedDigits}
          </div>
          <div className="flex flex-col text-[9px] font-bold text-cyan-500 tracking-wider leading-tight">
            <span>{(r.unit || 'kg').toUpperCase()}</span>
            <span className="text-yellow-400 font-bold font-mono">
              {(r.weightQtl !== undefined ? r.weightQtl : (r.weight || 0) / 100).toFixed(2)} Qtl
            </span>
          </div>
        </div>
      )}

      {/* Current Weighment Mode Flag + Manual Admin Indicator */}
      <div className="flex items-center gap-1">
        <div className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 font-mono">
          {mode}
        </div>

        {isManual && (
          <div className="text-[8px] font-bold px-1 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono flex items-center gap-0.5">
            <span>MANUAL</span>
            {onResetToLive && (
              <button
                type="button"
                onClick={onResetToLive}
                className="hover:text-white transition-colors ml-0.5"
                title="Reset to live USB scale"
              >
                <RotateCcw className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}

        {isAdmin && !isEditing && !isManual && (
          <button
            type="button"
            onClick={() => {
              setManualInput(weightVal > 0 ? String(weightVal) : '');
              setIsEditing(true);
            }}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 font-mono flex items-center gap-1 transition-colors"
            title="Admin manual weight entry"
          >
            <Edit3 className="w-2.5 h-2.5 text-amber-400" />
            <span>Manual</span>
          </button>
        )}
      </div>
    </div>
  );
};
