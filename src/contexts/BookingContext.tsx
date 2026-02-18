import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Flight,
  Hotel,
  CarRental,
  CompleteBooking,
  CompanySettings,
} from "@/types/booking";

interface BookingContextType {
  flights: Flight[];
  hotels: Hotel[];
  carRentals: CarRental[];
  completeBookings: CompleteBooking[];
  companySettings: CompanySettings;

  addFlight: (flight: Flight) => void;
  addHotel: (hotel: Hotel) => void;
  addCarRental: (carRental: CarRental) => void;
  addCompleteBooking: (booking: CompleteBooking) => void;

  // Atualiza e persiste no Supabase (companies + storage)
  updateCompanySettings: (
    settings: Partial<CompanySettings>,
    logoFile?: File | null
  ) => Promise<void>;

  deleteFlight: (id: string) => void;
  deleteHotel: (id: string) => void;
  deleteCarRental: (id: string) => void;
  deleteCompleteBooking: (id: string) => void;

  refresh: () => void;
}

type BookingRow = {
  id: string;
  const typed: BookingRow[] = data.map((b: any) => ({
    id: b.id,
    name: b.name,
    company_id: b.company_id,
    created_at: b.created_at,
    flights: (b.flights as unknown as Flight[]) || [],
    hotels: (b.hotels as unknown as Hotel[]) || [],
    car_rentals: (b.car_rentals as unknown as CarRental[]) || [],
    passengers: (b.passengers as unknown as any[]) || [],
  }));
  setBookings(typed);
  name: string;
  company_id: string;
  created_at: string;
  flights: Flight[] | null;
  hotels: Hotel[] | null;
  car_rentals: CarRental[] | null;
  passengers?: any[] | null;
};

const BookingContext = createContext<BookingContextType | undefined>(undefined);

function parseCompositeId(input: string) {
  const idx = input.indexOf(":");
  if (idx <= 0) return { bookingId: null as string | null, itemId: input };
  return {
    bookingId: input.slice(0, idx),
    itemId: input.slice(idx + 1),
  };
}

async function getCompanyIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("company_users")
    .select("company_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return data?.company_id ?? null;
}

async function fetchCompany(companyId: string) {
  const { data, error } = await supabase
    .from("companies")
    .select("id,name,logo_url")
    .eq("id", companyId)
    .single();

  if (error) throw error;
  return data as { id: string; name: string; logo_url: string | null };
}

