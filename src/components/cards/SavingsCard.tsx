import { TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface SavingsCardProps {
  pricePaid: number;
  priceOriginal: number;
  label?: string;
}

export function SavingsCard({ pricePaid, priceOriginal, label = 'Economia' }: SavingsCardProps) {
  function safeNumber(value: any, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  const paid = safeNumber(pricePaid);
  const original = safeNumber(priceOriginal);
  const savings = original - paid;
  const savingsPercentage = original > 0 ? ((savings / original) * 100).toFixed(1) : '0.0';

  return (
    <Card className="bg-accent border-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-accent-foreground">
                R$ {original > 0 ? savings.toFixed(2) : 'R$ 0,00'}
              </span>
              <span className="text-sm text-accent-foreground/80">
                ({savingsPercentage}%)
              </span>
            </div>
          </div>
          <div className="h-10 w-10 rounded-full bg-accent-foreground/10 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-accent-foreground" />
          </div>
        </div>
        <div className="mt-3 flex justify-between text-sm">
          <div>
            <p className="text-muted-foreground">Você pagou</p>
            <p className="font-semibold text-foreground">{paid > 0 ? `R$ ${paid.toFixed(2)}` : 'R$ 0,00'}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Valor na Cia</p>
            <p className="font-semibold text-foreground line-through">{original > 0 ? `R$ ${original.toFixed(2)}` : 'R$ 0,00'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
