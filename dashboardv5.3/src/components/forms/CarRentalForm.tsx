import { useState } from 'react';
import { useBooking } from '@/contexts/BookingContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function CarRentalForm() {
  const { addCarRental } = useBooking();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    locator: '',
    company: '',
    carModel: '',
    pickupLocation: '',
    pickupDate: '',
    pickupTime: '',
    returnLocation: '',
    returnDate: '',
    returnTime: '',
    driverName: '',
    pricePaid: 0,
    priceOriginal: 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addCarRental({
      ...formData,
      id: Date.now().toString(),
    });
    toast({
      title: 'Aluguel de carro cadastrado com sucesso!',
      description: `${formData.carModel} - ${formData.company} adicionado.`,
    });
    setOpen(false);
    setFormData({
      locator: '',
      company: '',
      carModel: '',
      pickupLocation: '',
      pickupDate: '',
      pickupTime: '',
      returnLocation: '',
      returnDate: '',
      returnTime: '',
      driverName: '',
      pricePaid: 0,
      priceOriginal: 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Novo Aluguel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar Novo Aluguel de Carro</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="locator">Localizador</Label>
              <Input
                id="locator"
                value={formData.locator}
                onChange={(e) => setFormData({ ...formData, locator: e.target.value.toUpperCase() })}
                placeholder="CAR001"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Locadora</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Localiza"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="carModel">Modelo do Carro</Label>
              <Input
                id="carModel"
                value={formData.carModel}
                onChange={(e) => setFormData({ ...formData, carModel: e.target.value })}
                placeholder="Toyota Corolla"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="driverName">Nome do Condutor</Label>
              <Input
                id="driverName"
                value={formData.driverName}
                onChange={(e) => setFormData({ ...formData, driverName: e.target.value })}
                placeholder="Nome completo"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickupLocation">Local de Retirada</Label>
            <Input
              id="pickupLocation"
              value={formData.pickupLocation}
              onChange={(e) => setFormData({ ...formData, pickupLocation: e.target.value })}
              placeholder="Aeroporto CNF"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pickupDate">Data de Retirada</Label>
              <Input
                id="pickupDate"
                value={formData.pickupDate}
                onChange={(e) => setFormData({ ...formData, pickupDate: e.target.value })}
                placeholder="16/12/2025"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pickupTime">Horário de Retirada</Label>
              <Input
                id="pickupTime"
                value={formData.pickupTime}
                onChange={(e) => setFormData({ ...formData, pickupTime: e.target.value })}
                placeholder="19:00"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="returnLocation">Local de Devolução</Label>
            <Input
              id="returnLocation"
              value={formData.returnLocation}
              onChange={(e) => setFormData({ ...formData, returnLocation: e.target.value })}
              placeholder="Aeroporto CNF"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="returnDate">Data de Devolução</Label>
              <Input
                id="returnDate"
                value={formData.returnDate}
                onChange={(e) => setFormData({ ...formData, returnDate: e.target.value })}
                placeholder="20/12/2025"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="returnTime">Horário de Devolução</Label>
              <Input
                id="returnTime"
                value={formData.returnTime}
                onChange={(e) => setFormData({ ...formData, returnTime: e.target.value })}
                placeholder="10:00"
                required
              />
            </div>
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
            Cadastrar Aluguel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
