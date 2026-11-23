import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge, Card, Empty, PageHeader, Select, Spinner } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import type { AuditRow } from '@/lib/types'

const TABLES: Record<string, string> = {
  volunteers: 'المتطوعين',
  volunteer_private: 'الرقم القومي',
  volunteer_hr: 'بيانات المقابلة',
  participations: 'المشاركات',
  group_activities: 'نشاط جماعي',
  schedule_slots: 'جدول الحصص',
  staff_roles: 'الصلاحيات',
  committee_leaders: 'ليدر اللجان',
}
const ACTIONS = { INSERT: { label: 'إضافة', tone: 'green' }, UPDATE: { label: 'تعديل', tone: 'blue' }, DELETE: { label: 'مسح', tone: 'red' } } as const
const SKIP = new Set(['updated_at', 'updated_by', 'created_at', 'reviewed_at'])

function changes(r: AuditRow): string {
  if (r.action !== 'UPDATE' || !r.old_row || !r.new_row) {
    const row = r.new_row ?? r.old_row ?? {}
    return String(row.full_name_ar ?? row.event ?? row.subject ?? row.email ?? row.committee ?? '')
  }
  return Object.keys(r.new_row)
    .filter((k) => !SKIP.has(k) && JSON.stringify(r.new_row![k]) !== JSON.stringify(r.old_row![k]))
    .map((k) => `${k}: ${r.old_row![k] ?? '—'} ← ${r.new_row![k] ?? '—'}`)
    .join(' · ')
}

export default function AuditLog() {
  const [table, setTable] = useState('')
  const q = useQuery({
    queryKey: ['audit', table],
    queryFn: async () => {
      let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200)
      if (table) query = query.eq('table_name', table)
      const { data, error } = await query
      if (error) throw error
      return data as AuditRow[]
    },
  })
  return (
    <>
      <PageHeader title="السجل" subtitle="آخر 200 تغيير" />
      <div className="mb-3 w-56">
        <Select value={table} onChange={(e) => setTable(e.target.value)} placeholder="كل الجداول" options={Object.entries(TABLES).map(([value, label]) => ({ value, label }))} />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="السجل فاضي" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {q.data.map((r) => (
            <div key={r.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={ACTIONS[r.action].tone}>{ACTIONS[r.action].label}</Badge>
                <span className="font-semibold">{TABLES[r.table_name] ?? r.table_name}</span>
                <span className="text-xs text-muted">
                  {new Date(r.at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })} · {r.actor_email ?? 'النظام'}
                </span>
              </div>
              <p className="mt-1 break-words text-xs text-muted">{changes(r)}</p>
            </div>
          ))}
        </Card>
      )}
    </>
  )
}
