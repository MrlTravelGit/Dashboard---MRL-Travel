import { Car, MapPin, Clock, User, ArrowRight, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { CarRental } from '@/types/booking';
import { SavingsCard } from './SavingsCard';

interface CarRentalCardProps {
  carRental: CarRental;
  showSavings?: boolean;
  viewMode?: 'card' | 'landscape';
  onDelete?: (id: string) => void;
}

export function CarRentalCard({ carRental, showSavings = true, viewMode = 'card', onDelete }: CarRentalCardProps) {
  const bookingAwareId = carRental.bookingId ? `${carRental.bookingId}:${carRental.id}` : carRental.id;
  if (viewMode === 'landscape') {
    return (
      <div className="flex items-center gap-4 p-3 rounded-lg border border-l-4 border-l-chart-5 bg-card hover:bg-accent/50 transition-colors">
        <div className="flex items-center gap-2 min-w-[100px]">
          <Car className="h-4 w-4 text-chart-5" />
          <span className="font-medium text-sm">{carRental.company}</span>
        </div>
        
        <Badge variant="outline" className="text-xs">{carRental.locator}</Badge>
        
        <Badge variant="secondary" className="text-xs">{carRental.carModel}</Badge>
        
        <div className="flex items-center gap-2">
          <span className="text-sm">{carRental.pickupDate}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{carRental.returnDate}</span>
        </div>
        
        <div className="text-sm text-muted-foreground truncate max-w-[150px]">{carRental.driverName}</div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-chart-5 text-secondary-foreground py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            <span className="font-semibold">{carRental.company}</span>
          </div>
          <Badge variant="secondary" className="bg-secondary-foreground/20 text-secondary-foreground border-none">
            {carRental.locator}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Condutor:</span>
            <span className="font-medium">{carRental.driverName}</span>
          </div>
          <Badge variant="outline">{carRental.carModel}</Badge>
        </div>

        <div className="bg-muted/30 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-accent-foreground font-medium mb-2">Retirada</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm">{carRental.pickupLocation}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm font-medium">{carRental.pickupDate} às {carRental.pickupTime}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-destructive font-medium mb-2">Devolução</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm">{carRental.returnLocation}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm font-medium">{carRental.returnDate} às {carRental.returnTime}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showSavings && (
          <SavingsCard pricePaid={carRental.pricePaid} priceOriginal={carRental.priceOriginal} />
        )}

        {onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="w-full gap-2">
                <Trash2 className="h-4 w-4" />
                Excluir Aluguel
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja excluir o aluguel do veículo "{carRental.carModel}" da {carRental.company}? Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(bookingAwareId)}>
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}