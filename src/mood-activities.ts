import { calendarRangesForDay, inferTaskCategory, localDateKey, suggestedTaskMinutes, type CalendarTimeRange } from './weekly-planner'
import type { GoogleCalendarEvent } from './google-calendar'

export type MoodFeeling = 'iyi' | 'stresli' | 'keyifsiz' | 'yorgun' | 'sıkılmış' | 'endişeli'
export type MoodEnergy = 'düşük' | 'orta' | 'yüksek'
export type MoodSocial = 'tek başıma' | 'sosyal' | 'fark etmez'
export type MoodAnswers = { feeling?: MoodFeeling; energy?: MoodEnergy; freeTime?: '15' | '30' | '60' | '120'; social?: MoodSocial }
export type MoodSuggestion = { id: string; title: string; minutes: number; cost?: number; detail: string; reason: string; location: string }
export type MoodSlot = { date: string; startMinute: number; minutes: number; durationEstimated: boolean }
export type MoodScheduledItem = { date: string; time: string; durationMinutes?: number }
export type MoodTask = { id: string; title: string; detail: string; priority: boolean; completed: boolean; estimatedMinutes?: number; planCategory?: 'study' | 'assignment' | 'hobby' | 'habit' | 'rest' }

const DAY_START = 8 * 60
const DAY_END = 22 * 60
const MIN_GAP = 20

