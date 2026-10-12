import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { ISTANBUL_DEMO_ROUTES, OFFICIAL_TRANSPORT_LINKS, type DemoTransportRoute } from './data/istanbul-transport-demo'
import { clearCalendarAuthorizationHint, fetchCalendarEvents, formatGoogleEventDate, formatGoogleEventTime, googleIdentityReady, hasPreviousCalendarAuthorization, rememberCalendarAuthorization, requestCalendarAccess, revokeCalendarAccess, type GoogleCalendarEvent } from './google-calendar'
import { blockRange, calendarRangesForDay, CATEGORY_LABELS, createWeeklySuggestions, getMonday, getWeekBounds, getWeekDays, hasPlanningConflict, inferTaskCategory, localDateKey, type PlanCategory, type WeekPlanBlock } from './weekly-planner'
import { createMoodSuggestions, findCurrentMoodSlot, formatMoodSlotTime, isToday, type MoodAnswers, type MoodSlot, type MoodSuggestion } from './mood-activities'

type Section = 'Today' | 'Haftalık Plan' | 'Inbox' | 'Life' | 'Profil'
type UserProfile = {
  displayName: string
  lifeStatus: 'student' | 'working' | 'both' | 'neither'
  schoolName: string
  fieldOfStudy: string
  studyYear: string
  workplace: string
  jobTitle: string
  interests: string
  focusGoal: string
}
type Task = { id: string; title: string; detail: string; priority: boolean; completed: boolean; estimatedMinutes?: number; planCategory?: PlanCategory }
type Candidate = { id: string; title: string; approved: boolean }
type Expense = { id: string; title: string; category: string; amount: number; date: string }
type Habit = { id: string; title: string; done: boolean }
type ScheduleEvent = {
  id: string; title: string; date: string; time: string; location: string; origin: string
  completed: boolean; transportRequested: boolean; routeId?: string; demoDate?: string; durationMinutes?: number
  plannedBudget?: number; actualSpend?: number; actualExpenseId?: string
}

const sections: { name: Section; icon: string }[] = [
  { name: 'Today', icon: '◷' }, { name: 'Haftalık Plan', icon: '▦' }, { name: 'Inbox', icon: '⌑' }, { name: 'Life', icon: '◌' }, { name: 'Profil', icon: '○' },
]
const initialTasks: Task[] = [
  { id: 'task-bio', title: 'Biyoloji laboratuvar raporunu bitir', detail: 'Biyoloji · 11:30', priority: true, completed: false },
  { id: 'task-stats', title: 'İstatistik ders notlarını gözden geçir', detail: 'İstatistik · 14:00', priority: false, completed: false },
  { id: 'task-market', title: 'Market alışverişi', detail: 'Kişisel · Bugün', priority: false, completed: true },
]
const samplePlanDate = localDateKey()
const initialSchedule: ScheduleEvent[] = [
  { id: 'routine-wake', title: 'Uyanma rutini', date: samplePlanDate, time: '08:30', location: 'Ev', origin: '', completed: false, transportRequested: false },
  { id: 'meeting-zorlu', title: "Zorlu Center'da toplantı", date: samplePlanDate, time: '11:00', location: 'Zorlu Center, Beşiktaş', origin: 'Ümraniye Çakmak Metro', completed: false, transportRequested: true, routeId: 'umraniye-zorlu', demoDate: samplePlanDate },
  { id: 'coffee-friends', title: 'Arkadaşlarla kahve', date: samplePlanDate, time: '14:45', location: 'Zorlu Center (demo konumu)', origin: '', completed: false, transportRequested: false, plannedBudget: 450 },
  { id: 'home-target', title: 'Evde olma hedefi', date: samplePlanDate, time: '18:00', location: '', origin: 'Zorlu Center, Beşiktaş', completed: false, transportRequested: true, routeId: 'zorlu-umraniye-return', demoDate: samplePlanDate },
  { id: 'meeting-notes', title: "Bugünkü toplantının notlarını incele", date: samplePlanDate, time: '20:00', location: 'Ev', origin: '', completed: false, transportRequested: false },
]
const initialExpenses: Expense[] = [
  { id: 'exp-coffee', title: 'Kahve ve atıştırmalık', category: 'Yeme içme', amount: 145, date: localDateKey() },
  { id: 'exp-transit', title: 'Ulaşım kartı', category: 'Ulaşım', amount: 320, date: localDateKey() },
]
const initialHabits: Habit[] = [
  { id: 'habit-water', title: 'Su içme hedefi', done: false },
  { id: 'habit-reading', title: '20 dakika kitap oku', done: false },
  { id: 'habit-walk', title: 'Kısa bir yürüyüş yap', done: true },
]
const MOOD_PROMPTED_DATE_KEY = 'salt.mood-checkin.prompted-date.v4'
function getMoodPromptedDate() { try { return localStorage.getItem(MOOD_PROMPTED_DATE_KEY) ?? '' } catch { return '' } }
function rememberMoodPromptedDate(date: string) { try { localStorage.setItem(MOOD_PROMPTED_DATE_KEY, date) } catch { /* In-memory state still prevents repeats this session. */ } }

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : (JSON.parse(stored) as T)
    } catch { return initial }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled or full. */ }
  }, [key, value])
  return [value, setValue] as const
}

function makeId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }
function formatPlanDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(parsed)
}
function shiftTime(value: string, minutes: number) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const total = Number(match[1]) * 60 + Number(match[2]) - minutes
  const wrapped = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}
