export type PreviewRide = {
  id: string
  vehicle: string
  driver: string
  departure: string
  seats: number
  fare?: number
  routeIds?: string[]
}

const previewRouteIds = ['tema-circle-beach-road', 'nungua-circle-beach-road']

export const previewRides: PreviewRide[] = [
  { id: 'ride-morning-1', vehicle: 'Toyota Coaster', driver: 'Kwame Mensah', departure: '6:30 AM', seats: 8, routeIds: previewRouteIds },
  { id: 'ride-morning-2', vehicle: 'Toyota Coaster', driver: 'Ama Boateng', departure: '7:15 AM', seats: 5, routeIds: previewRouteIds },
  { id: 'ride-evening-1', vehicle: 'Toyota Coaster', driver: 'Kofi Asare', departure: '5:30 PM', seats: 6, routeIds: previewRouteIds },
]

export type DriverTrip = {
  id: string
  route: string
  date: string
  departure: string
  code: string
  passengers: number
  status: 'Assigned' | 'In progress' | 'Completed'
}

export const initialDriverTrips: DriverTrip[] = [
  { id: 'trip-1', route: 'Nungua → Circle via Beach Road', date: 'Today', departure: '6:30 AM', code: 'SS-2401', passengers: 18, status: 'Assigned' },
  { id: 'trip-2', route: 'Tema → Circle via Beach Road', date: 'Today', departure: '5:30 PM', code: 'SS-2402', passengers: 21, status: 'Assigned' },
]

export const passengerManifest = [
  { name: 'Adwoa Owusu', pickup: 'Nungua Market', code: 'SS-2401' },
  { name: 'Yaw Asante', pickup: 'Sakumono Junction', code: 'SS-2401' },
  { name: 'Esi Nyarko', pickup: 'Labone', code: 'SS-2401' },
]

export const adminPreviewRows = {
  passengers: [
    ['Ama Serwaa', 'ama.serwaa@example.test', 'Verified'],
    ['Kojo Antwi', 'kojo.antwi@example.test', 'Verified'],
    ['Nana Akua', 'nana.aku@example.test', 'Pending'],
  ],
  drivers: [
    ['Kwame Mensah', 'Toyota Coaster · GR 4821-24', 'Approved'],
    ['Ama Boateng', 'Toyota Coaster · GS 2108-23', 'Pending review'],
    ['Kofi Asare', 'Toyota Coaster · GT 6630-25', 'Approved'],
  ],
  vehicles: [
    ['GR 4821-24', 'Toyota Coaster', 'Approved'],
    ['GS 2108-23', 'Toyota Coaster', 'Insurance review'],
    ['GT 6630-25', 'Toyota Coaster', 'Approved'],
  ],
  bookings: [
    ['SS-2401', 'Adwoa Owusu', 'Nungua → Circle', 'Confirmed'],
    ['SS-2402', 'Yaw Asante', 'Tema → Circle', 'Confirmed'],
    ['SS-2403', 'Nana Akua', 'Nungua → Circle', 'Pending'],
  ],
  payments: [
    ['PAY-301', 'SS-2401', 'GH₵ 35.00', 'Preview paid'],
    ['PAY-302', 'SS-2402', 'GH₵ 35.00', 'Preview paid'],
    ['PAY-303', 'SS-2403', 'GH₵ 35.00', 'Preview pending'],
  ],
}
