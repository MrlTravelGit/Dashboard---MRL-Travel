import { TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface SavingsCardProps {
  pricePaid: number;
  priceOriginal: number;
  label?: string;
}

export function SavingsCard({ pricePaid, priceOriginal, label = 'Economia' }: SavingsCardProps) {
  const savings = priceOriginal - pricePaid;
  const savingsPercentage = ((savings / priceOriginal) * 100).toFixed(1);

  return (
    <Card className="bg-accent border-none">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-accent-foreground">
                R$ {savings.toFixed(2)}
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
            <p className="font-semibold text-foreground">R$ {pricePaid.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground">Valor na Cia</p>
            <p className="font-semibold text-foreground line-through">R$ {priceOriginal.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