function extractCandidates(text: string): Candidate[] {
  const items = text.split(/\n|[.!?]+/).map((part) => part.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((part) => part.length > 2)
  return [...new Set(items)].map((title) => ({ id: makeId(), title: title.charAt(0).toLocaleUpperCase('tr-TR') + title.slice(1), approved: false }))
}

function App() {
  const [active, setActive] = useState<Section>('Today')
  const [tasks, setTasks] = useStoredState<Task[]>('salt.tasks.v1', initialTasks)
  const [budget, setBudget] = useStoredState<number>('salt.budget.v1', 8000)
  const [expenses, setExpenses] = useStoredState<Expense[]>('salt.expenses.v1', initialExpenses)
  const [habits, setHabits] = useStoredState<Habit[]>('salt.habits.v1', initialHabits)
  const [inboxText, setInboxText] = useStoredState<string>('salt.inbox-text.v1', '')
  const [candidates, setCandidates] = useStoredState<Candidate[]>('salt.inbox-candidates.v1', [])
  const [schedule, setSchedule] = useStoredState<ScheduleEvent[]>('salt.schedule.v1', initialSchedule)
  const [profile, setProfile] = useStoredState<UserProfile | null>('salt.profile.v1', null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem('salt.profile.v1') ?? 'null') as Partial<UserProfile> | null
      return !value?.displayName?.trim() || !value?.lifeStatus
    } catch { return true }
  })
  const [selectedDate, setSelectedDate] = useStoredState<string>('salt.schedule-day.v1', samplePlanDate)
  const [taskEditor, setTaskEditor] = useState<Task | null | 'new'>(null)
  const [eventEditor, setEventEditor] = useState<ScheduleEvent | null | 'new'>(null)
  const [expenseEditor, setExpenseEditor] = useState(false)
  const [coffeeExpenseEventId, setCoffeeExpenseEventId] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(() => getMonday())
  const [calendarLibraryReady, setCalendarLibraryReady] = useState(googleIdentityReady())
  const [calendarAccessToken, setCalendarAccessToken] = useState<string | null>(null)
  const [calendarExpiresAt, setCalendarExpiresAt] = useState<number | null>(null)
  const [calendarTokenExpired, setCalendarTokenExpired] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [calendarNeedsReconnect, setCalendarNeedsReconnect] = useState(hasPreviousCalendarAuthorization)
  const [calendarEvents, setCalendarEvents] = useState<GoogleCalendarEvent[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarMessage, setCalendarMessage] = useState(() => hasPreviousCalendarAuthorization()
    ? 'Bu tarayıcıda Google Takvim daha önce yetkilendirilmiş. Güvenlik nedeniyle erişim anahtarı yenilemede saklanmadı; etkinlikleri yüklemek için Google Takvim’e yeniden bağlan.'
    : '')
  const [calendarMessageIsError, setCalendarMessageIsError] = useState(hasPreviousCalendarAuthorization)
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0)
  const [weeklyDraft, setWeeklyDraft] = useState<WeekPlanBlock[]>([])
  const [weeklyMessage, setWeeklyMessage] = useState('')
  const [planBlocks, setPlanBlocks] = useStoredState<WeekPlanBlock[]>('salt.weekly-plan.v1', [])
  const [moodPromptedDate, setMoodPromptedDate] = useState(getMoodPromptedDate)
  const [moodSlot, setMoodSlot] = useState<MoodSlot | null>(null)
  const [moodAvailabilityMessage, setMoodAvailabilityMessage] = useState('')
  const monthKey = localDateKey().slice(0, 7)
  const monthlyExpenseCount = expenses.filter((expense) => expense.date.startsWith(monthKey)).length
  const spent = useMemo(() => expenses.filter((expense) => expense.date.startsWith(monthKey)).reduce((sum, expense) => sum + (Number.isFinite(expense.amount) ? expense.amount : 0), 0), [expenses, monthKey])
  const remaining = budget - spent
  const date = formatPlanDate(selectedDate)
  const dayEvents = useMemo(() => schedule.filter((event) => event.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)), [schedule, selectedDate])
  const weekStartKey = localDateKey(weekStart)
  const weekBounds = useMemo(() => getWeekBounds(weekStart), [weekStartKey])
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStartKey])

  useEffect(() => {
    if (calendarLibraryReady) return
    const interval = window.setInterval(() => {
      if (googleIdentityReady()) {
        setCalendarLibraryReady(true)
        window.clearInterval(interval)
      }
    }, 200)
    return () => window.clearInterval(interval)
  }, [calendarLibraryReady])

  useEffect(() => {
    if (!calendarAccessToken || !calendarExpiresAt) return
    const timeout = window.setTimeout(() => {
      setCalendarExpiresAt(null)
      setCalendarTokenExpired(true)
      setCalendarAccessToken(null)
      setCalendarConnected(false)
      setCalendarNeedsReconnect(true)
      setCalendarEvents([])
      setCalendarMessage('Google erişim süresi doldu. Bağlantı artık etkin değil; etkinlikleri yeniden yüklemek için Google Takvim’e yeniden bağlanın.')
      setCalendarMessageIsError(true)
    }, Math.max(0, calendarExpiresAt - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [calendarAccessToken, calendarExpiresAt])

  useEffect(() => {
    if (!calendarAccessToken || calendarTokenExpired) return
    let cancelled = false
    setCalendarLoading(true)
    fetchCalendarEvents(calendarAccessToken, weekBounds.start, weekBounds.end).then((events) => {
      if (cancelled) return
      setCalendarEvents(events)
      setCalendarMessage(events.length ? `${events.length} Google Takvim etkinliği yüklendi.` : 'Bu haftada Google Takvim etkinliği yok.')
      setCalendarMessageIsError(false)
    }).catch((error: unknown) => {
      if (cancelled) return
      setCalendarEvents([])
      setCalendarMessage(error instanceof Error ? error.message : 'Google Takvim okunamadı. Yeniden deneyin.')
      setCalendarMessageIsError(true)
      if (error instanceof Error && error.message.includes('erişim süresi doldu')) {
        setCalendarTokenExpired(true)
        setCalendarExpiresAt(null)
        setCalendarAccessToken(null)
        setCalendarConnected(false)
        setCalendarNeedsReconnect(true)
      }
    }).finally(() => { if (!cancelled) setCalendarLoading(false) })
    return () => { cancelled = true }
  }, [calendarAccessToken, calendarTokenExpired, weekBounds, calendarRefreshKey])

  useEffect(() => {
    const tryOpeningCheckIn = () => {
      const now = new Date()
      const today = localDateKey(now)
      if (active !== 'Today' || selectedDate !== today || moodSlot || profileEditorOpen || moodPromptedDate === today || calendarLoading) return
      if (taskEditor !== null || eventEditor !== null || expenseEditor || coffeeExpenseEventId !== null) return
      if (getMoodPromptedDate() === today) { setMoodPromptedDate(today); return }
      const slot = findCurrentMoodSlot(now, schedule, tasks, calendarEvents)
      if (!slot) return
      // Persist only that today's optional prompt was shown, never the answers or feeling.
      rememberMoodPromptedDate(today)
      setMoodPromptedDate(today)
      setMoodSlot(slot)
    }
    const initialTimer = window.setTimeout(tryOpeningCheckIn, 900)
    const interval = window.setInterval(tryOpeningCheckIn, 60_000)
    return () => { window.clearTimeout(initialTimer); window.clearInterval(interval) }
  }, [active, selectedDate, moodSlot, profileEditorOpen, moodPromptedDate, calendarLoading, calendarEvents, schedule, tasks, taskEditor, eventEditor, expenseEditor, coffeeExpenseEventId])

  function connectGoogleCalendar() {
    setCalendarLoading(true)
    setCalendarMessage('Google Takvim bağlantısı başlatılıyor…')
    setCalendarMessageIsError(false)
    const popupTimeout = window.setTimeout(() => {
      setCalendarLoading(false)
      setCalendarMessage('Google izin penceresinden yanıt alınamadı. Popup engelini kaldırıp yeniden deneyin; gerekirse pencereyi kapatın.')
      setCalendarMessageIsError(true)
    }, 60_000)
    requestCalendarAccess((response) => {
      window.clearTimeout(popupTimeout)
      if (response.error) {
        setCalendarMessage(response.error === 'access_denied' ? 'Google Takvim izni verilmedi. Etkinlikleri görmek için izin vererek yeniden deneyin.' : response.error_description || 'Google Takvim izni alınamadı. Yeniden deneyin.')
        setCalendarMessageIsError(true)
        setCalendarLoading(false)
        return
      }
      if (!response.access_token) {
        setCalendarMessage('Google erişim anahtarı döndürmedi. Yeniden deneyin.')
        setCalendarMessageIsError(true)
        setCalendarLoading(false)
        return
      }
      setCalendarAccessToken(response.access_token)
      setCalendarExpiresAt(Date.now() + (response.expires_in ?? 3600) * 1000)
      setCalendarTokenExpired(false)
      setCalendarConnected(true)
      setCalendarNeedsReconnect(false)
      setCalendarEvents([])
      rememberCalendarAuthorization()
    }, (error) => {
      window.clearTimeout(popupTimeout)
      setCalendarMessage(error)
      setCalendarMessageIsError(true)
      setCalendarLoading(false)
    })
  }

  function refreshGoogleCalendar() {
    if (!calendarAccessToken || calendarTokenExpired) {
      connectGoogleCalendar()
      return
    }
    setCalendarMessage('Google Takvim yenileniyor…')
    setCalendarMessageIsError(false)
    setCalendarRefreshKey((value) => value + 1)
  }

  function disconnectGoogleCalendar() {
    if (calendarAccessToken) revokeCalendarAccess(calendarAccessToken)
    setCalendarAccessToken(null)
    setCalendarExpiresAt(null)
    setCalendarTokenExpired(false)
    setCalendarConnected(false)
    setCalendarNeedsReconnect(false)
    setCalendarEvents([])
    clearCalendarAuthorizationHint()
    setCalendarMessage('Google Takvim bağlantısı kesildi. Gösterilen Google etkinlikleri temizlendi.')
    setCalendarMessageIsError(false)
  }

  function generateWeeklyPlan() {
    if (!calendarConnected) {
      setWeeklyMessage('Önce Google Takvim’i bağla; etkinlik olmadan çakışmasız plan oluşturamayız.')
      return
    }
    if (calendarLoading || calendarTokenExpired) {
      setWeeklyMessage(calendarTokenExpired ? 'Takvim izninin süresi doldu. Yeniden bağlandıktan sonra planı oluştur.' : 'Takvim yüklenirken plan oluşturulamaz.')
      return
    }
    const existingSources = new Set(planBlocks.map((block) => `${block.sourceId}|${block.date}`))
    const drafts = createWeeklySuggestions(weekStart, calendarEvents, tasks, habits, planBlocks).filter((block) => !existingSources.has(`${block.sourceId}|${block.date}`))
    setWeeklyDraft(drafts)
    setWeeklyMessage(drafts.length ? `${drafts.length} öneri hazır. Takvim etkinlikleri sabit bırakıldı; önerileri gözden geçirip onayla.` : 'Bu hafta için yeni öneri üretilemedi. Açık görev, alışkanlık veya uygun zaman aralığı olmayabilir.')
  }

  function approveWeekBlock(block: WeekPlanBlock) {
    const conflict = hasPlanningConflict(block, calendarEvents, [...planBlocks, ...weeklyDraft.filter((item) => item.id !== block.id)])
    if (conflict) return
    setPlanBlocks((current) => current.some((item) => item.id === block.id) ? current : [...current, block])
    setWeeklyMessage('Öneri SALT haftalık planına eklendi. Google Takvim değiştirilmedi.')
  }

  function approveAllWeekBlocks() {
    const accepted: WeekPlanBlock[] = []
    for (const block of weeklyDraft) {
      if (hasPlanningConflict(block, calendarEvents, [...planBlocks, ...accepted])) continue
      if (!planBlocks.some((item) => item.id === block.id)) accepted.push(block)
    }
    if (accepted.length) setPlanBlocks((current) => [...current, ...accepted])
    setWeeklyMessage(accepted.length ? `${accepted.length} öneri SALT haftalık planına eklendi.` : 'Eklenecek çakışmasız öneri bulunamadı.')
  }

  function updateWeekDraft(id: string, patch: Partial<WeekPlanBlock>) {
    setWeeklyDraft((current) => current.map((block) => block.id === id ? { ...block, ...patch } : block))
  }

  function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim()
    if (!title) return
    const task: Task = {
      id: taskEditor && taskEditor !== 'new' ? taskEditor.id : makeId(), title,
      detail: String(form.get('detail') ?? '').trim() || 'Kişisel · Bugün',
      priority: form.get('priority') === 'on',
      completed: taskEditor && taskEditor !== 'new' ? taskEditor.completed : false,
      estimatedMinutes: Number(form.get('estimatedMinutes')) || undefined,
      planCategory: String(form.get('planCategory')) as PlanCategory,
    }
    setTasks((current) => taskEditor && taskEditor !== 'new' ? current.map((item) => item.id === task.id ? task : item) : [task, ...current])
    setTaskEditor(null)
  }

  function approveCandidate(candidate: Candidate) {
    setTasks((current) => [{ id: makeId(), title: candidate.title, detail: 'Gelen kutusu · Bugün', priority: false, completed: false }, ...current])
    setCandidates((current) => current.filter((item) => item.id !== candidate.id))
  }

  function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get('amount'))
    const title = String(form.get('title') ?? '').trim()
    if (!title || !Number.isFinite(amount) || amount <= 0) return
    setExpenses((current) => [{ id: makeId(), title, category: String(form.get('category') ?? 'Diğer'), amount, date: localDateKey() }, ...current])
    setExpenseEditor(false)
  }

  function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim()
    const dateValue = String(form.get('date') ?? '').trim()
    const time = String(form.get('time') ?? '').trim()
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(time)) return
    const existing = eventEditor && eventEditor !== 'new' ? eventEditor : null
    const newEvent: ScheduleEvent = {
      ...(existing ?? { id: makeId(), completed: false, transportRequested: false }),
      title, date: dateValue, time,
      location: String(form.get('location') ?? '').trim(),
      origin: String(form.get('origin') ?? '').trim(),
      transportRequested: form.get('transportRequested') === 'on',
    }
    setSchedule((current) => existing ? current.map((item) => item.id === existing.id ? newEvent : item) : [...current, newEvent])
    setEventEditor(null)
  }

  function saveCoffeeExpense(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    if (!coffeeExpenseEventId) return
    const form = new FormData(formEvent.currentTarget)
    const amount = Number(form.get('amount'))
    if (!Number.isFinite(amount) || amount <= 0) return
    const coffeeEvent = schedule.find((item) => item.id === coffeeExpenseEventId)
    if (!coffeeEvent) return
    const expenseId = coffeeEvent.actualExpenseId ?? makeId()
    const expense: Expense = { id: expenseId, title: 'Arkadaşlarla kahve', category: 'Yeme içme', amount, date: coffeeEvent.date }
    setExpenses((current) => current.some((item) => item.id === expenseId) ? current.map((item) => item.id === expenseId ? expense : item) : [expense, ...current])
    setSchedule((current) => current.map((item) => item.id === coffeeEvent.id ? { ...item, actualSpend: amount, actualExpenseId: expenseId } : item))
    setCoffeeExpenseEventId(null)
  }

  function deleteExpense(id: string) {
    setExpenses((current) => current.filter((expense) => expense.id !== id))
    setSchedule((current) => current.map((event) => event.actualExpenseId === id ? { ...event, actualSpend: undefined, actualExpenseId: undefined } : event))
  }

  function addMoodActivity(suggestion: MoodSuggestion) {
    const now = new Date()
    const slot = findCurrentMoodSlot(now, schedule, tasks, calendarEvents)
    if (!slot || !isToday(moodSlot?.date ?? '', now) || suggestion.minutes > slot.minutes) return false
    setSchedule((current) => [...current, {
      id: makeId(), title: suggestion.title, date: slot.date, time: formatMoodSlotTime(slot.startMinute), location: '', origin: '',
      completed: false, transportRequested: false, durationMinutes: suggestion.minutes,
    }])
    setMoodSlot(null)
    return true
  }

  function openMoodCheckIn() {
    const slot = findCurrentMoodSlot(new Date(), schedule, tasks, calendarEvents)
    if (!slot) {
      setMoodAvailabilityMessage('Şu an takvim ve görevlerinde öneri hazırlamak için en az 20 dakikalık uygun bir boşluk bulamadım.')
      return
    }
    setMoodAvailabilityMessage('')
    const today = localDateKey()
    rememberMoodPromptedDate(today)
    setMoodPromptedDate(today)
    setMoodSlot(slot)
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const lifeStatus = String(form.get('lifeStatus')) as UserProfile['lifeStatus']
    const student = lifeStatus === 'student' || lifeStatus === 'both'
    const working = lifeStatus === 'working' || lifeStatus === 'both'
    setProfile({
      displayName: String(form.get('displayName') ?? '').trim(), lifeStatus,
      schoolName: student ? String(form.get('schoolName') ?? '').trim() : '',
      fieldOfStudy: student ? String(form.get('fieldOfStudy') ?? '').trim() : '',
      studyYear: student ? String(form.get('studyYear') ?? '').trim() : '',
      workplace: working ? String(form.get('workplace') ?? '').trim() : '',
      jobTitle: working ? String(form.get('jobTitle') ?? '').trim() : '',
      interests: String(form.get('interests') ?? '').trim(), focusGoal: String(form.get('focusGoal') ?? '').trim(),
    })
    setProfileEditorOpen(false)
  }

  const displayName = profile?.displayName.trim() || 'SALT kullanıcısı'
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('tr-TR')
  const profileSummary = profile?.lifeStatus === 'both' ? 'Öğrenci · çalışıyor' : profile?.lifeStatus === 'student' ? 'Öğrenci planı' : profile?.lifeStatus === 'working' ? 'Çalışma planı' : 'Kişisel plan'

  return (
    <div className="min-h-screen bg-[#f8f7f2] text-[#172a43]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-[#172a43]/[0.08] bg-[#fbfaf7] px-6 py-7 md:flex">
        <a href="#home" onClick={(event) => { event.preventDefault(); setActive('Today') }} className="flex items-center gap-3 text-xl font-bold tracking-[-0.06em]" aria-label="SALT ana sayfa">
          <span className="grid size-9 place-items-center rounded-xl bg-[#172a43] text-sm font-black text-[#d7f36b]">S</span>SALT<span className="ml-[-9px] text-[#d7f36b]">.</span>
        </a>
        <p className="mb-3 mt-12 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#172a43]/40">Çalışma alanın</p>
        <nav className="space-y-1" aria-label="Ana gezinme">{sections.map((item) => <NavItem key={item.name} {...item} active={active === item.name} onClick={() => setActive(item.name)} />)}</nav>
        <div className="mt-auto rounded-2xl bg-[#172a43] p-4 text-white">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">Haftalık ritmin</span><span className="text-lg text-[#d7f36b]">✳</span></div>
          <p className="text-xs leading-relaxed text-white/65">Küçük adımlar, daha dengeli günler.</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#d7f36b] transition-all" style={{ width: `${habits.length ? habits.filter((habit) => habit.done).length / habits.length * 100 : 0}%` }} /></div>
          <p className="mt-2 text-[10px] text-white/55">Bugünkü alışkanlıkların %{habits.length ? Math.round(habits.filter((habit) => habit.done).length / habits.length * 100) : 0} tamamlandı</p>
        </div>
        <div className="mt-5 rounded-2xl border border-[#172a43]/[0.08] p-2"><button onClick={() => setActive('Profil')} className="flex w-full items-center gap-3 rounded-xl p-1 text-left hover:bg-[#172a43]/[0.04]"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#e8e7df] text-xs font-bold">{initials}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{displayName}</span><span className="block text-[10px] text-[#172a43]/50">{profileSummary}</span></span></button><button onClick={openMoodCheckIn} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#d7f36b]/60 px-3 py-2 text-xs font-semibold hover:bg-[#d7f36b]" aria-label="Nasılım? İyi oluş kontrolünü aç"><span aria-hidden="true">✳</span>Nasılım?</button></div>
      </aside>

      <main className="mx-auto min-h-screen max-w-7xl px-5 pb-28 pt-6 sm:px-8 md:ml-64 md:px-12 md:pb-12 md:pt-10">
        <header className="flex items-center justify-between">
          <button onClick={() => setActive('Today')} className="text-xl font-bold tracking-[-0.06em] md:hidden">SALT<span className="text-[#b5d443]">.</span></button>
          <p className="hidden text-xs font-medium capitalize text-[#172a43]/50 md:block">{date}</p>
          <div className="ml-auto flex items-center gap-2"><span className="hidden text-xs font-medium capitalize text-[#172a43]/50 max-md:block">{date}</span><button onClick={openMoodCheckIn} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#d7f36b] px-3 text-[11px] font-semibold md:hidden" aria-label="Nasılım? İyi oluş kontrolünü aç"><span aria-hidden="true">✳</span>Nasılım?</button><button onClick={() => setActive('Profil')} aria-label="Profili aç" className="grid size-9 place-items-center rounded-full bg-[#e8e7df] text-[11px] font-bold md:hidden">{initials}</button></div>
        </header>
        {moodAvailabilityMessage && <div role="status" className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-[#d7f36b]/30 px-4 py-3 text-xs leading-relaxed"><span>{moodAvailabilityMessage}</span><button onClick={() => setMoodAvailabilityMessage('')} aria-label="Mesajı kapat" className="shrink-0 font-semibold">×</button></div>}

        {active === 'Today' && <TodayView profile={profile} tasks={tasks} events={dayEvents} selectedDate={selectedDate} setSelectedDate={setSelectedDate} onCreate={() => setTaskEditor('new')} onEdit={setTaskEditor} onToggle={(id) => setTasks((all) => all.map((task) => task.id === id ? { ...task, completed: !task.completed } : task))} onDelete={(id) => setTasks((all) => all.filter((task) => task.id !== id))} onOpenInbox={() => setActive('Inbox')} onOpenLife={() => setActive('Life')} onAddEvent={() => setEventEditor('new')} onEditEvent={setEventEditor} onToggleEvent={(id) => setSchedule((all) => all.map((item) => item.id === id ? { ...item, completed: !item.completed } : item))} onDeleteEvent={(id) => setSchedule((all) => all.filter((item) => item.id !== id))} onRecordCoffee={(id) => setCoffeeExpenseEventId(id)} googleEvents={calendarEvents} googleConnected={calendarConnected} googleNeedsReconnect={calendarNeedsReconnect} googleLoading={calendarLoading} googleError={calendarMessageIsError} googleMessage={calendarMessage} tokenExpired={calendarTokenExpired} onConnectGoogle={connectGoogleCalendar} onRefreshGoogle={refreshGoogleCalendar} onDisconnectGoogle={disconnectGoogleCalendar} />}
        {active === 'Haftalık Plan' && <WeeklyPlanView tasks={tasks} habits={habits} googleEvents={calendarEvents} googleConnected={calendarConnected} googleNeedsReconnect={calendarNeedsReconnect} googleLoading={calendarLoading} googleError={calendarMessageIsError} googleMessage={calendarMessage} tokenExpired={calendarTokenExpired} onConnectGoogle={connectGoogleCalendar} onRefreshGoogle={refreshGoogleCalendar} weekStart={weekStart} weekDays={weekDays} onWeekChange={(offset) => { const next = new Date(weekStart); next.setDate(next.getDate() + offset * 7); setWeekStart(next); setWeeklyDraft([]); setWeeklyMessage('') }} drafts={weeklyDraft} savedBlocks={planBlocks} onGenerate={generateWeeklyPlan} onApprove={approveWeekBlock} onApproveAll={approveAllWeekBlocks} onUpdateDraft={updateWeekDraft} onDeleteSaved={(id) => setPlanBlocks((current) => current.filter((block) => block.id !== id))} message={weeklyMessage} />}
        {active === 'Inbox' && <InboxView text={inboxText} setText={setInboxText} candidates={candidates} setCandidates={setCandidates} onExtract={() => setCandidates(extractCandidates(inboxText))} onApprove={approveCandidate} />}
        {active === 'Life' && <LifeView budget={budget} setBudget={setBudget} spent={spent} remaining={remaining} monthlyExpenseCount={monthlyExpenseCount} expenses={expenses} onAddExpense={() => setExpenseEditor(true)} onDeleteExpense={deleteExpense} habits={habits} onToggleHabit={(id) => setHabits((all) => all.map((habit) => habit.id === id ? { ...habit, done: !habit.done } : habit))} onAddHabit={(title) => setHabits((all) => [...all, { id: makeId(), title, done: false }])} onDeleteHabit={(id) => setHabits((all) => all.filter((habit) => habit.id !== id))} />}
        {active === 'Profil' && <ProfileView profile={profile} onEdit={() => setProfileEditorOpen(true)} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-[#172a43]/[0.08] bg-[#f8f7f2]/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden" aria-label="Mobil gezinme">{sections.map((item) => <NavItem key={item.name} {...item} active={active === item.name} onClick={() => setActive(item.name)} compact />)}</nav>

      {taskEditor !== null && <Modal title={taskEditor === 'new' ? 'Yeni görev' : 'Görevi düzenle'} onClose={() => setTaskEditor(null)}><form onSubmit={saveTask} className="space-y-4">
        <Field label="Görev adı"><input autoFocus name="title" required maxLength={120} defaultValue={taskEditor === 'new' ? '' : taskEditor.title} placeholder="Örn. Sunum taslağını hazırla" /></Field>
        <Field label="Ders / zaman"><input name="detail" maxLength={80} defaultValue={taskEditor === 'new' ? '' : taskEditor.detail} placeholder="Örn. Tasarım · 15:00" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Plan kategorisi"><select name="planCategory" defaultValue={taskEditor === 'new' ? 'assignment' : taskEditor.planCategory ?? inferTaskCategory(taskEditor)}><option value="study">Ders çalışma</option><option value="assignment">Ödev / proje</option><option value="hobby">Hobi</option><option value="habit">Alışkanlık</option></select></Field><Field label="Tahmini süre (dk)"><input name="estimatedMinutes" type="number" min="5" max="240" step="5" defaultValue={taskEditor === 'new' ? '' : taskEditor.estimatedMinutes ?? ''} placeholder="Otomatik tahmin" /></Field></div>
        <p className="text-[11px] leading-relaxed text-[#172a43]/50">Süreyi boş bırakırsan Haftalık Plan makul bir tahmin kullanır; plan taslağında değiştirebilirsin.</p>
        <label className="flex items-center gap-2 text-xs"><input name="priority" type="checkbox" defaultChecked={taskEditor === 'new' ? false : taskEditor.priority} className="accent-[#172a43]" /> Öncelikli görev</label>
        <FormActions onCancel={() => setTaskEditor(null)} submitLabel="Kaydet" />
      </form></Modal>}
      {eventEditor !== null && <Modal title={eventEditor === 'new' ? 'Etkinlik ekle' : 'Etkinliği düzenle'} onClose={() => setEventEditor(null)}><form onSubmit={saveEvent} className="space-y-4">
        <Field label="Etkinlik adı"><input autoFocus name="title" required maxLength={100} defaultValue={eventEditor === 'new' ? '' : eventEditor.title} placeholder="Örn. Kampüs toplantısı" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Tarih"><input name="date" type="date" required defaultValue={eventEditor === 'new' ? selectedDate : eventEditor.date} /></Field><Field label="Saat"><input name="time" type="time" required defaultValue={eventEditor === 'new' ? '12:00' : eventEditor.time} /></Field></div>
        <Field label="Varış konumu / adres"><input name="location" maxLength={120} defaultValue={eventEditor === 'new' ? '' : eventEditor.location} placeholder="Adres eksikse boş bırakabilirsin" /></Field>
        <Field label="Başlangıç noktası"><input name="origin" maxLength={120} defaultValue={eventEditor === 'new' ? '' : eventEditor.origin} placeholder="Örn. Ümraniye Çakmak Metro" /></Field>
        <label className="flex items-center gap-2 text-xs"><input name="transportRequested" type="checkbox" defaultChecked={eventEditor === 'new' ? true : eventEditor.transportRequested} className="accent-[#172a43]" /> Bu etkinlik için ulaşım planı göster</label>
        {!((eventEditor !== 'new') && eventEditor.routeId) && <p className="rounded-xl bg-[#d7f36b]/30 p-3 text-[11px] leading-relaxed text-[#172a43]/70">Bu konum için doğrulanmış rota yok. Kaydedince kart resmî kaynaklardan kontrol gerektiğini gösterecek.</p>}
        <FormActions onCancel={() => setEventEditor(null)} submitLabel="Etkinliği kaydet" />
      </form></Modal>}
      {expenseEditor && <Modal title="Harcama ekle" onClose={() => setExpenseEditor(false)}><form onSubmit={saveExpense} className="space-y-4">
        <Field label="Harcama adı"><input autoFocus name="title" required maxLength={80} placeholder="Örn. Öğle yemeği" /></Field>
        <Field label="Tutar (₺)"><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0" /></Field>
        <Field label="Kategori"><select name="category" defaultValue="Yeme içme"><option>Yeme içme</option><option>Ulaşım</option><option>Eğitim</option><option>Alışveriş</option><option>Diğer</option></select></Field>
        <FormActions onCancel={() => setExpenseEditor(false)} submitLabel="Harcamayı ekle" />
      </form></Modal>}
      {coffeeExpenseEventId && <Modal title="Gerçek kahve harcamasını kaydet" onClose={() => setCoffeeExpenseEventId(null)}><form onSubmit={saveCoffeeExpense} className="space-y-4">
        <p className="text-xs leading-relaxed text-[#172a43]/60">₺450 planlanan üst sınırdır. Buraya yalnızca gerçekten ödediğin tutarı yaz; bu tutar Life bölümüne gider olarak kaydedilir.</p>
        <Field label="Gerçek harcama (₺)"><input autoFocus name="amount" type="number" min="0.01" step="0.01" required placeholder="Örn. 390" defaultValue={schedule.find((item) => item.id === coffeeExpenseEventId)?.actualSpend ?? ''} /></Field>
        <FormActions onCancel={() => setCoffeeExpenseEventId(null)} submitLabel="Gerçek harcamayı kaydet" />
      </form></Modal>}
      {moodSlot && <MoodCheckInModal slot={moodSlot} monthlyBudgetRemaining={Math.max(0, remaining)} calendarConnected={calendarConnected} onClose={() => setMoodSlot(null)} onAddActivity={addMoodActivity} />}
      {profileEditorOpen && <Modal title={profile ? 'Profilini düzenle' : 'SALT’ı sana göre hazırlayalım'} onClose={() => setProfileEditorOpen(false)} dismissable={Boolean(profile)}><p className="mb-5 text-xs leading-relaxed text-[#172a43]/60">Temel bilgilerini ekle; günlük planın ve önerilerin sana daha uygun olsun. Bu bilgiler yalnızca bu tarayıcıda saklanır.</p><ProfileForm profile={profile} onSubmit={saveProfile} onCancel={() => setProfileEditorOpen(false)} required={!profile} /></Modal>}
    </div>
  )
}

function TodayView({ profile, tasks, events, selectedDate, setSelectedDate, onCreate, onEdit, onToggle, onDelete, onOpenInbox, onOpenLife, onAddEvent, onEditEvent, onToggleEvent, onDeleteEvent, onRecordCoffee, googleEvents, googleConnected, googleNeedsReconnect, googleLoading, googleError, googleMessage, tokenExpired, onConnectGoogle, onRefreshGoogle, onDisconnectGoogle }: {
  profile: UserProfile | null; tasks: Task[]; events: ScheduleEvent[]; selectedDate: string; setSelectedDate: (date: string) => void
  onCreate: () => void; onEdit: (task: Task) => void; onToggle: (id: string) => void; onDelete: (id: string) => void
  onOpenInbox: () => void; onOpenLife: () => void; onAddEvent: () => void; onEditEvent: (event: ScheduleEvent) => void
  onToggleEvent: (id: string) => void; onDeleteEvent: (id: string) => void; onRecordCoffee: (id: string) => void
  googleEvents: GoogleCalendarEvent[]; googleConnected: boolean; googleNeedsReconnect: boolean; googleLoading: boolean; googleError: boolean; googleMessage: string; tokenExpired: boolean
  onConnectGoogle: () => void; onRefreshGoogle: () => void; onDisconnectGoogle: () => void
}) {
  const openCount = tasks.filter((task) => !task.completed).length
  const dayComplete = events.length > 0 && events.every((event) => event.completed) && events.some((event) => event.time === '20:00' && event.completed)
  const firstName = profile?.displayName.trim().split(/\s+/)[0]
  const personalContext = profile?.focusGoal || profile?.fieldOfStudy || profile?.interests
  return <>
    <section className="mt-10 md:mt-14"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-3 hidden text-[11px] font-bold uppercase tracking-[0.18em] text-[#172a43]/40 md:block">GÜNÜN PLANI · {dateLabel(selectedDate)}</p><h1 className="text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">Günaydın{firstName ? `, ${firstName}` : ''}<span className="text-[#b5d443]">.</span></h1><p className="mt-3 text-sm text-[#172a43]/55">{personalContext ? `${personalContext} odağını gözeterek bugün kendin için güzel bir şey yap.` : 'Bugün kendin için güzel bir şey yap.'}</p></div><div className="flex flex-wrap items-center gap-2 self-start sm:justify-end"><label className="sr-only" htmlFor="plan-date">Plan tarihi</label><input id="plan-date" aria-label="Plan tarihi" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} onInput={(event) => setSelectedDate(event.currentTarget.value)} className="h-11 min-w-0 rounded-full border border-[#172a43]/10 bg-white/70 px-3 text-xs" /><button onClick={onAddEvent} className="h-11 rounded-full border border-[#172a43]/15 px-4 text-xs font-semibold hover:bg-white">+ Etkinlik ekle</button><button onClick={onCreate} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#172a43] px-4 text-xs font-semibold text-white transition hover:bg-[#263e5b]"><span className="text-lg leading-none text-[#d7f36b]">+</span> Yeni görev</button></div></div></section>
    <GoogleCalendarPanel events={googleEvents} connected={googleConnected} needsReconnect={googleNeedsReconnect} loading={googleLoading} error={googleError} message={googleMessage} tokenExpired={tokenExpired} onConnect={onConnectGoogle} onRefresh={onRefreshGoogle} onDisconnect={onDisconnectGoogle} />
    <section className="mt-7 rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold tracking-tight">Takvimindeki gün</h2><p className="mt-1 text-xs text-[#172a43]/45">Etkinlik saati veya konumu değiştiğinde ulaşım planını yeniden doğrula.</p></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${dayComplete ? 'bg-[#d7f36b]/55 text-[#172a43]' : 'bg-[#172a43]/[0.05] text-[#172a43]/55'}`}>{dayComplete ? 'Gün tamamlandı' : `${events.filter((event) => event.completed).length}/${events.length} etkinlik tamamlandı`}</span></div>
      {events.length === 0 ? <div className="mt-5 rounded-2xl bg-[#172a43]/[0.03] px-4 py-8 text-center"><p className="text-xs text-[#172a43]/50">Bu tarihte henüz etkinlik yok.</p><button onClick={onAddEvent} className="mt-3 text-xs font-semibold">İlk etkinliği ekle →</button></div> : <div className="mt-6 space-y-1">{events.map((event) => <ScheduleEventRow key={event.id} event={event} route={event.routeId ? ISTANBUL_DEMO_ROUTES[event.routeId] : undefined} onToggle={() => onToggleEvent(event.id)} onEdit={() => onEditEvent(event)} onDelete={() => onDeleteEvent(event.id)} onRecordCoffee={() => onRecordCoffee(event.id)} />)}</div>}
      {dayComplete && <p className="mt-5 rounded-2xl bg-[#d7f36b]/35 p-4 text-sm font-semibold">20:00 not inceleme görevi tamamlandı. Günlük planın tamamlandı ✳</p>}
    </section>
    <section className="mt-9 grid grid-cols-1 gap-5 lg:grid-cols-[1.55fr_1fr]">
      <div className="rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold tracking-tight">Bugünün odağı</h2><p className="mt-1 text-xs text-[#172a43]/45">{openCount} açık görev · {tasks.length} toplam</p></div><span className="text-xs font-semibold text-[#172a43]/40">{tasks.filter((task) => task.completed).length}/{tasks.length} tamamlandı</span></div>
        <div className="mt-6 space-y-2">{tasks.length === 0 ? <p className="rounded-xl bg-[#172a43]/[0.03] px-3 py-6 text-center text-xs text-[#172a43]/45">Henüz görev yok. İlk görevini ekleyebilirsin.</p> : tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={() => onToggle(task.id)} onEdit={() => onEdit(task)} onDelete={() => onDelete(task.id)} />)}</div>
        <button onClick={onCreate} className="mt-4 w-full rounded-xl border border-dashed border-[#172a43]/15 py-3 text-xs font-medium text-[#172a43]/45 hover:border-[#172a43]/30 hover:text-[#172a43]">+ Bir görev daha ekle</button>
      </div>
      <div className="flex flex-col gap-5"><div className="rounded-[24px] bg-[#d7f36b] p-6 sm:p-7"><div className="flex items-start justify-between"><span className="rounded-full bg-[#172a43]/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">Sana özel</span><span className="text-xl">✳</span></div><p className="mt-7 text-xl font-semibold leading-snug tracking-tight">{openCount > 0 ? 'Bir görevi tamamlamak için küçük bir başlangıç yeterli.' : 'Bugünkü görevlerin tamamlandı.'}</p><p className="mt-2 max-w-xs text-xs leading-relaxed text-[#172a43]/65">{openCount > 0 ? 'Öncelikli görevinden başlayıp sonra kısa bir mola verebilirsin.' : 'Kendine ayıracağın biraz zaman iyi gelebilir.'}</p><button onClick={onOpenLife} className="mt-5 rounded-full bg-[#172a43] px-4 py-2.5 text-[11px] font-semibold text-white">Alışkanlıklarına bak <span className="ml-2 text-[#d7f36b]">↗</span></button></div>
        <div className="flex flex-1 items-center gap-4 rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#172a43]/[0.05] text-xl">☼</div><div><p className="text-xs font-semibold">Takviminde sıradaki</p><p className="mt-1 text-xs text-[#172a43]/50">Tasarım stüdyosu · 13:00</p></div><span className="ml-auto text-xs font-medium text-[#172a43]/40">B-204</span></div></div>
    </section>
    <section className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#172a43]/[0.07] px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-[#172a43]/[0.05] text-sm">↗</span><div><p className="text-xs font-semibold">Bir nottan görev çıkar</p><p className="mt-0.5 text-[11px] text-[#172a43]/45">Metni ekle, adayları kontrol et ve onayla</p></div></div><button onClick={onOpenInbox} className="text-xs font-semibold">Gelen kutusuna git <span className="ml-1">→</span></button></section>
  </>
}

function GoogleCalendarPanel({ events, connected, needsReconnect, loading, error, message, tokenExpired, onConnect, onRefresh, onDisconnect }: {
  events: GoogleCalendarEvent[]; connected: boolean; needsReconnect: boolean; loading: boolean; error: boolean; message: string; tokenExpired: boolean
  onConnect: () => void; onRefresh: () => void; onDisconnect: () => void
}) {
  return <section aria-labelledby="google-calendar-title" className="mt-6 rounded-[24px] border border-[#172a43]/[0.08] bg-white/70 p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#172a43]/40">GOOGLE TAKVİM</p><h2 id="google-calendar-title" className="mt-1 text-base font-semibold">Takvimindeki yaklaşan etkinlikler</h2></div><div className="flex shrink-0 gap-2"><button onClick={connected && !tokenExpired ? onRefresh : onConnect} disabled={loading} className="rounded-full bg-[#172a43] px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-55">{loading ? 'Takvim yükleniyor…' : connected && !tokenExpired ? 'Takvimi yenile' : needsReconnect ? 'Google Takvim’e yeniden bağlan' : 'Google Takvim’i bağla'}</button>{connected && <button onClick={onDisconnect} className="rounded-full border border-[#172a43]/15 px-4 py-2.5 text-xs font-semibold hover:bg-[#f8f7f2]">Bağlantıyı kes</button>}</div></div>
    <p className="mt-2 text-xs leading-relaxed text-[#172a43]/50">Etkinlikler SALT örnek planından ayrı gösterilir; Google Takvim’de hiçbir değişiklik yapılmaz.</p>
    {message && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${error ? 'bg-amber-50 text-amber-900' : 'bg-[#d7f36b]/25 text-[#172a43]/75'}`}>{message}</p>}
    {!import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() && <p className="mt-3 text-[11px] leading-relaxed text-[#172a43]/50">Bağlantı için proje kökünde .env.local içine Google OAuth Client ID ekleyip sunucuyu yeniden başlatın.</p>}
    {!connected && !events.length && <p className="mt-3 text-xs text-[#172a43]/55">Google Takvim bağlı değil. Etkinlikleri görmek için bağlantı kurun.</p>}
    {connected && !loading && events.length === 0 && !error && <p className="mt-3 text-xs text-[#172a43]/55">Bu haftada Google Takvim etkinliği yok.</p>}
    {events.length > 0 && <div className="mt-4 divide-y divide-[#172a43]/[0.07]">{events.slice(0, 6).map((event) => <article key={event.id} className="py-3 first:pt-0 last:pb-0"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 flex-1 text-xs font-semibold">{event.summary || 'Başlıksız etkinlik'}</h3><time className="shrink-0 text-[10px] font-medium text-[#172a43]/55">{formatGoogleEventDate(event.start.dateTime ?? event.start.date ?? '', event.start.timeZone)}{event.start.dateTime && ` · ${formatGoogleEventTime(event.start.dateTime, event.start.timeZone)}–${formatGoogleEventTime(event.end.dateTime ?? event.end.date ?? '', event.end.timeZone)}`}</time></div>{event.location && <p className="mt-1 break-words text-[10px] text-[#172a43]/50">{event.location}</p>}</article>)}</div>}
    {events.length > 6 && <p className="mt-2 text-[10px] font-semibold text-[#172a43]/55">Diğer etkinlikler Haftalık Plan ekranında</p>}
  </section>
}
function googleEventOccursOn(event: GoogleCalendarEvent, date: string) {
  return calendarRangesForDay([event], date).length > 0
}

function googleEventMinute(event: GoogleCalendarEvent, date: string) {
  return calendarRangesForDay([event], date)[0]?.startMinute ?? 0
}

function formatPlanTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function WeeklyPlanView({ tasks, habits, googleEvents, googleConnected, googleNeedsReconnect, googleLoading, googleError, googleMessage, tokenExpired, onConnectGoogle, onRefreshGoogle, weekStart, weekDays, onWeekChange, drafts, savedBlocks, onGenerate, onApprove, onApproveAll, onUpdateDraft, onDeleteSaved, message }: {
  tasks: Task[]; habits: Habit[]; googleEvents: GoogleCalendarEvent[]; googleConnected: boolean; googleNeedsReconnect: boolean; googleLoading: boolean; googleError: boolean; googleMessage: string; tokenExpired: boolean
  onConnectGoogle: () => void; onRefreshGoogle: () => void; weekStart: Date; weekDays: ReturnType<typeof getWeekDays>; onWeekChange: (offset: number) => void
  drafts: WeekPlanBlock[]; savedBlocks: WeekPlanBlock[]; onGenerate: () => void; onApprove: (block: WeekPlanBlock) => void; onApproveAll: () => void
  onUpdateDraft: (id: string, patch: Partial<WeekPlanBlock>) => void; onDeleteSaved: (id: string) => void; message: string
}) {
  const weekEnd = weekDays[6]?.date ?? weekStart
  const weekLabel = `${new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(weekStart)} – ${new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(weekEnd)}`
  const approvedIds = new Set(savedBlocks.map((block) => block.id))
  const visibleSaved = savedBlocks.filter((block) => weekDays.some((day) => day.key === block.date))
  const visibleDrafts = drafts.filter((block) => weekDays.some((day) => day.key === block.date) && !approvedIds.has(block.id))
  const validDrafts = visibleDrafts.filter((block) => !hasPlanningConflict(block, googleEvents, [...visibleSaved, ...visibleDrafts.filter((other) => other.id !== block.id)]))

  return <>
    <PageHeading eyebrow="HAFTALIK PLAN" title="Haftana yer aç." subtitle="Google etkinlikleri sabit kalır. SALT görev ve alışkanlıklarını boş zamanlara yerleştirir; öneriler onayın olmadan kaydedilmez." />
    <section className="mt-7 rounded-[24px] border border-[#172a43]/[0.08] bg-white/70 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#172a43]/40">GOOGLE TAKVİM · SALT ÖNERİLERİNDEN AYRI</p><h2 className="mt-1 text-base font-semibold">{weekLabel}</h2></div><div className="flex flex-wrap gap-2"><button onClick={() => onWeekChange(-1)} aria-label="Önceki hafta" className="rounded-full border border-[#172a43]/15 px-3 py-2 text-xs font-semibold hover:bg-[#f8f7f2]">← Önceki</button><button onClick={() => onWeekChange(Math.round((getMonday().getTime() - weekStart.getTime()) / (7 * 86_400_000)))} className="rounded-full border border-[#172a43]/15 px-3 py-2 text-xs font-semibold hover:bg-[#f8f7f2]">Bu hafta</button><button onClick={() => onWeekChange(1)} aria-label="Sonraki hafta" className="rounded-full border border-[#172a43]/15 px-3 py-2 text-xs font-semibold hover:bg-[#f8f7f2]">Sonraki →</button></div></div>
      <p className="mt-3 text-[11px] text-[#172a43]/50">Plan önerisi için {tasks.filter((task) => !task.completed).length} açık görev ve {habits.length} alışkanlık mevcut.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2"><button onClick={googleConnected && !tokenExpired ? onRefreshGoogle : onConnectGoogle} disabled={googleLoading} className="rounded-full bg-[#172a43] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-55">{googleLoading ? 'Takvim yükleniyor…' : googleConnected && !tokenExpired ? 'Takvimi yenile' : googleNeedsReconnect ? 'Google Takvim’e yeniden bağlan' : 'Google Takvim’i bağla'}</button><button onClick={onGenerate} disabled={!googleConnected || googleLoading || tokenExpired} className="rounded-full bg-[#d7f36b] px-4 py-2.5 text-xs font-semibold text-[#172a43] disabled:cursor-not-allowed disabled:opacity-50">Haftalık Planı Oluştur</button>{visibleDrafts.length > 0 && validDrafts.length > 0 && <button onClick={onApproveAll} className="rounded-full border border-[#172a43]/15 px-4 py-2.5 text-xs font-semibold hover:bg-[#f8f7f2]">Uygun önerileri onayla ({validDrafts.length})</button>}</div>
      {googleMessage && <p role={googleError ? 'alert' : 'status'} className={`mt-4 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${googleError ? 'bg-amber-50 text-amber-900' : 'bg-[#d7f36b]/25 text-[#172a43]/75'}`}>{googleMessage}</p>}
      {!googleConnected && <div className="mt-4 rounded-xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">Google Takvim bağlı değil. Sahte etkinlik göstermiyoruz; haftalık planı güvenli şekilde hazırlamak için önce takvimi bağla.</div>}
      {googleConnected && !googleLoading && !googleError && googleEvents.length === 0 && <p className="mt-4 text-xs text-[#172a43]/55">Bu hafta Google Takvim’de etkinlik yok. SALT önerileri boş zamanın tamamını kullanabilir.</p>}
      {message && <p role="status" className="mt-4 rounded-xl bg-[#d7f36b]/25 px-3 py-2.5 text-xs leading-relaxed text-[#172a43]/75">{message}</p>}
    </section>
    {visibleDrafts.length > 0 && <p className="mt-5 text-xs text-[#172a43]/55">Süre tahminleri varsayımdır. Başlangıç saatini veya süreyi değiştir; çakışan öneriler onaylanamaz.</p>}
    <section aria-label="Pazartesi–Pazar haftalık takvim" className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {weekDays.map((day) => {
        const eventsForDay = googleEvents.filter((event) => googleEventOccursOn(event, day.key))
        const savedForDay = visibleSaved.filter((block) => block.date === day.key)
        const draftsForDay = visibleDrafts.filter((block) => block.date === day.key)
        const rows = [
          ...eventsForDay.map((event) => ({ kind: 'google' as const, event, minute: googleEventMinute(event, day.key) })),
          ...savedForDay.map((block) => ({ kind: 'saved' as const, block, minute: blockRange(block).startMinute })),
          ...draftsForDay.filter((block) => !approvedIds.has(block.id)).map((block) => ({ kind: 'draft' as const, block, minute: blockRange(block).startMinute })),
        ].sort((a, b) => a.minute - b.minute)
        return <article key={day.key} className="min-w-0 rounded-[22px] border border-[#172a43]/[0.08] bg-white/70 p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2 border-b border-[#172a43]/[0.07] pb-3"><h3 className="capitalize text-sm font-semibold">{day.label}</h3><time className="text-[10px] font-medium text-[#172a43]/45">{day.shortDate}</time></div>
          {rows.length === 0 && <p className="py-6 text-center text-xs leading-relaxed text-[#172a43]/45">{googleConnected ? 'Bu gün için etkinlik veya plan bloğu yok.' : 'Etkinlikleri görmek için Google Takvim’i bağla.'}</p>}
          <div className="mt-3 space-y-3">{rows.map((row) => {
            if (row.kind === 'google') {
              const event = row.event
              const startValue = event.start.dateTime ?? event.start.date ?? ''
              const endValue = event.end.dateTime ?? event.end.date ?? ''
              const time = event.start.dateTime ? `${formatGoogleEventTime(event.start.dateTime, event.start.timeZone)}–${formatGoogleEventTime(endValue, event.end.timeZone)}` : 'Tüm gün'
              return <div key={`google-${event.id}`} className="rounded-xl border-l-[3px] border-[#172a43] bg-[#172a43]/[0.045] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 flex-1 text-xs font-semibold">{event.summary || 'Başlıksız etkinlik'}</p><span className="rounded-full bg-[#172a43] px-2 py-1 text-[9px] font-medium text-white">Google</span></div><p className="mt-1 text-[10px] font-medium tabular-nums text-[#172a43]/65">{time}{!event.start.dateTime && startValue && ` · ${formatGoogleEventDate(startValue)}`}</p>{event.location && <p className="mt-1 break-words text-[10px] text-[#172a43]/50">{event.location}</p>}</div>
            }
            const block = row.block
            const range = blockRange(block)
            const endTime = formatPlanTime(range.endMinute)
            const conflict = hasPlanningConflict(block, googleEvents, [...visibleSaved, ...visibleDrafts.filter((item) => item.id !== block.id)])
            if (row.kind === 'saved') return <div key={`salt-${block.id}`} className={`rounded-xl border-l-[3px] p-3 ${conflict ? 'border-amber-600 bg-amber-50' : 'border-[#b5d443] bg-[#d7f36b]/20'}`}><div className="flex items-start justify-between gap-2"><p className="min-w-0 text-xs font-semibold">{block.title}</p><button onClick={() => onDeleteSaved(block.id)} aria-label={`${block.title} SALT planından kaldır`} className="shrink-0 text-[10px] text-[#172a43]/50 underline">Kaldır</button></div><p className="mt-1 text-[10px] font-medium tabular-nums text-[#172a43]/65">{block.startTime}–{endTime} · {block.durationMinutes} dk</p><span className="mt-2 inline-flex rounded-full bg-[#d7f36b]/55 px-2 py-1 text-[9px] font-semibold">SALT planı · {CATEGORY_LABELS[block.category]}</span>{conflict && <p className="mt-2 text-[10px] font-medium text-amber-900">Takvim yenilendiğinden bu blok artık çakışıyor. Kaldırıp planı yeniden oluştur.</p>}</div>
            return <div key={`draft-${block.id}`} className={`rounded-xl border-l-[3px] p-3 ${conflict ? 'border-amber-600 bg-amber-50' : 'border-[#d7a82b] bg-[#fff8df]'}`}><div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 flex-1 text-xs font-semibold">{block.title}</p><span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-medium">Öneri</span></div><span className="mt-2 inline-flex rounded-full bg-white/80 px-2 py-1 text-[9px] font-semibold">{CATEGORY_LABELS[block.category]}{block.wasEstimated ? ' · varsayılan süre' : ''}</span><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[9px] font-medium text-[#172a43]/55">Başlangıç<input aria-label={`${block.title} başlangıç saati`} type="time" value={block.startTime} onChange={(event) => onUpdateDraft(block.id, { startTime: event.target.value })} className="mt-1 w-full rounded-lg border border-[#172a43]/10 bg-white px-2 py-2 text-[11px] text-[#172a43]" /></label><label className="text-[9px] font-medium text-[#172a43]/55">Süre (dakika)<input aria-label={`${block.title} tahmini süre`} type="number" min="5" max="240" step="5" value={block.durationMinutes} onChange={(event) => onUpdateDraft(block.id, { durationMinutes: Math.min(240, Math.max(5, Number(event.target.value) || 5)) })} className="mt-1 w-full rounded-lg border border-[#172a43]/10 bg-white px-2 py-2 text-[11px] text-[#172a43]" /></label></div><p className="mt-2 text-[10px] tabular-nums text-[#172a43]/60">Bitiş {endTime}</p>{conflict && <p className="mt-2 text-[10px] font-medium text-amber-900">Bu saat Google etkinliği veya başka bir plan bloğuyla çakışıyor.</p>}<button disabled={conflict} onClick={() => onApprove(block)} className="mt-3 rounded-full bg-[#172a43] px-3 py-2 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Onayla ve SALT planına ekle</button></div>
          })}</div>
        </article>
      })}
    </section>
  </>
}

function dateLabel(value: string) { return formatPlanDate(value) }

function MoodCheckInModal({ slot, monthlyBudgetRemaining, calendarConnected, onClose, onAddActivity }: {
  slot: MoodSlot; monthlyBudgetRemaining: number; calendarConnected: boolean; onClose: () => void; onAddActivity: (suggestion: MoodSuggestion) => boolean
}) {
  const [answers, setAnswers] = useState<MoodAnswers>({})
  const [suggestions, setSuggestions] = useState<MoodSuggestion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [added, setAdded] = useState(false)
  const selected = suggestions.find((item) => item.id === selectedId)
  const slotEnd = slot.startMinute + slot.minutes
  const generate = (nextAnswers = answers) => {
    const results = createMoodSuggestions(nextAnswers, slot.minutes, monthlyBudgetRemaining)
    setSuggestions(results)
    setSelectedId(results[0]?.id ?? null)
    setMessage(nextAnswers.freeTime && Number(nextAnswers.freeTime) > slot.minutes
      ? `Takvimde şu an ${slot.minutes} dakika boşluk görünüyor; öneriler bu süreye sığacak şekilde kısaltıldı.`
      : '')
  }
  const choices = <T extends string>(label: string, values: readonly T[], value: T | undefined, onChange: (value: T | undefined) => void) => <fieldset className="min-w-0">
    <legend className="mb-2 text-xs font-semibold">{label}</legend>
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">{values.map((choice) => <button key={choice} type="button" aria-pressed={value === choice} onClick={() => onChange(value === choice ? undefined : choice)} className={`rounded-full border px-3 py-2 text-[11px] transition ${value === choice ? 'border-[#172a43] bg-[#172a43] text-white' : 'border-[#172a43]/15 bg-white/70 hover:bg-white'}`}>{choice}</button>)}</div>
  </fieldset>

  return <Modal title="Kısa iyi oluş kontrolü" onClose={onClose}>
    <p className="text-xs leading-relaxed text-[#172a43]/60">Bu isteğe bağlı, anlık bir check-in’dir; tanı koymaz ve klinik değerlendirme değildir. Yanıtların kaydedilmez.</p>
    <p className="mt-4 rounded-xl bg-[#d7f36b]/30 px-3 py-2.5 text-xs font-medium">Takviminde yaklaşık {formatMoodSlotTime(slot.startMinute)}–{formatMoodSlotTime(slotEnd)} arasında {slot.minutes} dk boşluk var.</p>
    {slot.durationEstimated && <p className="mt-2 text-[10px] leading-relaxed text-amber-900">SALT etkinliklerinin bitiş süresi belirtilmediği için bu boşluk yaklaşık hesaplandı.</p>}
    {!calendarConnected && <p className="mt-2 text-[10px] leading-relaxed text-[#172a43]/50">Google Takvim bağlı değil; mevcut SALT etkinlikleri ve saatli görevler kullanılıyor.</p>}
    {suggestions.length === 0 ? <>
      <div className="mt-5 space-y-4">
        {choices('Şu an nasıl hissediyorsun?', ['İyi', 'Stresli', 'Keyifsiz', 'Yorgun', 'Sıkılmış', 'Endişeli'] as const, answers.feeling ? ({ iyi: 'İyi', stresli: 'Stresli', keyifsiz: 'Keyifsiz', yorgun: 'Yorgun', sıkılmış: 'Sıkılmış', endişeli: 'Endişeli' } as const)[answers.feeling] : undefined, (value) => setAnswers((current) => ({ ...current, feeling: value?.toLocaleLowerCase('tr-TR') as MoodAnswers['feeling'] })))}
        {choices('Enerjin nasıl?', ['Düşük', 'Orta', 'Yüksek'] as const, answers.energy ? ({ düşük: 'Düşük', orta: 'Orta', yüksek: 'Yüksek' } as const)[answers.energy] : undefined, (value) => setAnswers((current) => ({ ...current, energy: value?.toLocaleLowerCase('tr-TR') as MoodAnswers['energy'] })))}
        {choices('Ne kadar boş vaktin var?', ['15 dakika', '30 dakika', '1 saat', '1 saat veya daha fazla'] as const, answers.freeTime ? ({ '15': '15 dakika', '30': '30 dakika', '60': '1 saat', '120': '1 saat veya daha fazla' } as const)[answers.freeTime] : undefined, (value) => setAnswers((current) => ({ ...current, freeTime: value ? ({ '15 dakika': '15', '30 dakika': '30', '1 saat': '60', '1 saat veya daha fazla': '120' } as const)[value] : undefined })))}
        {choices('Nasıl vakit geçirmek istersin?', ['Tek başıma', 'Sosyal', 'Fark etmez'] as const, answers.social ? ({ 'tek başıma': 'Tek başıma', sosyal: 'Sosyal', 'fark etmez': 'Fark etmez' } as const)[answers.social] : undefined, (value) => setAnswers((current) => ({ ...current, social: value?.toLocaleLowerCase('tr-TR') as MoodAnswers['social'] })))}
      </div>
      <p className="mt-4 text-[10px] leading-relaxed text-[#172a43]/45">Hava durumu verisi bağlı değil; öneriler takvim boşluğu, yanıtların ve Life bölümündeki kalan bütçeye göre hazırlanır. Yanıtlamak istemediğin soruları boş bırakabilirsin.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button onClick={onClose} className="rounded-full border border-[#172a43]/15 px-4 py-2.5 text-xs font-semibold">Şimdi değil</button><button onClick={() => generate({})} className="rounded-full border border-[#172a43]/15 px-4 py-2.5 text-xs font-semibold">Yanıtlamadan önerileri gör</button><button onClick={() => generate()} className="rounded-full bg-[#172a43] px-4 py-2.5 text-xs font-semibold text-white">Önerileri gör</button></div>
    </> : <>
      <div className="mt-5 space-y-2">{suggestions.map((suggestion) => <button key={suggestion.id} type="button" aria-pressed={selectedId === suggestion.id} onClick={() => setSelectedId(suggestion.id)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedId === suggestion.id ? 'border-[#172a43] bg-[#d7f36b]/25' : 'border-[#172a43]/10 bg-white/65 hover:bg-white'}`}><span className="flex flex-wrap items-start justify-between gap-2"><span className="text-xs font-semibold">{suggestion.title}</span><span className="shrink-0 text-[10px] font-medium">{suggestion.minutes} dk · {suggestion.cost === undefined ? 'ücretsiz' : `≈ ${formatCurrency(suggestion.cost)}`}</span></span><span className="mt-1 block text-[10px] leading-relaxed text-[#172a43]/55">{suggestion.reason}</span></button>)}</div>
      {selected && <div className="mt-3 rounded-2xl bg-white/75 p-4"><p className="text-xs font-semibold">{selected.title}</p><p className="mt-1 text-[11px] leading-relaxed text-[#172a43]/65">{selected.detail}</p><p className="mt-2 text-[10px] text-[#172a43]/45">Önerilen yer: {selected.location}{selected.cost !== undefined ? ' · maliyet yaklaşık demo tahminidir' : ''}</p></div>}
      {message && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">{message}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-[#172a43]/45">Hiçbir öneri zorunlu görev değildir. Google Takvim’e otomatik olarak etkinlik eklenmez.</p>
      {added ? <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[#d7f36b]/35 p-3 text-xs"><span>Etkinlik SALT takvimine eklendi.</span><button onClick={onClose} className="font-semibold underline">Kapat</button></div> : <div className="mt-5 flex flex-wrap justify-end gap-2"><button onClick={() => { setSuggestions([]); setSelectedId(null); setMessage('') }} className="rounded-full border border-[#172a43]/15 px-4 py-2.5 text-xs font-semibold">Yanıtları düzenle</button><button onClick={onClose} className="rounded-full border border-[#172a43]/15 px-4 py-2.5 text-xs font-semibold">Şimdi değil</button>{selected && <button onClick={() => { if (onAddActivity(selected)) setAdded(true); else setMessage('Bu boş zaman artık uygun görünmüyor. Etkinlikler değişmiş olabilir; öneriyi SALT planına eklemedim.') }} className="rounded-full bg-[#172a43] px-4 py-2.5 text-xs font-semibold text-white">SALT planına ekle</button>}</div>}
    </>}
  </Modal>
}

function ScheduleEventRow({ event, route, onToggle, onEdit, onDelete, onRecordCoffee }: { event: ScheduleEvent; route?: DemoTransportRoute; onToggle: () => void; onEdit: () => void; onDelete: () => void; onRecordCoffee: () => void }) {
  const planned = event.plannedBudget
  return <article className="relative flex gap-3 py-3 sm:gap-5">
    <div className="w-12 shrink-0 pt-1 text-[11px] font-semibold tabular-nums text-[#172a43]/55 sm:w-14">{event.time}</div>
    <div className="relative flex w-5 shrink-0 justify-center"><span className="absolute bottom-[-20px] top-2 border-l border-[#172a43]/10 last:hidden"/><button aria-label={event.completed ? `${event.title} tamamlandı durumunu geri al` : `${event.title} tamamlandı olarak işaretle`} onClick={onToggle} className={`relative z-[1] mt-1 grid size-[18px] shrink-0 place-items-center rounded-full border ${event.completed ? 'border-[#172a43] bg-[#172a43] text-[10px] text-[#d7f36b]' : 'border-[#172a43]/25 bg-[#f8f7f2]'}`}>{event.completed ? '✓' : ''}</button></div>
    <div className={`min-w-0 flex-1 rounded-2xl px-3 py-2 sm:px-4 ${event.completed ? 'bg-[#172a43]/[0.025]' : 'bg-transparent'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className={`text-xs font-semibold ${event.completed ? 'text-[#172a43]/45 line-through' : ''}`}>{event.title}</h3><p className="mt-1 text-[10px] text-[#172a43]/45">{event.location || 'Varış adresi gerekli'}{event.origin ? ` · ${event.origin} çıkışlı` : ''}</p></div><div className="flex shrink-0 gap-1"><button onClick={onEdit} className="rounded-full px-2.5 py-1.5 text-[10px] font-medium text-[#172a43]/55 hover:bg-white">Düzenle</button><button onClick={onDelete} aria-label={`${event.title} etkinliğini sil`} className="rounded-full px-2 py-1.5 text-[10px] text-[#172a43]/40 hover:bg-white hover:text-red-700">Sil</button></div></div>
      {planned !== undefined && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#d7f36b]/25 px-3 py-2 text-[10px]"><span>Planlanan bütçe <strong>{formatCurrency(planned)}</strong></span>{event.actualSpend === undefined ? <button onClick={onRecordCoffee} className="font-semibold underline decoration-[#172a43]/30 underline-offset-2">Gerçek harcamayı kaydet</button> : <><span>Gerçekleşen <strong>{formatCurrency(event.actualSpend)}</strong></span><span className="font-semibold">Kalan {formatCurrency(planned - event.actualSpend)}</span><button onClick={onRecordCoffee} className="underline decoration-[#172a43]/30 underline-offset-2">Düzenle</button></>}</div>}
      {event.transportRequested && <div className="mt-4"><TransportPlanCard event={event} route={route} onEdit={onEdit} /></div>}
    </div>
  </article>
}

function TransportPlanCard({ event, route, onEdit }: { event: ScheduleEvent; route?: DemoTransportRoute; onEdit: () => void }) {
  const addressMatches = route ? event.origin.trim() === route.origin && (route.direction === 'return' ? event.location.trim() === '' : event.location.trim() === route.destination) : false
  const dayMatches = route ? event.date === event.demoDate : false
  const timeMatches = route ? event.time === route.eventTime : false
  const hasMissingAddress = !event.origin.trim() || !event.location.trim()
  const routeNeedsReview = !route || !addressMatches || !dayMatches || !timeMatches || hasMissingAddress
  const departure = route && addressMatches ? shiftTime(event.time, route.durationMinutes + route.bufferMinutes) : null
  const stepsCanBeShown = route && addressMatches && dayMatches
  const routeStart = route?.direction === 'return' ? 'Zorlu Center, Beşiktaş' : event.origin || route?.origin || 'Başlangıç noktası eksik'
  const routeEnd = route?.direction === 'return' ? route.destination : event.location || route?.destination || 'Varış adresi eksik'
  return <article className="overflow-hidden rounded-[24px] border border-[#172a43]/[0.08] bg-white/75">
    <div className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#172a43]/40">{route?.direction === 'return' ? 'DÖNÜŞ ROTASI' : 'GİDİŞ ROTASI'}</p><h3 className="mt-1 text-base font-semibold tracking-tight">{event.title}</h3></div><span className="rounded-full bg-[#d7f36b]/45 px-3 py-1.5 text-[10px] font-semibold">{route && addressMatches ? `≈ ${route.durationMinutes} dk · demo tahmini` : 'Rota doğrulanmadı'}</span></div>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-[#f8f7f2] p-3"><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-wider text-[#172a43]/40">BAŞLANGIÇ</p><p className="mt-1 break-words text-[11px] font-semibold">{routeStart}</p></div><span className="text-[#172a43]/35">→</span><div className="min-w-0 text-right"><p className="text-[9px] font-bold uppercase tracking-wider text-[#172a43]/40">VARIŞ</p><p className="mt-1 break-words text-[11px] font-semibold">{routeEnd}</p></div></div>
      {route && <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-[#172a43]/[0.07] p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-[#172a43]/40">ETKİNLİK / HEDEF SAATİ</p><p className="mt-1 text-sm font-semibold tabular-nums">{event.time}</p><p className="text-[10px] text-[#172a43]/45">{dateLabel(event.date)}</p></div><div className="rounded-xl border border-[#172a43]/[0.07] p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-[#172a43]/40">ÖNERİLEN HAREKET</p><p className="mt-1 text-sm font-semibold tabular-nums">{departure ?? 'Rota doğrulanmalı'}</p><p className="text-[10px] text-[#172a43]/45">{departure ? `${route.durationMinutes} dk + ${route.bufferMinutes} dk demo payı` : 'Adres eşleşmeden süre hesaplanmaz'}</p></div></div>}
      {routeNeedsReview && <div className="mt-4 rounded-xl border border-amber-700/15 bg-amber-50 p-3 text-[11px] leading-relaxed text-[#172a43]/75"><strong>Bu rota yeniden doğrulanmalı.</strong> {!route ? 'Bu etkinlik için kayıtlı bir demo güzergâhı yok.' : !addressMatches ? 'Etkinliğin başlangıç veya varış konumu demo rotasından farklı.' : !dayMatches ? 'Etkinlik günü demo planın gününden farklı.' : !timeMatches ? 'Etkinlik saati değişti; sefer aralıkları bu demoda doğrulanmıyor.' : 'Varış adresi eksik; 18:00 hedefinin mümkünlüğü doğrulanamaz.'} {hasMissingAddress && <button onClick={onEdit} className="ml-1 font-semibold underline underline-offset-2">Adresi ekle.</button>}</div>}
      {route && !routeNeedsReview && <p className="mt-4 rounded-xl bg-[#d7f36b]/25 p-3 text-[11px] leading-relaxed">Örnek planla eşleşiyor; yine de süre ve sefer güncel resmî veri değildir.</p>}
      {route && stepsCanBeShown && <div className="mt-5"><p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#172a43]/45">ÖRNEK ROTA ADIMLARI · GERÇEK ZAMANLI DEĞİL</p><ol className="ml-2 border-l border-[#172a43]/15">{route.steps.map((step, index) => <li key={`${route.id}-${step.mode}-${index}`} className="relative ml-4 pb-4 last:pb-0"><span className="absolute -left-[21px] top-0.5 grid size-3 place-items-center rounded-full border-2 border-[#f8f7f2] bg-[#d7f36b] ring-1 ring-[#172a43]/15"/><p className="text-[11px] font-semibold">{step.mode} <span className="font-normal text-[#172a43]/45">· ≈{step.minutes} dk</span></p><p className="mt-1 text-[10px] leading-relaxed text-[#172a43]/60">{step.from} → {step.to}</p>{step.transfer && <p className="mt-1 text-[9px] font-semibold text-[#172a43]/50">Aktarma / not: {step.transfer}</p>}</li>)}</ol></div>}
      {route && !stepsCanBeShown && <p className="mt-4 rounded-xl bg-[#172a43]/[0.04] p-3 text-[11px] leading-relaxed text-[#172a43]/65">Etkinlik adresi veya günü demo rotayla eşleşmiyor. Eski adımları göstermiyorum; yeni rota ve süreyi resmî kaynaklarda doğrula.</p>}
      {route?.direction === 'return' && <p className="mt-4 rounded-xl bg-[#172a43]/[0.045] p-3 text-[11px] leading-relaxed text-[#172a43]/70">{route.caveat}</p>}
      {route && route.direction === 'outbound' && <p className="mt-4 text-[10px] leading-relaxed text-[#172a43]/50">{route.caveat}</p>}
      {!route && <div className="mt-4 rounded-xl bg-[#172a43]/[0.04] p-3 text-[11px] leading-relaxed text-[#172a43]/60">{hasMissingAddress ? 'Başlangıç ve varış adresini etkinliği düzenleyerek ekle. Adres olmadan demo rota gösteremiyoruz.' : 'Bu yer için demo rota verisi yok. Gerçek rota için resmî kaynakları kontrol et.'}</div>}
      <button onClick={onEdit} className="mt-4 rounded-full border border-[#172a43]/15 px-3 py-2 text-[10px] font-semibold hover:bg-[#f8f7f2]">Etkinlik ve adresi düzenle</button>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[#172a43]/[0.07] px-5 py-4 sm:px-6">{OFFICIAL_TRANSPORT_LINKS.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-[#172a43]/65 underline decoration-[#172a43]/20 underline-offset-4 hover:text-[#172a43]">{link.label} ↗</a>)}</div>
  </article>
}

function TaskRow({ task, onToggle, onEdit, onDelete }: { task: Task; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[#172a43]/[0.03]"><button aria-label={task.completed ? `${task.title} görevini tamamlanmadı yap` : `${task.title} görevini tamamla`} onClick={onToggle} className={`grid size-[18px] shrink-0 place-items-center rounded-full border ${task.completed ? 'border-[#172a43] bg-[#172a43] text-[10px] text-[#d7f36b]' : 'border-[#172a43]/20 hover:border-[#172a43]/50'}`}>{task.completed ? '✓' : ''}</button><button onClick={onEdit} className="min-w-0 flex-1 py-1 text-left"><span className={`block truncate text-xs font-medium ${task.completed ? 'text-[#172a43]/40 line-through' : ''}`}>{task.title}</span><span className="mt-1 block text-[10px] text-[#172a43]/40">{task.detail}</span></button>{task.priority && <span className="rounded-full bg-[#d7f36b]/45 px-2.5 py-1 text-[9px] font-bold tracking-wide">ÖNCELİKLİ</span>}<button onClick={onEdit} aria-label={`${task.title} görevini düzenle`} className="rounded p-2 text-[11px] text-[#172a43]/45 hover:bg-white">Düzenle</button><button onClick={onDelete} aria-label={`${task.title} görevini sil`} className="rounded p-2 text-[11px] text-[#172a43]/45 hover:bg-white hover:text-red-700">Sil</button></div>
}

function InboxView({ text, setText, candidates, setCandidates, onExtract, onApprove }: { text: string; setText: (text: string) => void; candidates: Candidate[]; setCandidates: (items: Candidate[]) => void; onExtract: () => void; onApprove: (candidate: Candidate) => void }) {
  return <><PageHeading eyebrow="GELEN KUTUSU" title="Notlarından görev çıkar." subtitle="E-posta veya mesajını ekle. Bulduğumuz görevleri planına almadan önce sen onayla." />
    <section className="mt-9 grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_0.9fr]"><div className="rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7"><label htmlFor="inbox-source" className="text-sm font-semibold">Mesaj metni</label><textarea id="inbox-source" value={text} onChange={(event) => setText(event.target.value)} placeholder={'Örnek:\n- Cuma gününe kadar proje raporunu gönder\n- Yarın kütüphaneden kitabı al'} className="mt-4 min-h-52 w-full resize-y rounded-2xl border border-[#172a43]/10 bg-[#f8f7f2] p-4 text-sm leading-relaxed outline-none focus:border-[#172a43]/35" /><div className="mt-4 flex items-center justify-between gap-3"><p className="text-[11px] text-[#172a43]/45">Metin yalnızca bu tarayıcıda işlenir.</p><button onClick={onExtract} disabled={!text.trim()} className="rounded-full bg-[#172a43] px-5 py-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Görev adaylarını çıkar</button></div></div>
      <div className="rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Onay bekleyenler</h2><p className="mt-1 text-xs text-[#172a43]/45">{candidates.length} görev adayı</p></div><span className="grid size-9 place-items-center rounded-xl bg-[#d7f36b]/50 text-sm">✳</span></div>{candidates.length === 0 ? <p className="mt-6 rounded-2xl bg-[#172a43]/[0.03] px-4 py-8 text-center text-xs leading-relaxed text-[#172a43]/50">Henüz aday yok.<br />Bir mesaj yapıştırıp görevleri çıkar.</p> : <div className="mt-5 space-y-3">{candidates.map((candidate) => <div key={candidate.id} className="rounded-2xl border border-[#172a43]/[0.08] p-4"><input aria-label="Görev adayı" value={candidate.title} onChange={(event) => setCandidates(candidates.map((item) => item.id === candidate.id ? { ...item, title: event.target.value } : item))} className="w-full bg-transparent text-xs font-medium outline-none" /><div className="mt-3 flex justify-end gap-2"><button onClick={() => setCandidates(candidates.filter((item) => item.id !== candidate.id))} className="rounded-full px-3 py-2 text-[10px] font-semibold text-[#172a43]/55 hover:bg-[#172a43]/5">Yoksay</button><button disabled={!candidate.title.trim()} onClick={() => onApprove(candidate)} className="rounded-full bg-[#172a43] px-4 py-2 text-[10px] font-semibold text-white disabled:opacity-40">Onayla ve ekle</button></div></div>)}</div>}</div>
    </section>
  </>
}

function LifeView({ budget, setBudget, spent, remaining, monthlyExpenseCount, expenses, onAddExpense, onDeleteExpense, habits, onToggleHabit, onAddHabit, onDeleteHabit }: { budget: number; setBudget: (value: number) => void; spent: number; remaining: number; monthlyExpenseCount: number; expenses: Expense[]; onAddExpense: () => void; onDeleteExpense: (id: string) => void; habits: Habit[]; onToggleHabit: (id: string) => void; onAddHabit: (title: string) => void; onDeleteHabit: (id: string) => void }) {
  const [habitDraft, setHabitDraft] = useState('')
  const progress = habits.length ? Math.round(habits.filter((habit) => habit.done).length / habits.length * 100) : 0
  return <><PageHeading eyebrow="LIFE" title="Kendi ritmini kur." subtitle="Bütçeni takip et ve bugün kendin için yaptıklarını kutla." />
    <section className="mt-9 grid grid-cols-1 gap-5 lg:grid-cols-2"><div className="rounded-[24px] bg-[#172a43] p-6 text-white sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-medium text-white/55">Bu ay kalan bütçe</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatCurrency(remaining)}</p></div><span className="grid size-12 place-items-center rounded-2xl bg-[#d7f36b] text-xl text-[#172a43]">₺</span></div><div className="mt-6 flex items-center justify-between text-[11px] text-white/60"><span>Harcanan {formatCurrency(spent)}</span><span>Bütçe {formatCurrency(budget)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15"><div className={`h-full rounded-full bg-[#d7f36b] transition-all ${spent > budget ? 'bg-red-300' : ''}`} style={{ width: `${budget > 0 ? Math.min(100, spent / budget * 100) : spent > 0 ? 100 : 0}%` }} /></div><label className="mt-6 block text-[11px] font-medium text-white/65">Aylık bütçe tutarı</label><div className="mt-2 flex gap-2"><input aria-label="Aylık bütçe" type="number" min="0" step="100" value={budget} onChange={(event) => setBudget(Math.max(0, Number(event.target.value) || 0))} className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-[#d7f36b]" /><span className="self-center text-sm text-white/60">₺</span></div>{remaining < 0 && <p className="mt-2 text-xs text-red-200">Bütçeni {formatCurrency(Math.abs(remaining))} aştın.</p>}</div>
      <div className="rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold">Alışkanlıklar</h2><p className="mt-1 text-xs text-[#172a43]/45">Bugün {habits.filter((habit) => habit.done).length}/{habits.length} tamamlandı · %{progress}</p></div><span className="text-lg">✳</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#172a43]/[0.07]"><div className="h-full rounded-full bg-[#b5d443] transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-4 space-y-1">{habits.map((habit) => <div key={habit.id} className="flex items-center gap-3 rounded-xl px-2 py-2"><button onClick={() => onToggleHabit(habit.id)} aria-label={`${habit.title} alışkanlığını ${habit.done ? 'geri al' : 'tamamla'}`} className={`grid size-[18px] shrink-0 place-items-center rounded-full border ${habit.done ? 'border-[#172a43] bg-[#172a43] text-[10px] text-[#d7f36b]' : 'border-[#172a43]/20'}`}>{habit.done ? '✓' : ''}</button><span className={`flex-1 text-xs ${habit.done ? 'text-[#172a43]/45 line-through' : ''}`}>{habit.title}</span><button onClick={() => onDeleteHabit(habit.id)} aria-label={`${habit.title} alışkanlığını sil`} className="px-2 text-xs text-[#172a43]/35 hover:text-red-700">Sil</button></div>)}{habits.length === 0 && <p className="py-4 text-center text-xs text-[#172a43]/45">Henüz alışkanlık eklenmedi.</p>}</div><form onSubmit={(event) => { event.preventDefault(); const title = habitDraft.trim(); if (title) { onAddHabit(title); setHabitDraft('') } }} className="mt-3 flex gap-2"><input aria-label="Yeni alışkanlık" value={habitDraft} onChange={(event) => setHabitDraft(event.target.value)} maxLength={80} placeholder="Yeni alışkanlık ekle" className="min-w-0 flex-1 rounded-xl border border-[#172a43]/10 bg-[#f8f7f2] px-3 py-2.5 text-xs outline-none focus:border-[#172a43]/35" /><button aria-label="Alışkanlık ekle" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#172a43] text-lg text-[#d7f36b]">+</button></form></div>
    </section>
    <section className="mt-6 rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Harcamalar</h2><p className="mt-1 text-xs text-[#172a43]/45">Bu ay {monthlyExpenseCount} harcama · toplam {formatCurrency(spent)}</p></div><button onClick={onAddExpense} className="rounded-full bg-[#172a43] px-4 py-2.5 text-xs font-semibold text-white"><span className="mr-1 text-[#d7f36b]">+</span> Harcama ekle</button></div>{expenses.length === 0 ? <p className="mt-5 rounded-xl bg-[#172a43]/[0.03] px-4 py-6 text-center text-xs text-[#172a43]/45">Henüz harcama kaydedilmedi.</p> : <div className="mt-5 divide-y divide-[#172a43]/[0.07]">{expenses.map((expense) => <div key={expense.id} className="flex items-center gap-3 py-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#172a43]/[0.05] text-sm">↘</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{expense.title}</p><p className="mt-1 text-[10px] text-[#172a43]/45">{expense.category} · {expense.date}</p></div><span className="text-xs font-semibold">{formatCurrency(expense.amount)}</span><button onClick={() => onDeleteExpense(expense.id)} aria-label={`${expense.title} harcamasını sil`} className="px-2 py-2 text-[10px] text-[#172a43]/45 hover:text-red-700">Sil</button></div>)}</div>}</section>
  </>
}

function ProfileView({ profile, onEdit }: { profile: UserProfile | null; onEdit: () => void }) {
  const status = profile?.lifeStatus === 'both' ? 'Öğrenci ve çalışıyor' : profile?.lifeStatus === 'student' ? 'Öğrenci' : profile?.lifeStatus === 'working' ? 'Çalışıyor' : 'Kendi planını oluşturuyor'
  return <>
    <PageHeading eyebrow="PROFİL" title="SALT, senin hayatına göre." subtitle="Temel bilgilerini güncel tut; günlük planını ve önerilerini kişisel bağlamına göre düzenle." />
    <section className="mt-8 max-w-3xl rounded-[24px] border border-[#172a43]/[0.07] bg-white/70 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#172a43]/40">DİJİTAL PROFİLİN</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{profile?.displayName || 'Profil bilgileri eklenmemiş'}</h2><p className="mt-1 text-xs text-[#172a43]/55">{status}</p></div><button onClick={onEdit} className="rounded-full bg-[#172a43] px-4 py-2.5 text-xs font-semibold text-white">Profili düzenle</button></div>
      {profile && <div className="mt-6 grid gap-3 sm:grid-cols-2">{profile.schoolName && <ProfileDatum label="Okul" value={profile.schoolName} />}{profile.fieldOfStudy && <ProfileDatum label="Bölüm / alan" value={profile.fieldOfStudy} />}{profile.studyYear && <ProfileDatum label="Sınıf / dönem" value={profile.studyYear} />}{profile.workplace && <ProfileDatum label="İş yeri" value={profile.workplace} />}{profile.jobTitle && <ProfileDatum label="Görev" value={profile.jobTitle} />}{profile.interests && <ProfileDatum label="İlgi alanları" value={profile.interests} />}{profile.focusGoal && <ProfileDatum label="Şu sıralar önceliğin" value={profile.focusGoal} />}</div>}
      <p className="mt-6 rounded-2xl bg-[#d7f36b]/30 p-4 text-xs leading-relaxed text-[#172a43]/70">Bu dijital profil, senin girdiğin bilgilerle Today selamlamasını ve öneri metinlerini kişiselleştirir. Şu an yapay zekâ çıkarımı veya harici profil servisi yok. Bilgiler yalnızca bu tarayıcının localStorage alanında saklanır.</p>
    </section>
  </>
}
function ProfileDatum({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[#172a43]/[0.035] p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#172a43]/40">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div> }
function ProfileForm({ profile, onSubmit, onCancel, required }: { profile: UserProfile | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void; required: boolean }) {
  const [lifeStatus, setLifeStatus] = useState<UserProfile['lifeStatus']>(profile?.lifeStatus ?? 'student')
  const student = lifeStatus === 'student' || lifeStatus === 'both'
  const working = lifeStatus === 'working' || lifeStatus === 'both'
  return <form onSubmit={onSubmit} className="space-y-4">
    <Field label="Adın"><input autoFocus name="displayName" required maxLength={80} defaultValue={profile?.displayName ?? ''} placeholder="Örn. Deniz Yılmaz" /></Field>
    <Field label="Şu an ne yapıyorsun?"><select name="lifeStatus" value={lifeStatus} onChange={(event) => setLifeStatus(event.target.value as UserProfile['lifeStatus'])}><option value="student">Üniversitede okuyorum</option><option value="working">Çalışıyorum</option><option value="both">Hem okuyorum hem çalışıyorum</option><option value="neither">Şu an ikisi de değil</option></select></Field>
    {student && <div className="space-y-4 rounded-2xl bg-white/60 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-[#172a43]/45">EĞİTİM</p><Field label="Okul / üniversite"><input name="schoolName" maxLength={100} defaultValue={profile?.schoolName ?? ''} placeholder="Örn. İstanbul Üniversitesi" /></Field><Field label="Bölüm / ne okuyorsun?"><input name="fieldOfStudy" maxLength={100} defaultValue={profile?.fieldOfStudy ?? ''} placeholder="Örn. Psikoloji" /></Field><Field label="Sınıf veya dönem (isteğe bağlı)"><input name="studyYear" maxLength={40} defaultValue={profile?.studyYear ?? ''} placeholder="Örn. 2. sınıf" /></Field></div>}
    {working && <div className="space-y-4 rounded-2xl bg-white/60 p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-[#172a43]/45">İŞ</p><Field label="İş yeri / kurum"><input name="workplace" maxLength={100} defaultValue={profile?.workplace ?? ''} placeholder="Örn. Stüdyo adı" /></Field><Field label="Görevin / rolün"><input name="jobTitle" maxLength={100} defaultValue={profile?.jobTitle ?? ''} placeholder="Örn. Yarı zamanlı barista" /></Field></div>}
    <Field label="İlgi alanların (isteğe bağlı)"><input name="interests" maxLength={160} defaultValue={profile?.interests ?? ''} placeholder="Örn. fotoğrafçılık, koşu" /></Field>
    <Field label="Şu sıralar önceliğin (isteğe bağlı)"><input name="focusGoal" maxLength={160} defaultValue={profile?.focusGoal ?? ''} placeholder="Örn. dönem projesini bitirmek" /></Field>
    <div className="flex justify-end gap-2 pt-2">{!required && <button type="button" onClick={onCancel} className="rounded-full px-4 py-2.5 text-xs font-semibold text-[#172a43]/60 hover:bg-[#172a43]/5">Vazgeç</button>}<button className="rounded-full bg-[#172a43] px-5 py-2.5 text-xs font-semibold text-white">{required ? 'Profili oluştur ve başla' : 'Değişiklikleri kaydet'}</button></div>
  </form>
}
function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <section className="mt-10 md:mt-14"><p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#172a43]/40">{eyebrow}</p><h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">{title}</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-[#172a43]/55">{subtitle}</p></section> }
function formatCurrency(value: number) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(value) }
function NavItem({ name, icon, active, onClick, compact = false }: { name: Section; icon: string; active: boolean; onClick: () => void; compact?: boolean }) { return <button onClick={onClick} aria-current={active ? 'page' : undefined} className={`flex items-center rounded-xl text-sm font-medium transition ${compact ? 'min-w-0 flex-1 flex-col gap-1 px-1 py-1 text-[9px] sm:text-[10px]' : 'w-full gap-3 px-3 py-2.5'} ${active ? 'bg-[#172a43] text-white' : 'text-[#172a43]/55 hover:bg-[#172a43]/[0.05] hover:text-[#172a43]'}`}><span className={`${compact ? 'text-lg leading-5' : 'grid size-5 place-items-center text-base'} ${active && compact ? 'text-[#d7f36b]' : ''}`}>{icon}</span><span className={compact ? 'truncate' : ''}>{name}</span></button> }
function Modal({ title, children, onClose, dismissable = true }: { title: string; children: ReactNode; onClose: () => void; dismissable?: boolean }) { return <div className="fixed inset-0 z-30 grid place-items-center bg-[#172a43]/35 p-4" onMouseDown={(event) => { if (dismissable && event.target === event.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[24px] bg-[#f8f7f2] p-5 shadow-2xl sm:p-7"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2>{dismissable && <button onClick={onClose} aria-label="Kapat" className="grid size-9 place-items-center rounded-full hover:bg-[#172a43]/5">×</button>}</div>{children}</section></div> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="modal-field block space-y-2 text-xs font-medium text-[#172a43]/75">{label}{children}</label> }
function FormActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) { return <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onCancel} className="rounded-full px-4 py-2.5 text-xs font-semibold text-[#172a43]/60 hover:bg-[#172a43]/5">Vazgeç</button><button className="rounded-full bg-[#172a43] px-5 py-2.5 text-xs font-semibold text-white">{submitLabel}</button></div> }

export default App
