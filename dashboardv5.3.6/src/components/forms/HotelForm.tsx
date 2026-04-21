import { useState } from 'react';
import { useBooking } from '@/contexts/BookingContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function HotelForm() {
  const { addHotel } = useBooking();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    locator: '',
    hotelName: '',
    checkIn: '',
    checkOut: '',
    nights: 1,
    rooms: 1,
    breakfast: false,
    guestName: '',
    pricePaid: 0,
    priceOriginal: 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addHotel({
      ...formData,
      id: Date.now().toString(),
    });
    toast({
      title: 'Hospedagem cadastrada com sucesso!',
      description: `${formData.hotelName} adicionado.`,
    });
    setOpen(false);
    setFormData({
      locator: '',
      hotelName: '',
      checkIn: '',
      checkOut: '',
      nights: 1,
      rooms: 1,
      breakfast: false,
      guestName: '',
      pricePaid: 0,
      priceOriginal: 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Nova Hospedagem
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar Nova Hospedagem</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="locator">Localizador</Label>
              <Input
                id="locator"
                value={formData.locator}
                onChange={(e) => setFormData({ ...formData, locator: e.target.value.toUpperCase() })}
                placeholder="HTL001"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hotelName">Nome do Hotel</Label>
              <Input
                id="hotelName"
                value={formData.hotelName}
                onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })}
                placeholder="Royal Inn Hotel"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="guestName">Nome do Hóspede</Label>
            <Input
              id="guestName"
              value={formData.guestName}
              onChange={(e) => setFormData({ ...formData, guestName: e.target.value })}
              placeholder="Nome completo"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="checkIn">Check-in</Label>
              <Input
                id="checkIn"
                value={formData.checkIn}
                onChange={(e) => setFormData({ ...formData, checkIn: e.target.value })}
                placeholder="16/12/2025"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkOut">Check-out</Label>
              <Input
                id="checkOut"
                value={formData.checkOut}
                onChange={(e) => setFormData({ ...formData, checkOut: e.target.value })}
                placeholder="20/12/2025"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nights">Diárias</Label>
              <Input
                id="nights"
                type="number"
                min="1"
                value={formData.nights}
                onChange={(e) => setFormData({ ...formData, nights: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rooms">Quartos</Label>
              <Input
                id="rooms"
                type="number"
                min="1"
                value={formData.rooms}
                onChange={(e) => setFormData({ ...formData, rooms: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="breakfast"
              checked={formData.breakfast}
              onCheckedChange={(checked) => setFormData({ ...formData, breakfast: checked })}
            />
            <Label htmlFor="breakfast">Café da Manhã Incluso</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pricePaid">Valor Pago (R$)</Label>
              <Input
                id="pricePaid"
                type="number"
                step="0.01"
                value={formData.pricePaid}
                onChange={(e) => setFormData({ ...formData, pricePaid: parseFloat(e.target.value) || 0 })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="priceOriginal">Valor Original (R$)</Label>
              <Input
                id="priceOriginal"
                type="number"
                step="0.01"
                value={formData.priceOriginal}
                onChange={(e) => setFormData({ ...formData, priceOriginal: parseFloat(e.target.value) || 0 })}
                required
              />
            </div>
          </div>

          <Button type="submit" className="w-full">
            Cadastrar Hospedagem
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
