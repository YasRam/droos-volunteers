/** Key of a row in public.roles (built-in: admin, activity_leader, hr, management, organizer). */
export type AppRole = string
/** Values come from the «حالة المتطوع» list (editable); these are the defaults. */
export type VolunteerStatus = string
/** Values come from the «حالة القبول» list (editable); these are the defaults. */
export type AcceptanceGrade = string
export type RequestStatus = 'pending' | 'accepted' | 'rejected'
/** الوظيفة: one per volunteer, drives the structure tree. */
export type Position = 'متطوع' | 'HR' | 'تنظيم' | 'ليدر لجنة' | 'نائب ليدر لجنة' | 'نائب ليدر النشاط' | 'ليدر النشاط'
export const POSITIONS: Position[] = ['متطوع', 'HR', 'تنظيم', 'ليدر لجنة', 'نائب ليدر لجنة', 'نائب ليدر النشاط', 'ليدر النشاط']
export type Weekday = 'السبت' | 'الأحد' | 'الاثنين' | 'الثلاثاء' | 'الأربعاء' | 'الخميس' | 'الجمعة'

export const STATUSES: VolunteerStatus[] = ['تحت المتابعة', 'مشروع مسئول', 'مسئول', 'مدرب', 'خارج المتابعة']
export const ACCEPTANCE: AcceptanceGrade[] = ['اختبار', 'مقبول', 'رفض الانترفيو', 'مرفوض', 'معتذر', 'معتذر نهائى', 'مفصول']
export const WEEKDAYS: Weekday[] = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
export const REQUEST_LABEL: Record<RequestStatus, string> = {
  pending: 'مستني موافقة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
}

export interface MyContext {
  email: string | null
  full_name: string | null
  role: AppRole | null
  role_name: string | null
  roles: string[]
  position: Position | null
  permissions: string[]
  is_full: boolean
  is_staff: boolean
  is_organizer: boolean
  committees: string[]
  volunteer_id: string | null
  inactive?: boolean
}

export interface Volunteer {
  id: string
  code: string
  full_name_ar: string
  full_name_en: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  qualification: string | null
  job: string | null
  area: string | null
  availability_notes: string | null
  referral_source: string | null
  birth_date: string | null
  gender: 'ذكر' | 'أنثى' | null
  registered_at: string
  status: VolunteerStatus
  position: Position
  main_committee: string | null
  sub_committee: string | null
  contacted: boolean
  passed_committee_test: boolean
  joined_group: boolean
  is_active: boolean
  bought_tshirt: boolean
  attended_minicamp: boolean
  minicamp_date: string | null
  updated_at: string
  updated_by: string | null
  facebook?: string | null
  study_year?: string | null
  follower_id?: string | null
  follower_trainee_id?: string | null
  follow_head_id?: string | null
  follow_notes_1?: string | null
  follow_notes_2?: string | null
  follow_notes_3?: string | null
  out_reason?: string | null
  attended_camp?: boolean
  camp_date?: string | null
  attended_graduation?: boolean
  graduation_date?: string | null
}

export interface VolunteerDirectoryRow {
  id: string
  code: string
  full_name_ar: string
  phone: string | null
  whatsapp: string | null
  status: VolunteerStatus
}

export interface VolunteerPrivate {
  volunteer_id: string
  national_id: string | null
  requested_national_id: string | null
  requested_at: string | null
}

export interface VolunteerHr {
  volunteer_id: string
  acceptance: AcceptanceGrade | null
  interview_date: string | null
  interviewer: string | null
  interviewer_id?: string | null
  hr_notes: string | null
  status_changed_at: string | null
}

export interface VolunteerStats {
  volunteer_id: string
  last_participation: string | null
  this_month: number
  last_month: number
  total: number
}

export interface Participation {
  id: string
  legacy_code: string | null
  volunteer_id: string
  activity_date: string
  event: string
  subject: string | null
  place: string | null
  grade: string | null
  beneficiaries: number | null
  notes: string | null
  status: RequestStatus
  method: 'individual' | 'group'
  group_activity_id: string | null
  created_by: string | null
  created_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  meeting_id?: string | null
  duration_minutes?: number | null
}

export interface ScheduleSlot {
  id: string
  day: Weekday
  grade: string
  subject: string
  teacher_name: string | null
  volunteer_id: string | null
  starts_at: string
  ends_at: string
  place?: string | null
  kind?: string
  audience?: string
  takes_attendance?: boolean
  notes?: string | null
  co_teachers?: string[]
  teaching_mode?: 'مع بعض' | 'بالتبادل'
}

export interface Lookup {
  id: number
  list: string
  value: string
  parent: string | null
  sort_order: number
  is_active: boolean
  link: string | null
  form: 'teaching' | 'none' | 'optional' | null
  report_column?: string | null
}

export interface StaffRole {
  email: string
  full_name: string
  role: AppRole
  volunteer_id: string | null
  active: boolean
  created_at: string
}

export interface Role {
  key: string
  name: string
  description: string | null
  permissions: string[]
  is_builtin: boolean
  sort_order: number
}

export interface CommitteeLeader {
  email: string
  committee: string
  full_name: string
  volunteer_id: string | null
  role?: 'ليدر' | 'نائب'
}

export interface Notification {
  id: number
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export interface AuditRow {
  id: number
  at: string
  actor_email: string | null
  table_name: string
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  record_id: string | null
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
  actor_name: string | null
  target_name: string | null
  target_volunteer_id: string | null
}

export interface MonthlyParticipation {
  month: string
  event: string
  committee: string
  participations: number
  volunteers: number
}
