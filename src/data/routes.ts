export type Route = {
  id: string
  name: string
  via: string
  stops: string[]
  standardFare?: number | null
  published?: boolean
}

export const initialRoutes: Route[] = [
  {
    id: 'tema-circle-beach-road',
    name: 'Tema → Circle',
    via: 'Beach Road',
    stops: [
      'Tema Community 1', 'Community 2', 'Community 3', 'Community 4',
      'Tema Main Harbour', 'Tema Beach Road Junction', 'Sakumono Junction',
      'Sakumono Estate Junction', 'Sakumono Estate', 'Titanic Beach Turnoff',
      'Sakumono Coastal Road Connection', 'Nungua Approach', 'Nungua',
      'Nungua Market', 'C5', 'Cold Store', 'Brigade', 'A-Life', 'First Junction',
      'Abotsi Anya', 'Mobil', 'Addoemi', 'Laskala', 'Police Station', 'Kofi Annan',
      'Next Door', 'First Gate', 'Second Gate', 'Bush Road', 'Gas', 'Telephone',
      'Total', 'Regimanuel', 'Alonte Bar', 'Dreamland', 'Court', 'Olympia',
      'Sergeant Adjettey', 'Polyclinic', 'Veterinary', 'Barracks', 'Labone',
      'Bridge', 'Danquah First', 'Danquah Second', 'Fire Service',
      'Police Headquarters', 'Sankara', 'GBC', 'Mobil', 'Nima Junction',
      'Paloma', 'Equip', 'Circle Overhead', 'Commercial Bank', 'PTC', 'Curve',
      'Odorna / Circle',
    ],
    standardFare: 57,
    published: true,
  },
  {
    id: 'nungua-circle-beach-road',
    name: 'Nungua → Circle',
    via: 'Beach Road',
    stops: [
      'Nungua', 'Nungua Market', 'C5', 'Cold Store', 'Brigade', 'A-Life',
      'First Junction', 'Abotsi Anya', 'Mobil', 'Addoemi', 'Laskala',
      'Police Station', 'Kofi Annan', 'Next Door', 'First Gate', 'Second Gate',
      'Bush Road', 'Gas', 'Telephone', 'Total', 'Regimanuel', 'Alonte Bar',
      'Dreamland', 'Court', 'Olympia', 'Sergeant Adjettey', 'Polyclinic',
      'Veterinary', 'Barracks', 'Labone', 'Bridge', 'Danquah First',
      'Danquah Second', 'Fire Service', 'Police Headquarters', 'Sankara',
      'GBC', 'Mobil', 'Nima Junction', 'Paloma', 'Equip', 'Circle Overhead',
      'Commercial Bank', 'PTC', 'Curve', 'Odorna / Circle',
    ],
    standardFare: 45,
    published: true,
  },
]
