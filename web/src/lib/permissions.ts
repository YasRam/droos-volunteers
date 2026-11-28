import {
  Award,
  BarChart3,
  BookOpen,
  BookUser,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX,
  CheckCheck,
  ClipboardList,
  DatabaseBackup,
  Download,
  Eye,
  FileText,
  GraduationCap,
  History,
  IdCard,
  KeyRound,
  ListChecks,
  Mail,
  MessageSquareLock,
  PhoneCall,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Shirt,
  Tent,
  Trash2,
  Upload,
  UserCog,
  UserPen,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
  Wallet,
} from 'lucide-react'

export interface PermissionItem {
  key: string
  label: string
  /** what it opens, in one line */
  hint: string
  icon: LucideIcon
}
export interface PermissionGroup {
  title: string
  icon: LucideIcon
  items: readonly PermissionItem[]
}

/**
 * Every permission the database understands (app.has_perm). A role is a named set of these,
 * edited from الصلاحيات ← أنواع الصلاحيات. To add a new permission: add it here, then use it in a
 * policy or check in a new migration (and give it to the admin role there).
 */
export const PERMISSION_GROUPS = [
  {
    title: 'المتطوعين',
    icon: Users,
    items: [
      { key: 'volunteers.view_all', label: 'يشوف كل المتطوعين', hint: 'صفحة المتطوعين وملف أي متطوع', icon: Eye },
      { key: 'directory.view', label: 'دليل الأسماء والأرقام بس', hint: 'يشوف الاسم والتليفون من غير باقي البيانات', icon: BookUser },
      { key: 'volunteers.edit', label: 'يضيف ويعدّل ويمسح متطوعين', hint: 'البيانات والحالة واللجان والوظيفة', icon: UserPen },
      { key: 'national_id.view', label: 'يشوف الرقم القومي', hint: 'بيظهر في ملف المتطوع والتصدير', icon: IdCard },
      { key: 'national_id.edit', label: 'يعدّل الرقم القومي', hint: '', icon: IdCard },
      { key: 'accounts.password', label: 'يعمل باسورد مؤقت', hint: 'للمتطوع اللي مش عارف يدخل', icon: KeyRound },
      { key: 'certificates.review', label: 'شهادات التطوع', hint: 'يشوف الطلبات ويرد عليها', icon: Award },
    ],
  },
  {
    title: 'الجداد والمقابلات (HR)',
    icon: UserPlus,
    items: [
      { key: 'recruit.manage', label: 'يتابع الجداد', hint: 'المكالمات والمقابلات وطلبات الانضمام وزرار «مقبول»', icon: PhoneCall },
      { key: 'hr.view', label: 'يشوف بيانات المقابلة', hint: 'النتيجة والدرجة وتاريخ المقابلة وصفحة الجداد', icon: ClipboardList },
      { key: 'hr.notes', label: 'يشوف ملاحظات الـ HR', hint: 'الملاحظات السرية على المتطوع', icon: MessageSquareLock },
      { key: 'hr.edit', label: 'يعدّل بيانات المقابلة', hint: 'النتيجة والملاحظات وصورة المتطوع', icon: UserCog },
    ],
  },
  {
    title: 'الحضور والاجتماعات',
    icon: CalendarCheck,
    items: [
      { key: 'attendance.register', label: 'يسجّل حضور لأي حد', hint: 'زرار «سجّل» لغيره', icon: CalendarCheck },
      { key: 'attendance.any_date', label: 'يسجّل بأي تاريخ', hint: 'من غيرها آخر 6 أيام بس', icon: CalendarDays },
      { key: 'attendance.review', label: 'يوافق على طلبات الحضور', hint: 'تبويب «الحضور» في الطلبات', icon: CheckCheck },
      { key: 'attendance.view_all', label: 'المتابعة اليومية', hint: 'يشوف كل المشاركات', icon: ListChecks },
      { key: 'attendance.delete', label: 'يمسح مشاركات', hint: '', icon: Trash2 },
      { key: 'meetings.manage', label: 'الاجتماعات', hint: 'يسجّل اجتماع لأي لجنة ويشوف كل الاجتماعات', icon: UsersRound },
    ],
  },
  {
    title: 'الحصص',
    icon: BookOpen,
    items: [
      { key: 'schedule.edit', label: 'يعدّل جدول الحصص', hint: 'المواعيد والمدرسين', icon: CalendarClock },
      { key: 'absences.review', label: 'اعتذارات الحصص', hint: 'يوافق أو يرفض اعتذار المدرس', icon: CalendarX },
    ],
  },
  {
    title: 'رحلة المتطوع',
    icon: Route,
    items: [
      { key: 'stages.manage', label: 'مراحل التطوع', hint: 'يعلّم المراحل ويعدّلها', icon: Route },
      { key: 'camps.manage', label: 'الكامبات', hint: 'الميني كامب والكامب وحفلة التخرج: تسجيل وحضور وتذكير', icon: Tent },
      { key: 'tshirts.manage', label: 'التيشيرتات', hint: 'طلبات التيشيرت', icon: Shirt },
      { key: 'rules.manage', label: 'قواعد النشاط', hint: 'يكتب القواعد ويشوف مين وافق', icon: ScrollText },
    ],
  },
  {
    title: 'الطلاب',
    icon: GraduationCap,
    items: [
      { key: 'students.view_all', label: 'يشوف كل الطلاب', hint: 'الأسامي والحضور والمجموعات والاستدعاءات (من غير تليفونات)', icon: Eye },
      { key: 'students.view_contacts', label: 'بيانات التواصل', hint: 'تليفونات الطلاب والعنوان وبيانات ولي الأمر', icon: BookUser },
      { key: 'students.view_sensitive', label: 'البيانات الحساسة', hint: 'الرقم القومي وبيانات الأب والأم والملاحظات الصحية', icon: IdCard },
      { key: 'students.finance', label: 'دخل الأسرة والدعم', hint: 'المسئول بس: دخل الأسرة والدعم اللي بياخدوه', icon: Wallet },
      { key: 'students.edit', label: 'يضيف ويعدّل طلاب', hint: 'الطلاب والقبول والمجموعات ولمين الحصة', icon: UserPen },
      { key: 'students.attendance', label: 'يسجّل حضور أي حصة', hint: 'المدرس بيسجّل حصته من غير الصلاحية دي', icon: CalendarCheck },
      { key: 'students.flags', label: 'الاستدعاء والإجازات', hint: 'استدعاء ولي أمر، فصل مؤقت، إجازة', icon: CalendarX },
      { key: 'students.flags_lift', label: 'يلغي الفصل المؤقت', hint: '', icon: CheckCheck },
      { key: 'students.review', label: 'طلبات الطلاب والحصص', hint: 'إلغاء وتأجيل وإيقاف الحصص، الفصل، تعديل البيانات', icon: ListChecks },
      { key: 'students.accounts', label: 'حسابات أولياء الأمور', hint: 'يعمل حساب ويغيّر الكود', icon: KeyRound },
    ],
  },
  {
    title: 'التقارير والبيانات',
    icon: BarChart3,
    items: [
      { key: 'stats.view', label: 'الإحصائيات والتقارير', hint: 'صفحة الإحصائيات والشيتات', icon: BarChart3 },
      { key: 'data.export', label: 'ينزّل Excel', hint: '', icon: Download },
      { key: 'data.import', label: 'يرفع من Excel', hint: '', icon: Upload },
      { key: 'backup.manage', label: 'النسخ الاحتياطية', hint: 'نسخة كاملة فيها الرقم القومي وملاحظات HR', icon: DatabaseBackup },
      { key: 'log.view', label: 'السجل', hint: 'مين عمل إيه وإمتى', icon: History },
      { key: 'mail.management', label: 'إيميلات الإدارة', hint: 'يبعت الأكسس والتطورات والطلبات ويظبط الإيميل اليومي', icon: Mail },
    ],
  },
  {
    title: 'الإعدادات',
    icon: Settings,
    items: [
      { key: 'settings.manage', label: 'القوائم والإعدادات', hint: 'القوائم وجروبات الواتساب وفورم الانضمام وربط الشيتات', icon: FileText },
      { key: 'roles.manage', label: 'الصلاحيات', hint: 'يدّي ويشيل ويوقف صلاحيات', icon: ShieldCheck },
    ],
  },
] as const satisfies readonly PermissionGroup[]

export type Permission = (typeof PERMISSION_GROUPS)[number]['items'][number]['key']
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)) as Permission[]
export const PERMISSION_LABEL = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))) as Record<Permission, string>