async function uploadCompanyLogo(companyId: string, file: File) {
  const safeName = file.name.replace(/\s+/g, "_");
  const path = `companies/${companyId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("company-logos")
    .upload(path, file, { upsert: true });

  if (upErr) throw upErr;

  // Bucket público (mais simples)
  const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
  return data.publicUrl as string;
}

export function BookingProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [completeBookings, setCompleteBookings] = useState<CompleteBooking[]>(
    []
  );

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    name: isAdmin ? "Admin" : "Minha Empresa",
    logo: null,
  });

  const refresh = () => {
    void fetchBookings();
    void loadCompanySettings();
  };

  const loadCompanySettings = async () => {
    if (!user) {
      setCompanyId(null);
      setCompanySettings({ name: isAdmin ? "Admin" : "Minha Empresa", logo: null });
      return;
    }

    // Admin pode não estar ligado a uma empresa, então só carrega se existir vínculo
    const cid = await getCompanyIdForUser(user.id);
    setCompanyId(cid);

    if (!cid) {
      setCompanySettings({ name: isAdmin ? "Admin" : "Minha Empresa", logo: null });
      return;
    }

    try {
      const c = await fetchCompany(cid);
      setCompanySettings({
        name: c.name || (isAdmin ? "Admin" : "Minha Empresa"),
        logo: c.logo_url || null,
      });
    } catch (e) {
      console.error("Error loading company settings:", e);
    }
  };

  const fetchBookings = async () => {
    if (!user) {
      setBookings([]);
      return;
    }

    let query = supabase
      .from("bookings")
      .select("id, name, company_id, created_at, flights, hotels, car_rentals, passengers")
      .order("created_at", { ascending: false });

    if (!isAdmin) {
      const cid = await getCompanyIdForUser(user.id);
      if (!cid) {
        setBookings([]);
        return;
      }
      query = query.eq("company_id", cid);
    }

    const { data, error } = await query;
    if (error || !data) {
      console.error("Error fetching bookings:", error);
      setBookings([]);
      return;
    }

    const typed: BookingRow[] = data.map((b: any) => ({
      id: b.id,
      name: b.name,
      company_id: b.company_id,
      created_at: b.created_at,
      flights: (b.flights as unknown as Flight[]) || [],
      hotels: (b.hotels as unknown as Hotel[]) || [],
      car_rentals: (b.car_rentals as unknown as CarRental[]) || [],
      passengers: (b.passengers as unknown as any[]) || [],
    }));

    setBookings(typed);
  };

  useEffect(() => {
    void fetchBookings();
    void loadCompanySettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdmin]);

  const flights = useMemo(() => {
    const out: Flight[] = [];
    for (const b of bookings) {
      const list = Array.isArray(b.flights) ? b.flights : [];
      for (const f of list) out.push({ ...f, bookingId: b.id });
    }
    return out;
  }, [bookings]);

  const hotels = useMemo(() => {
    const out: Hotel[] = [];
    for (const b of bookings) {
      const list = Array.isArray(b.hotels) ? b.hotels : [];
      for (const h of list) out.push({ ...h, bookingId: b.id });
    }
    return out;
  }, [bookings]);

  const carRentals = useMemo(() => {
    const out: CarRental[] = [];
    for (const b of bookings) {
      const list = Array.isArray(b.car_rentals) ? b.car_rentals : [];
      for (const c of list) out.push({ ...c, bookingId: b.id });
    }
    return out;
  }, [bookings]);

  const updateCompanySettings = async (
    settings: Partial<CompanySettings>,
    logoFile?: File | null
  ) => {
    // A partir de agora, empresas/usuários só visualizam.
    // Somente admin pode alterar nome/logo.
    if (!isAdmin) {
      console.warn("Only admins can update company settings");
      return;
    }

    // Atualiza UI primeiro, para feedback imediato
    setCompanySettings((prev) => ({ ...prev, ...settings }));

    // Sem companyId não tem como persistir
    if (!companyId) return;

    try {
      const updatePayload: { name?: string; logo_url?: string | null } = {};

      if (typeof settings.name === "string") {
        updatePayload.name = settings.name;
      }

      if (logoFile) {
        const url = await uploadCompanyLogo(companyId, logoFile);
        updatePayload.logo_url = url;

        // também atualiza UI com a url final
        setCompanySettings((prev) => ({ ...prev, logo: url }));
      }

      // Se não tem nada para atualizar, sai
      if (!updatePayload.name && updatePayload.logo_url === undefined) return;

      const { error } = await supabase
        .from("companies")
        .update(updatePayload)
        .eq("id", companyId);

      if (error) throw error;
    } catch (e) {
      console.error("Error updating company settings:", e);
      // Se der erro, recarrega do banco para não ficar estado incorreto
      await loadCompanySettings();
      throw e;
    }
  };

  const addFlight = (flight: Flight) => {
    void (async () => {
      if (!user) return;
      if (isAdmin) return;

      const cid = await getCompanyIdForUser(user.id);
      if (!cid) return;

      const payload = {
        company_id: cid,
        name: `Voo ${flight.flightNumber || flight.locator || ""}`.trim(),
        flights: [flight],
        hotels: [],
        car_rentals: [],
      } as any;

      await supabase.from("bookings").insert(payload);
      await fetchBookings();
    })();
  };

  const addHotel = (hotel: Hotel) => {
    void (async () => {
      if (!user) return;
      if (isAdmin) return;

      const cid = await getCompanyIdForUser(user.id);
      if (!cid) return;

      const payload = {
        company_id: cid,
        name: `Hotel ${hotel.hotelName || hotel.locator || ""}`.trim(),
        flights: [],
        hotels: [hotel],
        car_rentals: [],
      } as any;

      await supabase.from("bookings").insert(payload);
      await fetchBookings();
    })();
  };

  const addCarRental = (carRental: CarRental) => {
    void (async () => {
      if (!user) return;
      if (isAdmin) return;

      const cid = await getCompanyIdForUser(user.id);
      if (!cid) return;

      const payload = {
        company_id: cid,
        name: `Carro ${carRental.company || carRental.locator || ""}`.trim(),
        flights: [],
        hotels: [],
        car_rentals: [carRental],
      } as any;

      await supabase.from("bookings").insert(payload);
      await fetchBookings();
    })();
  };

  const addCompleteBooking = (booking: CompleteBooking) => {
    setCompleteBookings((prev) => [...prev, booking]);
  };

  const deleteFlight = (id: string) => {
    void (async () => {
      const { bookingId, itemId } = parseCompositeId(id);
      if (!bookingId) return;

      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      const nextFlights = (booking.flights || []).filter((f) => f.id !== itemId);

      const { error } = await supabase
        .from("bookings")
        .update({ flights: nextFlights as any })
        .eq("id", bookingId);

      if (error) {
        console.error("Error deleting flight:", error);
        return;
      }

      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, flights: nextFlights } : b))
      );
    })();
  };

  const deleteHotel = (id: string) => {
    void (async () => {
      const { bookingId, itemId } = parseCompositeId(id);
      if (!bookingId) return;

      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      const nextHotels = (booking.hotels || []).filter((h) => h.id !== itemId);

      const { error } = await supabase
        .from("bookings")
        .update({ hotels: nextHotels as any })
        .eq("id", bookingId);

      if (error) {
        console.error("Error deleting hotel:", error);
        return;
      }

      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, hotels: nextHotels } : b))
      );
    })();
  };

  const deleteCarRental = (id: string) => {
    void (async () => {
      const { bookingId, itemId } = parseCompositeId(id);
      if (!bookingId) return;

      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      const nextCars = (booking.car_rentals || []).filter((c) => c.id !== itemId);

      const { error } = await supabase
        .from("bookings")
        .update({ car_rentals: nextCars as any })
        .eq("id", bookingId);

      if (error) {
        console.error("Error deleting car rental:", error);
        return;
      }

      setBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId ? { ...b, car_rentals: nextCars } : b
        )
      );
    })();
  };

  const deleteCompleteBooking = (id: string) => {
    setCompleteBookings((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <BookingContext.Provider
      value={{
        flights,
        hotels,
        carRentals,
        completeBookings,
        companySettings,
        addFlight,
        addHotel,
        addCarRental,
        addCompleteBooking,
        updateCompanySettings,
        deleteFlight,
        deleteHotel,
        deleteCarRental,
        deleteCompleteBooking,
        refresh,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (context === undefined) {
    throw new Error("useBooking must be used within a BookingProvider");
  }
  return context;
}
