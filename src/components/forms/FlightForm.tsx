import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Plane, Upload, FileImage, Loader2, Check, Link2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Flight } from '@/types/booking';
import { useAuth } from '@/contexts/AuthContext';

type FlightFormProps = {
  onSaved?: () => void;
};

type LinkExtractMeta = {
  total: number | null;
  suggestedTitle: string;
  mainPassengerName: string;
};

export function FlightForm({ onSaved }: FlightFormProps) {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('upload');

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedFlights, setExtractedFlights] = useState<Partial<Flight>[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Via Link
  const [linkUrl, setLinkUrl] = useState('');
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  const [linkFlights, setLinkFlights] = useState<Partial<Flight>[]>([]);
  const [linkMeta, setLinkMeta] = useState<LinkExtractMeta | null>(null);

  // Admin pode escolher a empresa no momento do cadastro
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  useEffect(() => {
    const loadCompanies = async () => {
      if (!open || !isAdmin) return;

      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading companies:', error);
        toast({
          title: 'Erro ao carregar empresas',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      setCompanies(data || []);
      if (!selectedCompanyId && data?.length) {
        setSelectedCompanyId(data[0].id);
      }
    };

    loadCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin]);

  const getCurrentCompanyId = async (): Promise<string> => {
    if (!user) throw new Error('Usuário não autenticado.');

    if (isAdmin) {
      if (!selectedCompanyId) {
        throw new Error('Selecione uma empresa para cadastrar o voo.');
      }
      return selectedCompanyId;
    }

    const { data, error } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.company_id) throw new Error('Usuário não vinculado a uma empresa.');
    return data.company_id;
  };

  const insertBookingWithFlights = async (
    flightsToInsert: Flight[],
    options?: { sourceUrl?: string; bookingName?: string; totalPaid?: number | null; totalOriginal?: number | null }
  ) => {
    const companyId = await getCurrentCompanyId();

    const computedTotalPaid = flightsToInsert.reduce((sum, f) => sum + (Number(f.pricePaid) || 0), 0);
    const computedTotalOriginal = flightsToInsert.reduce((sum, f) => sum + (Number(f.priceAirline) || 0), 0);

    const name =
      options?.bookingName ||
      (flightsToInsert.length === 1
        ? `Voo ${flightsToInsert[0].flightNumber || flightsToInsert[0].locator || 'sem número'}`
        : `Reserva com ${flightsToInsert.length} voos`);

    const totalPaid =
      options?.totalPaid !== undefined ? options.totalPaid : (computedTotalPaid || null);

    const totalOriginal =
      options?.totalOriginal !== undefined ? options.totalOriginal : (computedTotalOriginal || null);

    const { error } = await supabase
      .from('bookings')
      .insert({
        company_id: companyId,
        name,
        source_url: options?.sourceUrl || null,
        flights: flightsToInsert as any,
        total_paid: totalPaid,
        total_original: totalOriginal,
        created_by: user?.id || null,
      });

    if (error) throw error;
  };

  const [formData, setFormData] = useState({
    locator: '',
    purchaseNumber: '',
    airline: 'LATAM' as 'LATAM' | 'GOL' | 'AZUL',
    flightNumber: '',
    origin: '',
    originCode: '',
    destination: '',
    destinationCode: '',
    departureDate: '',
    departureTime: '',
    arrivalDate: '',
    arrivalTime: '',
    duration: '',
    stops: 0,
    passengerName: '',
    pricePaid: 0,
    priceAirline: 0,
    checkedIn: false,
    type: 'outbound' as 'outbound' | 'return' | 'internal',
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: 'Formato inválido',
        description: 'Por favor, envie uma imagem (PNG, JPG) ou PDF.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'O arquivo deve ter no máximo 10MB.',
        variant: 'destructive',
      });
      return;
    }

    setUploadedFile(file);
    setExtractedFlights([]);
  };

  const handleExtractData = async () => {
    if (!uploadedFile) return;

    setIsExtracting(true);
    setExtractedFlights([]);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.split(',')[1];
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(uploadedFile);
      });

      const { data, error } = await supabase.functions.invoke('extract-flight-data', {
        body: {
          imageBase64: base64,
          mimeType: uploadedFile.type,
        },
      });

      if (error) {
        throw new Error(error.message || 'Erro ao extrair dados');
      }

      if (data?.success && data?.data?.flights?.length > 0) {
        setExtractedFlights(data.data.flights);
        toast({
          title: 'Dados extraídos!',
          description: `${data.data.flights.length} voo(s) encontrado(s). Revise e confirme.`,
        });
      } else {
        toast({
          title: 'Nenhum voo encontrado',
          description: data?.error || 'Não foi possível extrair dados da imagem. Tente o cadastro manual.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error extracting data:', error);
      toast({
        title: 'Erro ao extrair dados',
        description: error instanceof Error ? error.message : 'Tente novamente ou use o cadastro manual.',
        variant: 'destructive',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExtractFromLink = async () => {
    const url = linkUrl.trim();
    if (!url) {
      toast({
        title: 'URL obrigatória',
        description: 'Por favor, insira o link da reserva.',
        variant: 'destructive',
      });
      return;
    }

    setIsExtractingLink(true);
    setLinkFlights([]);
    setLinkMeta(null);

    try {
      const { data, error } = await supabase.functions.invoke('extract-iddas-booking', {
        body: { url },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha ao extrair do link');

      const flights = Array.isArray(data.data?.flights) ? data.data.flights : [];
      const meta: LinkExtractMeta = {
        total: data.data?.total ?? null,
        suggestedTitle: data.data?.suggestedTitle || 'Reserva (link)',
        mainPassengerName: data.data?.mainPassengerName || '',
      };

      if (!flights.length) {
        toast({
          title: 'Nenhum voo encontrado',
          description: 'O link foi acessado, mas não encontramos voos. Você pode tentar outro link.',
          variant: 'destructive',
        });
        return;
      }

      setLinkMeta(meta);
      setLinkFlights(flights);

      toast({
        title: 'Dados extraídos!',
        description: `${flights.length} voo(s) encontrado(s). Revise e confirme.`,
      });
    } catch (e: any) {
      console.error('extract link error:', e);
      toast({
        title: 'Erro ao extrair do link',
        description: e?.message || 'Não foi possível extrair os dados do link.',
        variant: 'destructive',
      });
    } finally {
      setIsExtractingLink(false);
    }
  };

  const handleConfirmExtractedFlights = async (flightsSource: Partial<Flight>[], sourceUrl?: string, meta?: LinkExtractMeta | null) => {
    try {
      const flightsToInsert: Flight[] = flightsSource.map((flight, index) => ({
        id: flight.id || (crypto?.randomUUID?.() ?? `${Date.now()}-${index}`),
        locator: flight.locator || '',
        purchaseNumber: flight.purchaseNumber || '',
        airline: (flight.airline as 'LATAM' | 'GOL' | 'AZUL') || 'LATAM',
        flightNumber: flight.flightNumber || '',
        origin: flight.origin || '',
        originCode: flight.originCode || '',
        destination: flight.destination || '',
        destinationCode: flight.destinationCode || '',
        departureDate: flight.departureDate || '',
        departureTime: flight.departureTime || '',
        arrivalDate: flight.arrivalDate || '',
        arrivalTime: flight.arrivalTime || '',
        duration: flight.duration || '',
        stops: flight.stops || 0,
        passengerName: flight.passengerName || meta?.mainPassengerName || '',
        pricePaid: Number(flight.pricePaid) || 0,
        priceAirline: Number(flight.priceAirline) || 0,
        checkedIn: Boolean(flight.checkedIn) || false,
        type: (flight.type as 'outbound' | 'return' | 'internal') || 'outbound',
      }));

      await insertBookingWithFlights(flightsToInsert, {
        sourceUrl,
        bookingName: meta?.suggestedTitle,
        totalPaid: meta?.total ?? undefined,
        totalOriginal: meta?.total ?? undefined,
      });

      toast({
        title: 'Voo cadastrado com sucesso',
        description: `${flightsToInsert.length} voo(s) salvo(s) no banco.`,
      });

      onSaved?.();
      handleClose();
    } catch (err) {
      console.error('Error saving extracted flights:', err);
      toast({
        title: 'Erro ao salvar voo',
        description: err instanceof Error ? err.message : 'Não foi possível salvar no banco.',
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    setOpen(false);
    setExtractedFlights([]);
    setUploadedFile(null);

    setLinkUrl('');
    setLinkFlights([]);
    setLinkMeta(null);

    setActiveTab('upload');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const flight: Flight = {
        id: crypto?.randomUUID?.() ?? Date.now().toString(),
        ...formData,
      };

      await insertBookingWithFlights([flight]);

      toast({
        title: 'Voo cadastrado com sucesso',
        description: 'O voo foi salvo no banco e já deve aparecer na lista.',
      });

      onSaved?.();
      handleClose();
      setFormData({
        locator: '',
        purchaseNumber: '',
        airline: 'LATAM',
        flightNumber: '',
        origin: '',
        originCode: '',
        destination: '',
        destinationCode: '',
        departureDate: '',
        departureTime: '',
        arrivalDate: '',
        arrivalTime: '',
        duration: '',
        stops: 0,
        passengerName: '',
        pricePaid: 0,
        priceAirline: 0,
        checkedIn: false,
        type: 'outbound',
      });
    } catch (err) {
      console.error('Error saving manual flight:', err);
      toast({
        title: 'Erro ao salvar voo',
        description: err instanceof Error ? err.message : 'Não foi possível salvar no banco.',
        variant: 'destructive',
      });
    }
  };

  const renderFlightCard = (flight: Partial<Flight>, index: number, passengerFallback?: string) => (
    <Card key={index} className="border-primary/30">
      <CardContent className="p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Companhia:</span>
            <span className="ml-2 font-medium">{flight.airline}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Localizador:</span>
            <span className="ml-2 font-mono font-medium">{flight.locator}</span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Passageiro:</span>
            <span className="ml-2 font-medium">
              {(flight.passengerName || passengerFallback || '').trim() || 'Não informado'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Voo:</span>
            <span className="ml-2 font-medium">{flight.flightNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Origem:</span>
            <span className="ml-2 font-medium">{flight.origin} ({flight.originCode})</span>
          </div>
          <div>
            <span className="text-muted-foreground">Destino:</span>
            <span className="ml-2 font-medium">{flight.destination} ({flight.destinationCode})</span>
          </div>
          <div>
            <span className="text-muted-foreground">Partida:</span>
            <span className="ml-2 font-medium">{flight.departureDate} {flight.departureTime}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Chegada:</span>
            <span className="ml-2 font-medium">{flight.arrivalDate} {flight.arrivalTime}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Tipo:</span>
            <span className="ml-2 font-medium">
              {flight.type === 'outbound' ? 'Ida' : flight.type === 'return' ? 'Volta' : 'Interno'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Paradas:</span>
            <span className="ml-2 font-medium">{flight.stops === 0 ? 'Direto' : flight.stops}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Novo Voo
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cadastrar Novo Voo</DialogTitle>
        </DialogHeader>

        {isAdmin && (
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a empresa" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4 mr-2" />
              PDF/Imagem
            </TabsTrigger>
            <TabsTrigger value="link">
              <Link2 className="h-4 w-4 mr-2" />
              Via Link
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Plane className="h-4 w-4 mr-2" />
              Manual
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-4 pt-4">
            <Card className="bg-accent/30 border-accent">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center shrink-0">
                    <FileImage className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground">Extração automática</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Envie um PDF ou print da confirmação de reserva e os dados serão extraídos automaticamente.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="file-upload">Arquivo da Reserva</Label>
                <Input
                  id="file-upload"
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
                  onChange={handleFileChange}
                  className="flex-1"
                />
                <p className="text-xs text-muted-foreground">
                  Formatos aceitos: PNG, JPG, WEBP, PDF (máx. 10MB)
                </p>
              </div>

              {uploadedFile && !extractedFlights.length && (
                <Button type="button" onClick={handleExtractData} disabled={isExtracting} className="w-full">
                  {isExtracting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Extraindo dados...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Extrair Dados da Reserva
                    </>
                  )}
                </Button>
              )}

              {extractedFlights.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-accent-foreground">
                    <Check className="h-5 w-5" />
                    <span className="font-medium">{extractedFlights.length} voo(s) encontrado(s)</span>
                  </div>

                  {extractedFlights.map((flight, index) => renderFlightCard(flight, index))}

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setExtractedFlights([])}>
                      Tentar Novamente
                    </Button>
                    <Button type="button" className="w-full" onClick={() => handleConfirmExtractedFlights(extractedFlights)}>
                      <Check className="h-4 w-4 mr-2" />
                      Confirmar e Cadastrar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="link" className="space-y-4 pt-4">
            <Card className="bg-accent/30 border-accent">
              <CardContent className="p-4">
                <p className="font-medium text-foreground">Extração via Link</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Cole o link do IDDAS para extrair os voos e cadastrar automaticamente.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label>Link da Reserva</Label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://agencia.iddas.com.br/reserva/..."
              />
              <Button type="button" className="w-full" onClick={handleExtractFromLink} disabled={isExtractingLink || !linkUrl.trim()}>
                {isExtractingLink ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Extraindo...
                  </>
                ) : (
                  'Extrair'
                )}
              </Button>
            </div>

            {linkFlights.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-accent-foreground">
                  <Check className="h-5 w-5" />
                  <span className="font-medium">{linkFlights.length} voo(s) encontrado(s)</span>
                </div>

                {linkFlights.map((flight, index) => renderFlightCard(flight, index, linkMeta?.mainPassengerName))}

                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="w-full" onClick={() => { setLinkFlights([]); setLinkMeta(null); }}>
                    Tentar Novamente
                  </Button>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => handleConfirmExtractedFlights(linkFlights, linkUrl.trim(), linkMeta)}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Confirmar e Cadastrar
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="space-y-4 pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Companhia</Label>
                  <Select value={formData.airline} onValueChange={(v) => setFormData((p) => ({ ...p, airline: v as any }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LATAM">LATAM</SelectItem>
                      <SelectItem value="GOL">GOL</SelectItem>
                      <SelectItem value="AZUL">AZUL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Voo</Label>
                  <Input value={formData.flightNumber} onChange={(e) => setFormData((p) => ({ ...p, flightNumber: e.target.value }))} />
                </div>

                <div className="space-y-2">
                  <Label>Origem</Label>
                  <Input value={formData.originCode} onChange={(e) => setFormData((p) => ({ ...p, originCode: e.target.value }))} placeholder="CNF" />
                </div>

                <div className="space-y-2">
                  <Label>Destino</Label>
                  <Input value={formData.destinationCode} onChange={(e) => setFormData((p) => ({ ...p, destinationCode: e.target.value }))} placeholder="CGH" />
                </div>

                <div className="space-y-2">
                  <Label>Passageiro</Label>
                  <Input value={formData.passengerName} onChange={(e) => setFormData((p) => ({ ...p, passengerName: e.target.value }))} />
                </div>

                <div className="space-y-2 flex items-center gap-2 pt-6">
                  <Switch checked={formData.checkedIn} onCheckedChange={(v) => setFormData((p) => ({ ...p, checkedIn: v }))} />
                  <Label>Check-in feito</Label>
                </div>
              </div>

              <Button type="submit" className="w-full">
                Salvar
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
