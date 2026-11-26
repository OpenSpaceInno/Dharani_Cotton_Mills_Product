import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera, Car } from "lucide-react";

interface SimplePlateDisplayProps {
  plateNumber: string;
  confidence?: number;
  onManualCapture?: () => void;
  isProcessing?: boolean;
}

export function SimplePlateDisplay({ plateNumber }: SimplePlateDisplayProps) {
  const hasPlate = Boolean(plateNumber && plateNumber.trim());

  return (
    <Card className="border-primary/40 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Car className="h-4 w-4 text-primary" />
            Vehicle Registration Number
          </CardTitle>
          {hasPlate && (
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Camera className="h-3 w-3" />
              ANPR Active
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Large Prominent High-Security Number Plate Display */}
        <div className="flex justify-center">
          <div className="w-full max-w-2xl bg-amber-50 dark:bg-slate-900 border-4 border-slate-900 dark:border-amber-400/80 rounded-xl px-4 py-5 sm:py-7 text-center shadow-md relative overflow-hidden">
            {/* IND Plate Emblem Badge */}
            <div className="absolute top-2 left-3 flex items-center gap-1 text-[11px] font-black text-slate-700 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600 inline-block" />
              <span>IND</span>
            </div>

            <div className="mt-1">
              {hasPlate ? (
                <span className="font-mono text-3xl sm:text-5xl md:text-6xl font-black tracking-widest text-slate-950 dark:text-amber-300 select-all uppercase drop-shadow-xs">
                  {plateNumber}
                </span>
              ) : (
                <span className="font-mono text-xl sm:text-3xl md:text-4xl font-bold tracking-wider text-muted-foreground/60 uppercase">
                  WAITING FOR VEHICLE...
                </span>
              )}
            </div>
          </div>
        </div>

        {hasPlate ? (
          <p className="text-xs text-muted-foreground text-center font-mono">
            Plate captured at {new Date().toLocaleTimeString()}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground text-center font-mono">
            Monitoring gate camera feed for incoming vehicles...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
