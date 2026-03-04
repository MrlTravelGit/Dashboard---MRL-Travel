import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatCurrency } from "@/lib/formatters";
import type { CarRental } from "@/types/booking";
import {
  CalendarClock,
  Car,
  DollarSign,
  FileText,
  MapPin,
  ReceiptText,
  Trash2,
  User,
} from "lucide-react";

interface CarRentalCardProps {
  carRental: CarRental;
  onDelete?: (id: string) => void;
  viewMode?: "card" | "landscape";
  bookingTitle?: string;
  showBookingLink?: boolean;
}

function isBlank(value: unknown): boolean {
  return !String(value ?? "").trim();
}

export function CarRentalCard({
  carRental,
  onDelete,
  viewMode = "card",
  bookingTitle,
  showBookingLink = false,
}: CarRentalCardProps) {
  const isMinimal = useMemo(() => {
    const hasModel = !isBlank(carRental.carModel);
    const hasLocator = !isBlank(carRental.locator);
    const hasDriver = !isBlank(carRental.driverName);
    const hasLocations = !isBlank(carRental.pickupLocation) || !isBlank(carRental.returnLocation);
    const hasTimes = !isBlank(carRental.pickupTime) || !isBlank(carRental.returnTime);
    const hasPrices = (carRental.pricePaid || 0) > 0 || (carRental.priceOriginal || 0) > 0;

    return !hasModel && !hasLocator && !hasDriver && !hasLocations && !hasTimes && !hasPrices;
  }, [carRental]);

  const companyLabel = String(carRental.company || "Locadora").trim() || "Locadora";
  const pickupDate = String(carRental.pickupDate || "").trim();
  const returnDate = String(carRental.returnDate || "").trim();

  const showSavings = (carRental.pricePaid || 0) > 0 || (carRental.priceOriginal || 0) > 0;
  const savingsAmount = (carRental.priceOriginal || 0) - (carRental.pricePaid || 0);
  const savingsPercent =
    (carRental.priceOriginal || 0) > 0
      ? Math.round(((carRental.priceOriginal || 0) - (carRental.pricePaid || 0)) / (carRental.priceOriginal || 1) * 100)
      : 0;

  const handleDelete = () => {
    if (!onDelete) return;

    const label = companyLabel;
    const ok = window.confirm(
      `Tem certeza que deseja excluir este aluguel de carro (${label})? Esta ação não pode ser desfeita.`
    );
    if (ok) onDelete(carRental.id);
  };

  const bookingLink =
    showBookingLink && carRental.bookingId ? (
      <Button asChild variant="outline" size="sm" className="gap-2">
        <Link to={`/reservas/${carRental.bookingId}`}>
          <FileText className="h-4 w-4" />
          {bookingTitle ? "Ver reserva" : "Abrir reserva"}
        </Link>
      </Button>
    ) : null;

  if (viewMode === "landscape") {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    {companyLabel}
                    {!isBlank(carRental.locator) && (
                      <Badge variant="secondary" className="ml-2">
                        {carRental.locator}
                      </Badge>
                    )}
                  </h3>
                  {showBookingLink && carRental.bookingId && bookingTitle && (
                    <p className="text-sm text-muted-foreground mt-1">Reserva: {bookingTitle}</p>
                  )}
                </div>

                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleDelete}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div className="flex items-start gap-2">
                  <CalendarClock className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Retirada</p>
                    <p className="font-medium">
                      {pickupDate || "Não informado"}
                      {!isBlank(carRental.pickupTime) ? ` às ${carRental.pickupTime}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <CalendarClock className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Devolução</p>
                    <p className="font-medium">
                      {returnDate || "Não informado"}
                      {!isBlank(carRental.returnTime) ? ` às ${carRental.returnTime}` : ""}
                    </p>
                  </div>
                </div>

                {!isMinimal && !isBlank(carRental.driverName) && (
                  <div className="flex items-start gap-2">
                    <User className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Condutor</p>
                      <p className="font-medium">{carRental.driverName}</p>
                    </div>
                  </div>
                )}

                {!isMinimal && (!isBlank(carRental.pickupLocation) || !isBlank(carRental.returnLocation)) && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-1 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Locais</p>
                      <p className="font-medium">
                        {String(carRental.pickupLocation || "").trim() || "Retirada não informada"}
                        {String(carRental.returnLocation || "").trim()
                          ? ` → ${carRental.returnLocation}`
                          : ""}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-3 lg:items-end lg:min-w-[220px]">
              {bookingLink}

              {showSavings && (
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-sm text-muted-foreground">Economia</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatCurrency(Math.max(0, savingsAmount))} ({Math.max(0, savingsPercent)}%)
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Car className="h-5 w-5" />
              {companyLabel}
            </CardTitle>

            <div className="flex flex-wrap gap-2">
              {!isBlank(carRental.locator) && <Badge variant="secondary">{carRental.locator}</Badge>}
              {!isMinimal && !isBlank(carRental.carModel) && <Badge variant="outline">{carRental.carModel}</Badge>}
              {!isMinimal && !isBlank(carRental.category) && <Badge variant="outline">{carRental.category}</Badge>}
            </div>

            {showBookingLink && carRental.bookingId && bookingTitle && (
              <p className="text-sm text-muted-foreground">Reserva: {bookingTitle}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {bookingLink}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDelete}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CalendarClock className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Retirada</p>
                <p className="font-medium">
                  {pickupDate || "Não informado"}
                  {!isBlank(carRental.pickupTime) ? ` às ${carRental.pickupTime}` : ""}
                </p>
                {!isMinimal && !isBlank(carRental.pickupLocation) && (
                  <p className="text-sm text-muted-foreground">{carRental.pickupLocation}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CalendarClock className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Devolução</p>
                <p className="font-medium">
                  {returnDate || "Não informado"}
                  {!isBlank(carRental.returnTime) ? ` às ${carRental.returnTime}` : ""}
                </p>
                {!isMinimal && !isBlank(carRental.returnLocation) && (
                  <p className="text-sm text-muted-foreground">{carRental.returnLocation}</p>
                )}
              </div>
            </div>
          </div>

          {!isMinimal && (
            <div className="space-y-3">
              {!isBlank(carRental.driverName) && (
                <div className="flex items-start gap-3">
                  <User className="h-5 w-5 mt-0.5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Condutor</p>
                    <p className="font-medium">{carRental.driverName}</p>
                  </div>
                </div>
              )}

              {showSavings && (
                <div className="flex items-start gap-3">
                  <ReceiptText className="h-5 w-5 mt-0.5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Valores</p>
                    <div className="flex flex-col gap-1">
                      <p className="font-medium">Pago: {formatCurrency(carRental.pricePaid || 0)}</p>
                      {(carRental.priceOriginal || 0) > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Original: {formatCurrency(carRental.priceOriginal || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {showSavings && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                <span className="font-medium">Economia</span>
              </div>
              <div className="text-right">
                <p className="font-bold text-green-600">{formatCurrency(Math.max(0, savingsAmount))}</p>
                <p className="text-sm text-muted-foreground">{Math.max(0, savingsPercent)}% de economia</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
