import type { GoogleCalendarEvent } from './google-calendar'

export type PlanCategory = 'study' | 'assignment' | 'hobby' | 'habit' | 'rest'
export type PlannerTask = { id: string; title: string; detail: string; priority: boolean; completed: boolean; estimatedMinutes?: number; planCategory?: PlanCategory }
export type PlannerHabit = { id: string; title: string; done: boolean }
export type WeekPlanBlock = {
  id: string
  sourceId: string
  title: string
  category: PlanCategory
  date: string
  startTime: string
  durationMinutes: number
  wasEstimated: boolean
}
export type CalendarTimeRange = { startMinute: number; endMinute: number }

export const CATEGORY_LABELS: Record<PlanCategory, string> = {
  study: 'Ders çalışma', assignment: 'Ödev / proje', hobby: 'Hobi', habit: 'Alışkanlık', rest: 'Dinlenme / boş zaman',
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function getMonday(date = new Date()) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}

export function getWeekDays(monday: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)
    return { date: day, key: localDateKey(day), label: new Intl.DateTimeFormat('tr-TR', { weekday: 'long' }).format(day), shortDate: new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(day) }
  })
}

export function getWeekBounds(monday: Date) {
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate())
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  return { start, end }
}

export function inferTaskCategory(task: PlannerTask): PlanCategory {
  if (task.planCategory) return task.planCategory
  const text = `${task.title} ${task.detail}`.toLocaleLowerCase('tr-TR')
  if (/hobi|piyano|gitar|resim|seramik|spor|yürüyüş/.test(text)) return 'hobby'
  if (/ders|not|çalış|sınav|okuma|kitap/.test(text)) return 'study'
  return 'assignment'
}

export function suggestedTaskMinutes(task: PlannerTask) {
  if (Number.isFinite(task.estimatedMinutes) && (task.estimatedMinutes ?? 0) > 0) return Math.min(240, Math.max(5, task.estimatedMinutes as number))
  return inferTaskCategory(task) === 'assignment' ? 60 : 45
}

function minuteOfDay(date: Date) { return date.getHours() * 60 + date.getMinutes() }
function dateFromKey(key: string) { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day) }

export function calendarRangesForDay(events: GoogleCalendarEvent[], dayKey: string): CalendarTimeRange[] {
  const dayStart = dateFromKey(dayKey)
  const nextDay = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1)
  const dayStartMs = dayStart.getTime()
  const nextDayMs = nextDay.getTime()
  const ranges: CalendarTimeRange[] = []
  for (const event of events) {
    if (event.start.date && event.end.date) {
      if (dayKey >= event.start.date && dayKey < event.end.date) ranges.push({ startMinute: 0, endMinute: 1440 })
      continue
    }
    if (!event.start.dateTime || !event.end.dateTime) continue
    const start = new Date(event.start.dateTime).getTime()
    const end = new Date(event.end.dateTime).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= dayStartMs || start >= nextDayMs) continue
    const clippedStart = Math.max(start, dayStartMs)
    const clippedEnd = Math.min(end, nextDayMs)
    const startDate = new Date(clippedStart)
    const endDate = new Date(clippedEnd)
    ranges.push({ startMinute: clippedStart === dayStartMs ? 0 : minuteOfDay(startDate), endMinute: clippedEnd === nextDayMs ? 1440 : minuteOfDay(endDate) || 1440 })
  }
  return ranges.sort((a, b) => a.startMinute - b.startMinute)
}

export function blockRange(block: WeekPlanBlock): CalendarTimeRange {
  const [hour, minute] = block.startTime.split(':').map(Number)
  const startMinute = hour * 60 + minute
  return { startMinute, endMinute: startMinute + block.durationMinutes }
}

export function hasPlanningConflict(block: WeekPlanBlock, events: GoogleCalendarEvent[], otherBlocks: WeekPlanBlock[]) {
  const range = blockRange(block)
  if (!Number.isFinite(range.startMinute) || range.startMinute < 8 * 60 || range.endMinute > 22 * 60) return true
  const collides = (other: CalendarTimeRange) => range.startMinute < other.endMinute && other.startMinute < range.endMinute
  if (calendarRangesForDay(events, block.date).some(collides)) return true
  return otherBlocks.filter((item) => item.date === block.date && item.id !== block.id).some((item) => collides(blockRange(item)))
}

function findSlot(duration: number, occupied: CalendarTimeRange[]): number | null {
  let cursor = 9 * 60
  const dayEnd = 21 * 60
  for (const range of [...occupied].sort((a, b) => a.startMinute - b.startMinute)) {
    if (range.endMinute <= cursor) continue
    if (range.startMinute - cursor >= duration) return cursor
    cursor = Math.max(cursor, range.endMinute)
    if (cursor >= dayEnd) return null
  }
  return dayEnd - cursor >= duration ? cursor : null
}

function timeLabel(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }

export function createWeeklySuggestions(monday: Date, events: GoogleCalendarEvent[], tasks: PlannerTask[], habits: PlannerHabit[], existingBlocks: WeekPlanBlock[] = []): WeekPlanBlock[] {
  const todayKey = localDateKey(new Date())
  const taskQueue = tasks.filter((task) => !task.completed).sort((a, b) => Number(b.priority) - Number(a.priority)).map((task) => ({
    sourceId: task.id, title: task.title, category: inferTaskCategory(task), duration: suggestedTaskMinutes(task), wasEstimated: !Number.isFinite(task.estimatedMinutes) || (task.estimatedMinutes ?? 0) < 1,
  }))
  const suggestions: WeekPlanBlock[] = []
  for (const day of getWeekDays(monday)) {
    if (day.key < todayKey) continue
    const occupied = [...calendarRangesForDay(events, day.key), ...existingBlocks.filter((block) => block.date === day.key).map(blockRange)]
    let dayMinutes = 0
    let taskCount = 0
    const place = (sourceId: string, title: string, category: PlanCategory, duration: number, wasEstimated: boolean) => {
      if (dayMinutes + duration > 300) return false
      const start = findSlot(duration, occupied)
      if (start === null) return false
      const item: WeekPlanBlock = { id: `${sourceId}-${day.key}`, sourceId, title, category, date: day.key, startTime: timeLabel(start), durationMinutes: duration, wasEstimated }
      suggestions.push(item)
      occupied.push({ startMinute: start, endMinute: start + duration })
      dayMinutes += duration
      return true
    }

    // Leave space for regular routines while giving high-priority tasks the first opening.
    const firstTask = taskQueue[0]
    if (firstTask && place(firstTask.sourceId, firstTask.title, firstTask.category, firstTask.duration, firstTask.wasEstimated)) {
      taskQueue.shift()
      taskCount++
    }
    for (const habit of habits) if (day.key !== todayKey || !habit.done) place(`habit-${habit.id}-${day.key}`, habit.title, 'habit', 20, false)
    while (taskQueue.length && taskCount < 2) {
      const task = taskQueue[0]
      if (!place(task.sourceId, task.title, task.category, task.duration, task.wasEstimated)) break
      taskQueue.shift()
      taskCount++
    }

    // Reserve a small recovery/free-time block in a remaining half-hour opening.
    const restStart = findSlot(30, occupied)
    if (restStart !== null) place(`rest-${day.key}`, 'Dinlenme / boş zaman', 'rest', 30, false)
  }
  return suggestions
}
