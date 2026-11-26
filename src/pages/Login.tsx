import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCompany } from '@/contexts/CompanyContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Lock, 
  User as UserIcon, 
  Eye, 
  EyeOff, 
  ArrowRight
} from 'lucide-react';

export default function Login() {
  const { login, isLoading } = useAuth();
  const { company } = useCompany();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await login({ username, password });
    if (res.success) {
      navigate(from, { replace: true });
    } else {
      setError(res.error || 'Authentication failed');
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-950 border-r border-slate-800 flex-col justify-between p-12 text-white relative overflow-hidden">
        {/* Background gradient decorative effect */}
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        {/* Top small badge */}
        <div className="relative z-10 flex items-center justify-between">
          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 px-3 py-1 font-mono text-xs">
            Industrial Weighbridge & Access Security
          </Badge>
          <span className="text-xs text-slate-500 font-mono">
            {company?.plantCode || 'PLANT_001'}
          </span>
        </div>

        {/* Center: Golden D with cotton emblem & brand title */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center my-auto py-8">
          <div className="relative mb-6 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80 shadow-2xl backdrop-blur-sm">
            <img 
              src="/logo-d-transparent.png" 
              alt="Dharani Cotton Mills" 
              className="h-36 w-auto max-w-[240px] object-contain drop-shadow-[0_12px_28px_rgba(234,179,8,0.25)] transition-transform duration-300 hover:scale-105" 
            />
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-wider text-amber-400 uppercase font-serif drop-shadow-sm">
            DHARANI
          </h1>
          <div className="h-0.5 w-28 bg-gradient-to-r from-transparent via-amber-400 to-transparent my-2.5" />
          <p className="text-sm tracking-[0.28em] text-slate-200 uppercase font-semibold">
            COTTON MILLS
          </p>

          <p className="text-slate-400 text-xs mt-4 max-w-sm leading-relaxed">
            Automated Weighbridge Scale Terminal, Dual-Axle Gross/Tare Capture, and ANPR Plant Gate Automation
          </p>
        </div>

        {/* Footer simple tag */}
        <div className="relative z-10 text-xs text-slate-500 text-center border-t border-slate-800/60 pt-4">
          © {new Date().getFullYear()} Dharani Cotton Mills. All rights reserved.
        </div>
      </div>

      {/* Right Login Form Panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 overflow-y-auto">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="flex flex-col items-center justify-center mb-4">
              <img 
                src={company?.logoUrl || '/logo.png'} 
                alt="Logo" 
                className="h-20 w-auto max-w-[220px] object-contain rounded-lg shadow-md mb-3 border border-border/40 p-1.5 bg-card" 
              />
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {company?.firmName || "Dharani Cotton Mills"}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Terminal Weighbridge & Gate Access Control
              </p>
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Sign in to Terminal</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Authenticate with your plant credentials to proceed.
            </p>
          </div>

          <Card className="border border-border shadow-sm">
            <form onSubmit={handleSubmit}>
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold">User Authentication</CardTitle>
                <CardDescription>Enter your assigned plant username or email</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="username">Username or Email</Label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="e.g. superadmin, admin or gate.security"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9 pr-9"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Authenticating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Access System <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
