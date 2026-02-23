import { useState, useEffect, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Plus, Search, Building2, Trash2, Loader2, Upload, X, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Company } from '@/types/booking';

interface CompanyWithLogo extends Company {
  logo_url?: string | null;
}

export default function CompaniesPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [companies, setCompanies] = useState<CompanyWithLogo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingCompany, setEditingCompany] = useState<CompanyWithLogo | null>(null);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ password: '', confirm: '' });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    cnpj: '',
    email: '',
    password: '',
    paymentDeadlineDays: '30',
  });

  const resetPasswordModal = () => {
    setPasswordForm({ password: '', confirm: '' });
    setPasswordOpen(false);
    setIsChangingPassword(false);
  };

  const handleChangeCompanyPassword = async () => {
    if (!editingCompany) return;

    const password = passwordForm.password.trim();
    const confirm = passwordForm.confirm.trim();

    if (password.length < 6) {
      toast({
        title: 'Senha inválida',
        description: 'A senha deve ter no mínimo 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirm) {
      toast({
        title: 'Senhas não conferem',
        description: 'Digite a mesma senha nos dois campos.',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke('company-set-password', {
        body: { company_id: editingCompany.id, new_password: password },
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Não foi possível alterar a senha.');
      }

      toast({
        title: 'Senha alterada',
        description: 'A senha de acesso da empresa foi atualizada.',
      });
      resetPasswordModal();
    } catch (e: any) {
      console.error('Error changing company password:', e);
      toast({
        title: 'Erro ao alterar senha',
        description: e?.message || 'Não foi possível alterar a senha da empresa.',
        variant: 'destructive',
      });
      setIsChangingPassword(false);
    }
  };

  const fetchCompanies = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching companies:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as empresas.',
        variant: 'destructive',
      });
    } else {
      setCompanies(data || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchCompanies();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl">
          <Card>
            <CardContent className="p-6">
              <div className="text-lg font-semibold text-foreground">Acesso restrito</div>
              <p className="text-sm text-muted-foreground mt-2">
                Esta área é exclusiva para administradores.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const formatCNPJ = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    return numbers
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
      .slice(0, 18);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast({
          title: 'Arquivo muito grande',
          description: 'O logo deve ter no máximo 2MB.',
          variant: 'destructive',
        });
        return;
      }
      
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Formato inválido',
          description: 'Por favor, selecione uma imagem.',
          variant: 'destructive',
        });
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadLogo = async (companyId: string): Promise<string | null> => {
    if (!logoFile) return null;

    const fileExt = logoFile.name.split('.').pop();
    const fileName = `${companyId}.${fileExt}`;
    const filePath = `logos/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(filePath, logoFile, { upsert: true });

    if (uploadError) {
      console.error('Error uploading logo:', uploadError);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('company-logos')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingCompany) {
        // Update existing company
        const updateData: any = {
          name: formData.name,
          cnpj: formData.cnpj,
          email: formData.email,
          payment_deadline_days: parseInt(formData.paymentDeadlineDays) || 30,
        };

        // Upload logo if provided
        if (logoFile) {
          const logoUrl = await uploadLogo(editingCompany.id);
          if (logoUrl) {
            updateData.logo_url = logoUrl;
          }
        }

        const { error: updateError } = await supabase
          .from('companies')
          .update(updateData)
          .eq('id', editingCompany.id);

        if (updateError) {
          throw updateError;
        }

        toast({
          title: 'Empresa atualizada!',
          description: `A empresa "${formData.name}" foi atualizada com sucesso.`,
        });
      } else {
        // Criar empresa + usuário de acesso sem trocar a sessão do admin.
        // O signUp no client troca a sessão para o usuário recém-criado e quebra o painel.
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw sessionErr;

        const accessToken = sessionData?.session?.access_token;
        if (!accessToken || typeof accessToken !== 'string') {
          throw new Error('Sessão inválida. Saia e entre novamente.');
        }

        const authHeader = `Bearer ${accessToken}`.replace(/\s+/g, ' ').trim();
        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/company-create-with-user`;

        const payload = {
          name: formData.name,
          cnpj: formData.cnpj,
          email: formData.email,
          payment_deadline_days: parseInt(formData.paymentDeadlineDays) || 30,
          // senha opcional. Se vazio, a função faz invite (definir senha via e-mail).
          password: formData.password?.trim() ? formData.password.trim() : null,
        };

        const fnRes = await fetch(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(payload),
        });

        const fnData = await fnRes.json().catch(() => ({}));
        if (!fnRes.ok) {
          const msg = (fnData as any)?.error || (fnData as any)?.message || 'Falha ao cadastrar empresa.';
          throw new Error(msg);
        }

        const companyData = (fnData as any)?.company;
        if (!companyData?.id) {
          throw new Error('Não foi possível criar a empresa.');
        }

        // Upload logo if provided
        if (logoFile && companyData) {
          const logoUrl = await uploadLogo(companyData.id);
          if (logoUrl) {
            await supabase
              .from('companies')
              .update({ logo_url: logoUrl })
              .eq('id', companyData.id);
          }
        }

        // Vínculo company_users é feito na Edge Function.

        toast({
          title: 'Empresa cadastrada!',
          description: `A empresa "${formData.name}" foi cadastrada com sucesso.`,
        });
      }

      setOpen(false);
      setEditingCompany(null);
      setFormData({ name: '', cnpj: '', email: '', password: '', paymentDeadlineDays: '30' });
      setLogoFile(null);
      setLogoPreview(null);
      fetchCompanies();
    } catch (error: any) {
      console.error('Error saving company:', error);
      toast({
        title: editingCompany ? 'Erro ao atualizar empresa' : 'Erro ao cadastrar empresa',
        description: error.message || 'Ocorreu um erro ao salvar a empresa.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (company: CompanyWithLogo) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      cnpj: company.cnpj,
      email: company.email,
      password: '',
      paymentDeadlineDays: String((company as any).payment_deadline_days || 30),
    });
    setLogoPreview(company.logo_url || null);
    setLogoFile(null);
    setOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = window.confirm(`Tem certeza que deseja excluir a empresa "${name}"?`);
    if (!confirmed) return;

    const { error } = await supabase.from('companies').delete().eq('id', id);

    if (error) {
      toast({
        title: 'Erro',
        description: 'Não foi possível excluir a empresa.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Empresa excluída',
        description: `A empresa "${name}" foi excluída com sucesso.`,
      });
      fetchCompanies();
    }
  };

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    company.cnpj.includes(searchTerm) ||
    company.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Empresas</h2>
            <p className="text-muted-foreground">Gerencie as empresas cadastradas no sistema</p>
          </div>
          
          <Dialog open={open} onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setEditingCompany(null);
              setFormData({ name: '', cnpj: '', email: '', password: '', paymentDeadlineDays: '30' });
              setLogoFile(null);
              setLogoPreview(null);
            }
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Nova Empresa
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingCompany ? 'Editar Empresa' : 'Cadastrar Empresa'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Logo Upload */}
                <div className="space-y-2">
                  <Label>Logo da Empresa</Label>
                  <div className="flex items-center gap-4">
                    {logoPreview ? (
                      <div className="relative">
                        <Avatar className="h-20 w-20">
                          <AvatarImage src={logoPreview} alt="Preview" />
                          <AvatarFallback>LOGO</AvatarFallback>
                        </Avatar>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={removeLogo}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="h-20 w-20 rounded-full border-2 border-dashed border-muted-foreground/25 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
                      >
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {logoPreview ? 'Alterar' : 'Selecionar'}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPG, PNG ou GIF. Máx 2MB.
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoChange}
                    className="hidden"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Nome da Empresa *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nome da empresa"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cnpj">CNPJ *</Label>
                  <Input
                    id="cnpj"
                    value={formData.cnpj}
                    onChange={(e) => setFormData({ ...formData, cnpj: formatCNPJ(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">E-mail de Acesso *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="empresa@email.com"
                    required
                  />
                </div>

                {editingCompany && (
                  <div className="space-y-2">
                    <Label>Senha de Acesso</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPasswordOpen(true)}
                      >
                        Alterar senha
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Altera a senha de login da empresa
                      </p>
                    </div>
                  </div>
                )}

                {!editingCompany && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Senha de Acesso</Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Senha para login"
                      minLength={6}
                    />
                    <p className="text-xs text-muted-foreground">
                      Se deixar em branco, o sistema envia um convite por e-mail para a empresa definir a senha.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="paymentDeadlineDays">Prazo para Pagamento (dias) *</Label>
                  <Input
                    id="paymentDeadlineDays"
                    type="number"
                    min="1"
                    value={formData.paymentDeadlineDays}
                    onChange={(e) => setFormData({ ...formData, paymentDeadlineDays: e.target.value })}
                    placeholder="30"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Número de dias após a reserva para vencimento do pagamento
                  </p>
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {editingCompany ? 'Salvando...' : 'Cadastrando...'}
                    </>
                  ) : (
                    editingCompany ? 'Salvar Alterações' : 'Cadastrar Empresa'
                  )}
                </Button>
              </form>

              <Dialog open={passwordOpen} onOpenChange={(o) => {
                setPasswordOpen(o);
                if (!o) resetPasswordModal();
              }}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Alterar senha da empresa</DialogTitle>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-password">Nova senha</Label>
                      <Input
                        id="new-password"
                        type="password"
                        value={passwordForm.password}
                        onChange={(e) => setPasswordForm({ ...passwordForm, password: e.target.value })}
                        placeholder="Mínimo 6 caracteres"
                        minLength={6}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        value={passwordForm.confirm}
                        onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                        placeholder="Repita a nova senha"
                        minLength={6}
                      />
                    </div>

                    <Button
                      type="button"
                      className="w-full"
                      disabled={isChangingPassword}
                      onClick={handleChangeCompanyPassword}
                    >
                      {isChangingPassword ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        'Salvar senha'
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, CNPJ ou e-mail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="text-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchTerm ? 'Nenhuma empresa encontrada.' : 'Nenhuma empresa cadastrada ainda.'}
            </p>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="w-full overflow-x-auto">
                <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">Logo</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Prazo Pgto</TableHead>
                    <TableHead>Data de Cadastro</TableHead>
                    <TableHead className="w-[80px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompanies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={company.logo_url || undefined} alt={company.name} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(company.name)}
                          </AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell>{company.cnpj}</TableCell>
                      <TableCell>{company.email}</TableCell>
                      <TableCell>{(company as any).payment_deadline_days || 30} dias</TableCell>
                      <TableCell>
                        {new Date(company.created_at).toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(company)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(company.id, company.name)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
