export type GoogleCalendarEvent = {
  id: string
  summary: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
}

type GoogleTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: GoogleTokenResponse) => void
            error_callback?: (error: { type?: string; message?: string }) => void
          }) => GoogleTokenClient
          revoke: (token: string, callback?: () => void) => void
        }
      }
    }
  }
}

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
const AUTHORIZATION_HINT_KEY = 'salt.google-calendar.authorization-hint.v1'

/** This non-secret hint records that the user previously authorized Calendar.
 * It is never used as proof of a live Google session or API access. */
export function hasPreviousCalendarAuthorization() {
  try { return localStorage.getItem(AUTHORIZATION_HINT_KEY) === 'yes' } catch { return false }
}

export function rememberCalendarAuthorization() {
  try { localStorage.setItem(AUTHORIZATION_HINT_KEY, 'yes') } catch { /* Optional UX hint only. */ }
}

export function clearCalendarAuthorizationHint() {
  try { localStorage.removeItem(AUTHORIZATION_HINT_KEY) } catch { /* Optional UX hint only. */ }
}

export function googleIdentityReady() {
  return Boolean(window.google?.accounts?.oauth2?.initTokenClient)
}

export function requestCalendarAccess(onResponse: (response: GoogleTokenResponse) => void, onError: (message: string) => void) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
  const initTokenClient = window.google?.accounts?.oauth2?.initTokenClient
  if (!clientId) {
    onError('Google OAuth Client ID ayarlanmamış. Proje kökündeki .env.local dosyasına VITE_GOOGLE_CLIENT_ID değerini ekleyip sunucuyu yeniden başlatın.')
    return
  }
  if (!initTokenClient) {
    onError('Google bağlantı kütüphanesi henüz yüklenmedi. Birkaç saniye sonra yeniden deneyin.')
    return
  }
  try {
    const client = initTokenClient({
      client_id: clientId,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: onResponse,
      error_callback: (error) => onError(error.message || 'Google izin penceresi açılamadı. Tarayıcı popup ayarlarını kontrol edip yeniden deneyin.'),
    })
    // Must run directly from the user's click to preserve popup user activation.
    // Reuse the previously granted readonly scope; GIS requests consent only when required.
    client.requestAccessToken()
  } catch {
    onError('Google izin penceresi başlatılamadı. Yeniden deneyin.')
  }
}

export async function fetchCalendarEvents(token: string, timeMin: Date, timeMax: Date): Promise<GoogleCalendarEvent[]> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const eventsById = new Map<string, GoogleCalendarEvent>()
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: '250',
      singleEvents: 'true',
      orderBy: 'startTime',
      timeZone,
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      if (response.status === 401) throw new Error('Google erişim süresi doldu. Takvimi yenileyip yeniden bağlanın.')
      if (response.status === 403) throw new Error('Google Calendar erişimi reddedildi. API etkinliğini, OAuth test kullanıcısını ve calendar.readonly kapsamını kontrol edin.')
      throw new Error(`Google Takvim etkinlikleri alınamadı (HTTP ${response.status}). Biraz sonra yeniden deneyin.`)
    }
    const data = await response.json() as { items?: GoogleCalendarEvent[]; nextPageToken?: string }
    for (const event of data.items ?? []) {
      if (event.id && event.start && event.end) eventsById.set(event.id, event)
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return [...eventsById.values()]
}

export function revokeCalendarAccess(token: string) {
  window.google?.accounts?.oauth2?.revoke(token)
}

export function formatGoogleEventDate(value: string, timeZone?: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day))
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tarih bilgisi yok'
  return new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', ...(timeZone ? { timeZone } : {}) }).format(date)
}

export function formatGoogleEventTime(value: string, timeZone?: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Tüm gün'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(date)
}
