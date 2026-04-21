import { Plane } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AirlineLogoProps {
  airline: string;
  className?: string;
  showName?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

// Logos das companhias aéreas brasileiras
const airlineLogos: Record<string, string> = {
  LATAM: 'https://www.latamairlines.com/content/dam/latam/logos/latam-logo.svg',
  GOL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Gol_Transportes_A%C3%A9reos_logo.svg/200px-Gol_Transportes_A%C3%A9reos_logo.svg.png',
  AZUL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Azul_Brazilian_Airlines_logo.svg/200px-Azul_Brazilian_Airlines_logo.svg.png',
};

const airlineColors: Record<string, string> = {
  LATAM: 'bg-[hsl(258,89%,66%)]',
  GOL: 'bg-[hsl(24,100%,50%)]',
  AZUL: 'bg-[hsl(210,100%,45%)]',
};

const airlineNames: Record<string, string> = {
  LATAM: 'LATAM Airlines',
  GOL: 'GOL Linhas Aéreas',
  AZUL: 'Azul Linhas Aéreas',
  Azul: 'Azul Linhas Aéreas',
};

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

const textSizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export function AirlineLogo({ airline, className, showName = true, size = 'md' }: AirlineLogoProps) {
  const normalizedAirline = airline?.toUpperCase() || '';
  const logoUrl = airlineLogos[normalizedAirline];
  const airlineName = airlineNames[airline] || airlineNames[normalizedAirline] || airline;
  const bgColor = airlineColors[normalizedAirline] || 'bg-primary';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('rounded-full p-1.5 flex items-center justify-center', bgColor)}>
        {logoUrl ? (
          <img 
            src={logoUrl} 
            alt={airlineName}
            className={cn(sizeClasses[size], 'object-contain')}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <Plane className={cn(sizeClasses[size], 'text-primary-foreground', logoUrl ? 'hidden' : '')} />
      </div>
      {showName && (
        <span className={cn('font-medium', textSizeClasses[size])}>{airlineName}</span>
      )}
    </div>
  );
}

// Componente para mostrar múltiplas companhias aéreas (quando há mais de uma na reserva)
export function AirlineLogos({ airlines, className }: { airlines: string[]; className?: string }) {
  // Remover duplicatas
  const uniqueAirlines = [...new Set(airlines.map(a => a?.toUpperCase()).filter(Boolean))];
  
  if (uniqueAirlines.length === 0) {
    return null;
  }

  if (uniqueAirlines.length === 1) {
    return <AirlineLogo airline={uniqueAirlines[0]} className={className} size="sm" />;
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {uniqueAirlines.map((airline) => (
        <AirlineLogo key={airline} airline={airline} showName={false} size="sm" />
      ))}
      <span className="text-xs text-muted-foreground ml-1">
        {uniqueAirlines.join(' / ')}
      </span>
    </div>
  );
}