function parseTime(value: string) {
  const match = /(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function mergeRanges(ranges: CalendarTimeRange[]) {
  const sorted = ranges.filter((range) => Number.isFinite(range.startMinute) && Number.isFinite(range.endMinute) && range.endMinute > range.startMinute).sort((a, b) => a.startMinute - b.startMinute)
  return sorted.reduce<CalendarTimeRange[]>((merged, range) => {
    const previous = merged.at(-1)
    if (previous && range.startMinute <= previous.endMinute) previous.endMinute = Math.max(previous.endMinute, range.endMinute)
    else merged.push({ ...range })
    return merged
  }, [])
}

export function findCurrentMoodSlot(now: Date, schedule: MoodScheduledItem[], tasks: MoodTask[], googleEvents: GoogleCalendarEvent[]): MoodSlot | null {
  const date = localDateKey(now)
  const startNow = now.getHours() * 60 + now.getMinutes()
  if (startNow >= DAY_END) return null
  const start = Math.max(DAY_START, Math.ceil(startNow / 5) * 5)
  const occupied: CalendarTimeRange[] = [...calendarRangesForDay(googleEvents, date)]
  for (const event of schedule.filter((item) => item.date === date)) {
    const minute = parseTime(event.time)
    if (minute === null) continue
    occupied.push({ startMinute: minute, endMinute: Math.min(DAY_END, minute + (event.durationMinutes || 60)) })
  }
  for (const task of tasks.filter((item) => !item.completed)) {
    const minute = parseTime(task.detail)
    if (minute === null) continue
    const duration = task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes : inferTaskCategory(task) === 'assignment' ? 60 : suggestedTaskMinutes(task)
    occupied.push({ startMinute: minute, endMinute: Math.min(DAY_END, minute + duration) })
  }
  const ranges = mergeRanges(occupied)
  let cursor = start
  for (const range of ranges) {
    if (range.endMinute <= cursor) continue
    if (range.startMinute - cursor >= MIN_GAP) return { date, startMinute: cursor, minutes: range.startMinute - cursor, durationEstimated: schedule.some((event) => event.date === date && parseTime(event.time) !== null && event.durationMinutes === undefined) }
    cursor = Math.max(cursor, range.endMinute)
    if (cursor >= DAY_END) return null
  }
  return DAY_END - cursor >= MIN_GAP ? { date, startMinute: cursor, minutes: DAY_END - cursor, durationEstimated: schedule.some((event) => event.date === date && parseTime(event.time) !== null && event.durationMinutes === undefined) } : null
}

const activityCatalog: MoodSuggestion[] = [
  { id: 'breathing', title: 'Kısa nefes molası', minutes: 5, detail: 'Rahat bir yerde otur; birkaç dakika boyunca nefesini yavaşça takip et.', reason: 'Kısa bir duraklama, günün temposuna ara vermek için uygun olabilir.', location: 'Bulunduğun yer' },
  { id: 'music', title: 'Sevdiğin bir parçayı dinle', minutes: 10, detail: 'Telefonu bir kenara bırakıp tek bir parçaya odaklan.', reason: 'Düşük eforlu ve kısa bir mola.', location: 'Bulunduğun yer' },
  { id: 'stretch', title: 'Hafifçe esne', minutes: 10, detail: 'Kendini zorlamadan omuzlarını ve bacaklarını hareket ettir.', reason: 'Kısa süreli, ekipman gerektirmeyen bir hareket molası.', location: 'Bulunduğun yer' },
  { id: 'walk', title: 'Kısa bir yürüyüş yap', minutes: 15, detail: 'Yakın ve güvenli bir rotada kısa bir tur at.', reason: 'Biraz hareket etmek ve ortam değiştirmek isteyebilirsin.', location: 'Yakın çevre' },
  { id: 'journal', title: 'Aklındakileri not et', minutes: 15, detail: 'Aklında kalanları serbestçe yaz; paylaşman veya saklaman gerekmez.', reason: 'Düşüncelerine kısa bir alan açan sakin bir seçenek.', location: 'Bulunduğun yer' },
  { id: 'call-friend', title: 'Bir arkadaşını ara', minutes: 15, detail: 'Kısa bir telefon konuşması için müsait bir arkadaşına ulaş.', reason: 'Sosyal bir mola, tercihine uygun olabilir.', location: 'Bulunduğun yer' },
  { id: 'hobby', title: 'Sakin bir hobiyle ilgilen', minutes: 20, detail: 'Kitap, çizim, örgü veya sevdiğin başka küçük bir uğraş seç.', reason: 'Düşük baskılı, kendi hızında yapabileceğin bir etkinlik.', location: 'Bulunduğun yer' },
  { id: 'coffee', title: 'Bir arkadaşla kahve molası', minutes: 30, cost: 180, detail: 'Yakındaki bir yerde kısa bir buluşma planla. Tutar yalnızca yaklaşık demo tahminidir.', reason: 'Sosyal vakit tercihine uyabilir; gerçek fiyat mekâna göre değişir.', location: 'Yakın kafe' },
]

function reasonFor(activity: MoodSuggestion, answers: MoodAnswers) {
  if (answers.feeling === 'stresli' || answers.feeling === 'endişeli') return activity.id === 'breathing' || activity.id === 'music' || activity.id === 'walk' ? 'Stresli veya endişeli hissettiğini paylaştın; bu kısa ve isteğe bağlı mola uygun olabilir.' : activity.reason
  if (answers.energy === 'düşük' || answers.feeling === 'yorgun') return ['breathing', 'music', 'hobby', 'journal'].includes(activity.id) ? 'Düşük enerjine göre daha sakin ve az eforlu bir seçenek.' : activity.reason
  if (answers.social === 'sosyal') return ['call-friend', 'coffee', 'walk'].includes(activity.id) ? 'Sosyal vakit tercihine uyuyor.' : activity.reason
  if (answers.feeling === 'sıkılmış') return ['walk', 'hobby', 'call-friend', 'coffee'].includes(activity.id) ? 'Ortam veya etkinlik değiştirme isteğine uyabilir.' : activity.reason
  return activity.reason
}

export function createMoodSuggestions(answers: MoodAnswers, availableMinutes: number, monthlyBudgetRemaining: number): MoodSuggestion[] {
  const chosenTime = answers.freeTime ? Number(answers.freeTime) : availableMinutes
  const maxDuration = Math.max(0, Math.min(availableMinutes, chosenTime))
  let candidates = activityCatalog.filter((activity) => activity.minutes <= maxDuration && (activity.cost === undefined || activity.cost <= monthlyBudgetRemaining))
  const affinity = (item: MoodSuggestion) => {
    let score = 0
    if ((answers.feeling === 'stresli' || answers.feeling === 'endişeli') && ['breathing', 'music', 'walk'].includes(item.id)) score += 4
    if ((answers.energy === 'düşük' || answers.feeling === 'yorgun' || answers.feeling === 'keyifsiz') && ['breathing', 'music', 'journal', 'hobby'].includes(item.id)) score += 4
    if (answers.energy === 'yüksek' && ['walk', 'hobby'].includes(item.id)) score += 3
    if (answers.social === 'sosyal' && ['call-friend', 'coffee', 'walk'].includes(item.id)) score += 6
    if (answers.social === 'tek başıma' && ['breathing', 'music', 'journal', 'hobby'].includes(item.id)) score += 6
    if (answers.feeling === 'sıkılmış' && ['walk', 'hobby', 'call-friend', 'coffee'].includes(item.id)) score += 3
    return score
  }
  candidates = candidates.sort((a, b) => affinity(b) - affinity(a) || a.minutes - b.minutes)
  return candidates.slice(0, Math.max(3, Math.min(5, candidates.length))).map((item) => ({ ...item, reason: reasonFor(item, answers) }))
}

export function formatMoodSlotTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function isToday(date: string, now = new Date()) { return date === localDateKey(now) }
