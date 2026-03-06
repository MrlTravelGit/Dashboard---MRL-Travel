export interface Flight {
  id: string;
  bookingId?: string;
  locator: string;
  purchaseNumber: string;
  airline: 'LATAM' | 'GOL' | 'AZUL';
  flightNumber: string;
  origin: string;
  originCode: string;
  destination: string;
  destinationCode: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  duration: string;
  stops: number;
  passengerName: string;
  pricePaid: number;
  priceAirline: number;
  checkedIn: boolean;
  type: 'outbound' | 'return' | 'internal';
}

export interface Hotel {
  id: string;
  bookingId?: string;
  locator: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  breakfast: boolean;
  guestName: string;
  pricePaid: number;
  priceOriginal: number;
}

export interface CarRental {
  id: string;
  bookingId?: string;
  locator: string;
  company: string;
  carModel: string;
  pickupLocation: string;
  pickupDate: string;
  pickupTime: string;
  returnLocation: string;
  returnDate: string;
  returnTime: string;
  driverName: string;
  pricePaid: number;
  priceOriginal: number;
}

export interface Transfer {
  id: string;
  locator: string;
  type: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  passengerName: string;
  vehicleType: string;
  pricePaid: number;
  priceOriginal: number;
}

export interface CompleteBooking {
  id: string;
  companyId?: string;
  title: string;
  passengerName: string;
  sourceUrl?: string;
  createdAt: string;
  flights: Flight[];
  hotels: Hotel[];
  carRentals: CarRental[];
  transfers?: Transfer[];
  totalPaid: number;
  totalOriginal: number;
}

export interface Company {
  id: string;
  name: string;
  cnpj: string;
  email: string;
  logo_url?: string | null;
  created_at: string;
}

export interface CompanySettings {
  name: string;
  logo: string | null;
}
