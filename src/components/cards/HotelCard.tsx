import { Building2, Calendar, Moon, Coffee, User, ArrowRight, Trash2 } from 'lucide-react';
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
import { Hotel } from '@/types/booking';
import { SavingsCard } from './SavingsCard';

interface HotelCardProps {
  hotel: Hotel;
  showSavings?: boolean;
  viewMode?: 'card' | 'landscape';
  onDelete?: (id: string) => void;
}


export function HotelCard({ hotel, showSavings = true, viewMode = 'card', onDelete }: HotelCardProps) {
  // booking_id + hotel_index são únicos para o flatten
  const bookingAwareId = hotel.booking_id && hotel.hotel_index !== undefined
    ? `${hotel.booking_id}:${hotel.hotel_index}`
    : hotel.id || hotel.hotelName || Math.random().toString();
  function safeNumber(value: any, fallback = 0) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : fallback;
  }

  // Landscape view
  if (viewMode === 'landscape') {
    return (
      <div className="flex items-center gap-4 p-3 rounded-lg border border-l-4 border-l-secondary bg-card hover:bg-accent/50 transition-colors">
        <div className="flex items-center gap-2 min-w-[100px]">
          <Building2 className="h-4 w-4 text-secondary" />
          <span className="font-medium text-sm truncate max-w-[120px]">{hotel.hotel_display_name || hotel.hotelName || hotel.hotel_name || (hotel as any).name || 'Não informado'}</span>
        </div>
        <Badge variant="outline" className="text-xs">{hotel.code || hotel.locator || hotel.confirmation_code || (hotel as any).confirmationCode || '-'}</Badge>
        <div className="flex items-center gap-2">
          <span className="text-sm">{hotel.check_in || hotel.checkIn || '-'}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{hotel.check_out || hotel.checkOut || '-'}</span>
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Moon className="h-3 w-3" />
          <span>{safeNumber(hotel.nights || 1)}</span>
        </div>
        <div className="text-sm text-muted-foreground truncate max-w-[150px]">{hotel.guest_name || hotel.guestName || 'Não informado'}</div>
        {hotel.breakfast && (
          <Badge variant="secondary" className="text-xs">
            <Coffee className="h-3 w-3" />
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-secondary text-secondary-foreground py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
          <span className="font-semibold">{hotel.hotel_display_name || hotel.hotelName || hotel.hotel_name || (hotel as any).name || 'Hotel não informado'}</span>
          </div>
          <Badge variant="secondary" className="bg-secondary-foreground/20 text-secondary-foreground border-none">
            {hotel.code || hotel.locator || hotel.confirmation_code || (hotel as any).confirmationCode || '-'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Hóspede:</span>
          <span className="font-medium">{hotel.guest_name || hotel.guestName || 'Não informado'}</span>
        </div>

        <div className="bg-muted/30 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <Calendar className="h-3 w-3" />
                <span className="text-xs">Check-in</span>
              </div>
              <p className="font-bold">{hotel.check_in || hotel.checkIn || '-'}</p>
              <p className="text-xs text-muted-foreground">14:00</p>
            </div>
            <div>
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <Calendar className="h-3 w-3" />
                <span className="text-xs">Check-out</span>
              </div>
              <p className="font-bold">{hotel.check_out || hotel.checkOut || '-'}</p>
              <p className="text-xs text-muted-foreground">12:00</p>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{safeNumber(hotel.nights, 1)} Diária{safeNumber(hotel.nights, 1) > 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{safeNumber(hotel.rooms, 1)} Quarto{safeNumber(hotel.rooms, 1) > 1 ? 's' : ''}</span>
            </div>
            {hotel.breakfast && (
              <div className="flex items-center gap-2">
                <Coffee className="h-4 w-4 text-accent-foreground" />
                <span className="text-sm text-accent-foreground">Café da manhã</span>
              </div>
            )}
          </div>
        </div>

        {showSavings && (
          <SavingsCard pricePaid={hotel.pricePaid} priceOriginal={hotel.priceOriginal} />
        )}

        {onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="w-full gap-2">
                <Trash2 className="h-4 w-4" />
                Excluir Hospedagem
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja excluir a hospedagem no "{hotel.hotel_display_name || hotel.hotelName || hotel.hotel_name || 'Hotel não informado'}"? Esta ação não pode ser desfeita.
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