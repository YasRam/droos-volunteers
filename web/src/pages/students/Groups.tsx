import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { GROUP_KINDS, sdb, useCurrentTerm, useGroups, useStudents, type Group } from '@/lib/students'
import { useStudentAccess } from './Students'

export default function Groups() {
  const a = useStudentAccess()
  const term = useCurrentTerm()
  const groups = useGroups(term.data?.id)
  const members = useQuery({
    queryKey: ['students', 'group-members', term.data?.id],
    enabled: Boolean(term.data),
    queryFn: async () => {
      const { data, error } = await sdb().from('group_members').select('group_id, student_id')
      if (error) throw error
      return data as { group_id: string; student_id: string }[]
    },
  })
  const [open, setOpen] = useState<Group | null>(null)
  const [adding, setAdding] = useState(false)
  const count = (id: string) => (members.data ?? []).filter((m) => m.group_id === id).length

  return (
    <>
      <PageHeader
        title="المجموعات"
        subtitle="التأسيس والولاد والبنات والورش. المجموعة ممكن تجمع طلاب من كذا سنة، والطالب ممكن يبقى في أكتر من مجموعة."
        actions={a.edit && term.data && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> مجموعة جديدة</Button>}
      />
      {!term.data ? <Empty title="مفيش ترم حالي" /> : groups.isLoading ? <Spinner /> : !groups.data?.length ? (
        <Empty title="مفيش مجموعات لسه" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.data.map((g) => (
            <button key={g.id} onClick={() => setOpen(g)} className="text-start">
              <Card className="h-full hover:ring-brand-200">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{g.name}</p>
                  <Badge tone="brand">{g.kind}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted">{count(g.id)} طالب{g.notes ? ` · ${g.notes}` : ''}</p>
              </Card>
            </button>
          ))}
        </div>
      )}
      {adding && term.data && <NewGroup termId={term.data.id} onClose={() => setAdding(false)} />}
      {open && <GroupMembers g={open} memberIds={(members.data ?? []).filter((m) => m.group_id === open.id).map((m) => m.student_id)} onClose={() => setOpen(null)} />}
    </>
  )
}

function NewGroup({ termId, onClose }: { termId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState(GROUP_KINDS[0])
  const [notes, setNotes] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw { message: 'اكتب اسم المجموعة' }
      const { error } = await sdb().from('groups').insert({ term_id: termId, name: name.trim(), kind, notes: notes.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('المجموعة اتعملت')
      qc.invalidateQueries({ queryKey: ['students', 'groups'] })
      onClose()
    },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title="مجموعة جديدة">
      <div className="space-y-3">
        <Field label="الاسم" hint="زي «تأسيس عربي» أو «ورشة رسم 4–6 ب»"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="النوع"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={GROUP_KINDS} /></Field>
        <Field label="ملاحظات"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ</Button>
      </div>
    </Modal>
  )
}

function GroupMembers({ g, memberIds, onClose }: { g: Group; memberIds: string[]; onClose: () => void }) {
  const a = useStudentAccess()
  const qc = useQueryClient()
  const students = useStudents()
  const [search, setSearch] = useState('')
  const inGroup = useMemo(() => new Set(memberIds), [memberIds])
  const members = (students.data ?? []).filter((s) => inGroup.has(s.id))
  const found = search.trim()
    ? (students.data ?? []).filter((s) => !inGroup.has(s.id) && s.enrollment && (s.full_name.includes(search.trim()) || s.enrollment.grade === search.trim())).slice(0, 8)
    : []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['students'] })
  const add = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await sdb().from('group_members').insert(ids.map((id) => ({ group_id: g.id, student_id: id })))
      if (error) throw error
    },
    onSuccess: () => { setSearch(''); invalidate() },
    onError: toastError,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sdb().from('group_members').delete().eq('group_id', g.id).eq('student_id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
    onError: toastError,
  })
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await sdb().from('groups').delete().eq('id', g.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('المجموعة اتمسحت'); invalidate(); onClose() },
    onError: toastError,
  })
  return (
    <Modal open onClose={onClose} title={`${g.name} · ${members.length} طالب`}>
      <div className="space-y-3">
        {a.edit && (
          <div className="relative">
            <Search className="absolute start-3 top-2.5 size-5 text-muted" />
            <Input className="ps-10" placeholder="ضيف طالب بالاسم، أو اكتب السنة (4 ب) تشوف طلابها" value={search} onChange={(e) => setSearch(e.target.value)} />
            {found.length > 0 && (
              <div className="mt-1 divide-y divide-line rounded-xl ring-1 ring-line">
                {found.map((s) => (
                  <button key={s.id} className="flex w-full justify-between px-3 py-2 text-start text-sm hover:bg-surface" onClick={() => add.mutate([s.id])}>
                    <span>{s.full_name}</span><span className="text-muted">{s.enrollment?.grade}</span>
                  </button>
                ))}
                {found.length > 1 && (
                  <button className="w-full px-3 py-2 text-start text-sm font-semibold text-brand-700 hover:bg-surface" onClick={() => add.mutate(found.map((s) => s.id))}>
                    ضيف الـ {found.length} كلهم
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {students.isLoading ? <Spinner /> : !members.length ? <p className="text-sm text-muted">مفيش طلاب في المجموعة دي.</p> : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {members.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>{s.full_name} <span className="text-muted">· {s.enrollment?.grade ?? '—'}</span></span>
                {a.edit && (
                  <button onClick={() => remove.mutate(s.id)} className="text-red-600" aria-label="شيل"><X className="size-4" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        {a.edit && (
          <Button variant="ghost" className="text-red-600" onClick={() => window.confirm('تمسح المجموعة؟ الطلاب مش هيتمسحوا.') && del.mutate()}>
            <Trash2 className="size-4" /> امسح المجموعة
          </Button>
        )}
      </div>
    </Modal>
  )
}
