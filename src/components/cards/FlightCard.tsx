import { Plane, ExternalLink, MapPin, Clock, CheckCircle2, ArrowRight, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { Flight } from '@/types/booking';
import { SavingsCard } from './SavingsCard';

interface FlightCardProps {
  flight: Flight;
  showSavings?: boolean;
  viewMode?: 'card' | 'landscape';
  onDelete?: (id: string) => void;
}

// URLs diretas para consulta de reserva com localizador
const getAirlineReservationUrl = (airline: string, locator: string, originCode: string, lastName: string): string => {
  const encodedLocator = encodeURIComponent(locator);
  const encodedLastName = encodeURIComponent(lastName);
  const encodedOrigin = encodeURIComponent(originCode);
  
  switch (airline) {
    case 'LATAM':
      return `https://www.latamairlines.com/br/pt/minhas-viagens?booking=${encodedLocator}&lastName=${encodedLastName}`;
    case 'GOL':
      return `https://www.voegol.com.br/minhas-viagens?locator=${encodedLocator}&lastName=${encodedLastName}`;
    case 'AZUL':
      return `https://www.voeazul.com.br/br/pt/home/minhas-viagens/confirmacao?pnr=${encodedLocator}&origin=${encodedOrigin}`;
    default:
      return '#';
  }
};

const airlineColors: Record<string, string> = {
  LATAM: 'bg-[hsl(258,89%,66%)]',
  GOL: 'bg-[hsl(24,100%,50%)]',
  AZUL: 'bg-[hsl(210,100%,45%)]',
};

const airlineBorderColors: Record<string, string> = {
  LATAM: 'border-l-[hsl(258,89%,66%)]',
  GOL: 'border-l-[hsl(24,100%,50%)]',
  AZUL: 'border-l-[hsl(210,100%,45%)]',
};

// Extrai o sobrenome do nome completo
const extractLastName = (fullName: string | undefined | null): string => {
  if (!fullName) return '';
  const parts = fullName.trim().split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
};

export function FlightCard({ flight, showSavings = true, viewMode = 'card', onDelete }: FlightCardProps) {
  const bookingAwareId = flight.bookingId ? `${flight.bookingId}:${flight.id}` : flight.id;
  const lastName = extractLastName(flight.passengerName);
  const reservationUrl = getAirlineReservationUrl(flight.airline, flight.locator, flight.originCode, lastName);

  const handleVerifyTicket = () => {
    window.open(reservationUrl, '_blank');
  };

  if (viewMode === 'landscape') {
    return (
      <div className={`flex items-center gap-4 p-3 rounded-lg border border-l-4 ${airlineBorderColors[flight.airline]} bg-card hover:bg-accent/50 transition-colors`}>
        <div className="flex items-center gap-2 min-w-[100px]">
          <Plane className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{flight.airline}</span>
        </div>
        
        <Badge variant="outline" className="text-xs">{flight.locator}</Badge>
        
        <div className="flex items-center gap-2 flex-1">
          <span className="font-bold">{flight.originCode}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-bold">{flight.destinationCode}</span>
        </div>
        
        <div className="text-sm text-muted-foreground">{flight.departureDate}</div>
        <div className="text-sm font-medium">{flight.departureTime}</div>
        
        <div className="text-sm text-muted-foreground truncate max-w-[150px]">{flight.passengerName}</div>
        
        {flight.checkedIn && (
          <Badge className="bg-accent text-accent-foreground text-xs">
            <CheckCircle2 className="h-3 w-3" />
          </Badge>
        )}
        
        <Button variant="ghost" size="sm" onClick={handleVerifyTicket}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className={`${airlineColors[flight.airline]} text-primary-foreground py-3 px-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plane className="h-5 w-5" />
            <span className="font-semibold">{flight.airline} Airlines</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground border-none">
              {flight.locator}
            </Badge>
            {flight.purchaseNumber && (
              <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground border-none">
                {flight.purchaseNumber}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Passageiro:</span>
            <span className="font-medium">{flight.passengerName}</span>
          </div>
          {flight.checkedIn && (
            <Badge className="bg-accent text-accent-foreground">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Check-in Realizado
            </Badge>
          )}
        </div>

        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <Badge variant="outline" className="text-xs">
              {flight.type === 'outbound' ? '→ Voo de Ida' : flight.type === 'return' ? '← Voo de Volta' : '↔ Voo Interno'}
            </Badge>
            {flight.flightNumber && (
              <span className="text-sm text-muted-foreground">Voo {flight.flightNumber}</span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-center">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <MapPin className="h-3 w-3" />
                <span className="text-xs">Origem</span>
              </div>
              <p className="font-bold text-lg">{flight.originCode || '---'}</p>
              <p className="text-sm text-muted-foreground">{flight.origin || 'Não informado'}</p>
              {flight.departureDate && (
                <>
                  <p className="text-sm font-medium mt-1">{flight.departureDate}</p>
                  <p className="text-lg font-bold text-primary">{flight.departureTime}</p>
                </>
              )}
            </div>

            <div className="flex-1 mx-6">
              <div className="flex items-center">
                <div className="h-2 w-2 rounded-full bg-primary"></div>
                <div className="flex-1 h-0.5 bg-border relative">
                  {flight.duration && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-card px-2">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {flight.duration}
                      </div>
                    </div>
                  )}
                </div>
                <div className="h-2 w-2 rounded-full bg-accent-foreground"></div>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-2">
                {flight.stops === 0 ? 'Voo Direto' : `${flight.stops} Parada${flight.stops > 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="text-center">
              <div className="flex items-center gap-1 text-muted-foreground mb-1">
                <MapPin className="h-3 w-3" />
                <span className="text-xs">Destino</span>
              </div>
              <p className="font-bold text-lg">{flight.destinationCode || '---'}</p>
              <p className="text-sm text-muted-foreground">{flight.destination || 'Não informado'}</p>
              {flight.arrivalDate && (
                <>
                  <p className="text-sm font-medium mt-1">{flight.arrivalDate}</p>
                  <p className="text-lg font-bold text-accent-foreground">{flight.arrivalTime}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {showSavings && flight.pricePaid > 0 && (
          <SavingsCard pricePaid={flight.pricePaid} priceOriginal={flight.priceAirline} />
        )}

        <div className="flex gap-2">
          <Button onClick={handleVerifyTicket} variant="outline" className="flex-1">
            <ExternalLink className="h-4 w-4 mr-2" />
            Consultar Reserva na {flight.airline}
          </Button>
          {onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tem certeza que deseja excluir o voo {flight.flightNumber} ({flight.originCode} → {flight.destinationCode})? Esta ação não pode ser desfeita.
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
        </div>
      </CardContent>
    </Card>
  );
}