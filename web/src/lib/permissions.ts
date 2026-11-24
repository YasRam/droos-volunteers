/**
 * Every permission the database understands (app.has_perm). A role is a named set of these,
 * edited from الإعدادات ← الصلاحيات. To add a new permission: add it here, then use it in a
 * policy or check in a new migration.
 */
export const PERMISSION_GROUPS = [
  {
    title: 'المتطوعين',
    items: [
      { key: 'volunteers.view_all', label: 'يشوف كل المتطوعين وبياناتهم' },
      { key: 'volunteers.edit', label: 'يضيف ويعدّل ويمسح المتطوعين (والحالة واللجان)' },
      { key: 'directory.view', label: 'يشوف أسماء وأرقام كل المتطوعين بس' },
      { key: 'national_id.view', label: 'يشوف الرقم القومي' },
      { key: 'national_id.edit', label: 'يعدّل الرقم القومي' },
      { key: 'certificates.review', label: 'يشوف طلبات شهادات التطوع ويرد عليها' },
    ],
  },
  {
    title: 'المقابلة (HR)',
    items: [
      { key: 'hr.view', label: 'يشوف بيانات المقابلة ودرجة القبول' },
      { key: 'hr.notes', label: 'يشوف ملاحظات الـ HR' },
      { key: 'hr.edit', label: 'يعدّل بيانات المقابلة والملاحظات' },
    ],
  },
  {
    title: 'الحضور والمشاركات',
    items: [
      { key: 'attendance.register', label: 'يسجّل حضور لأي متطوع' },
      { key: 'attendance.any_date', label: 'يسجّل ويعدّل بأي تاريخ (من غيرها آخر 7 أيام بس)' },
      { key: 'attendance.review', label: 'يوافق ويرفض طلبات الحضور' },
      { key: 'attendance.view_all', label: 'يشوف كل المشاركات (المتابعة اليومية)' },
      { key: 'attendance.delete', label: 'يمسح مشاركات' },
    ],
  },
  {
    title: 'باقي السيستم',
    items: [
      { key: 'schedule.edit', label: 'يعدّل جدول الحصص' },
      { key: 'stats.view', label: 'يشوف الإحصائيات' },
      { key: 'data.export', label: 'ينزّل البيانات Excel' },
      { key: 'data.import', label: 'يضيف بيانات من Excel' },
      { key: 'backup.manage', label: 'ينزّل نسخة احتياطية كاملة ويسترجعها (فيها الرقم القومي وملاحظات HR)' },
      { key: 'log.view', label: 'يشوف السجل' },
      { key: 'settings.manage', label: 'يعدّل القوائم والإعدادات وجروبات الواتساب' },
      { key: 'roles.manage', label: 'يدّي ويشيل صلاحيات' },
    ],
  },
] as const

export type Permission = (typeof PERMISSION_GROUPS)[number]['items'][number]['key']
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)) as Permission[]
export const PERMISSION_LABEL = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label]))) as Record<Permission, string>
