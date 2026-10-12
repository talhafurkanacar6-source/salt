export type DemoTransportStep = {
  mode: 'Metro' | 'Metrobüs' | 'Yürüyüş'
  from: string
  to: string
  minutes: number
  transfer?: string
}

export type DemoTransportRoute = {
  id: string
  label: string
  direction: 'outbound' | 'return'
  origin: string
  destination: string
  eventTime: string
  durationMinutes: number
  bufferMinutes: number
  steps: DemoTransportStep[]
  caveat: string
}

export const OFFICIAL_TRANSPORT_LINKS = [
  { label: 'İBB Şehir Haritası', url: 'https://sehirharitasiapi.ibb.gov.tr/' },
  { label: 'Metro İstanbul', url: 'https://metro.istanbul/' },
  { label: 'İETT', url: 'https://iett.istanbul/' },
] as const

// Illustrative route and durations only. These are not sourced from live or verified transit data.
export const ISTANBUL_DEMO_ROUTES: Record<string, DemoTransportRoute> = {
  'umraniye-zorlu': {
    id: 'umraniye-zorlu',
    label: 'Zorlu Center toplantısı',
    direction: 'outbound',
    origin: 'Ümraniye Çakmak Metro',
    destination: 'Zorlu Center, Beşiktaş',
    eventTime: '11:00',
    durationMinutes: 75,
    bufferMinutes: 10,
    steps: [
      { mode: 'Metro', from: 'Çakmak Metro', to: 'Altunizade', minutes: 40, transfer: 'Altunizade’de metrobüse aktarma' },
      { mode: 'Metrobüs', from: 'Altunizade', to: 'Zincirlikuyu', minutes: 20, transfer: 'Zincirlikuyu’da in; Zorlu Center’a yürüyüşe geç' },
      { mode: 'Yürüyüş', from: 'Zincirlikuyu', to: 'Zorlu Center', minutes: 15 },
    ],
    caveat: 'Bu güzergâh ve süreler yalnızca ürün demosu için yazılmış örneklerdir; güncel resmî sefer, aktarma veya trafik bilgisi olarak doğrulanmamıştır.',
  },
  'zorlu-umraniye-return': {
    id: 'zorlu-umraniye-return',
    label: '18:00 eve dönüş hedefi',
    direction: 'return',
    origin: 'Zorlu Center, Beşiktaş',
    destination: 'Ümraniye Çakmak Metro (örnek rota sonu)',
    eventTime: '18:00',
    durationMinutes: 75,
    bufferMinutes: 10,
    steps: [
      { mode: 'Yürüyüş', from: 'Zorlu Center', to: 'Zincirlikuyu', minutes: 15, transfer: 'Zincirlikuyu’da metrobüse aktarma' },
      { mode: 'Metrobüs', from: 'Zincirlikuyu', to: 'Altunizade', minutes: 20, transfer: 'Altunizade’de metroya aktarma' },
      { mode: 'Metro', from: 'Altunizade', to: 'Çakmak Metro', minutes: 40 },
    ],
    caveat: 'Bu dönüş de yalnızca örnek rotadır. Çakmak Metro ev adresi değildir; ev adresi ve kapıya kadar olan son bölüm eksik olduğu için 18:00 hedefinin mümkünlüğü doğrulanamaz.',
  },
}
