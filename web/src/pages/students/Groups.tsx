import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { GROUP_KINDS, sdb, useCurrentTerm, useGrades, useGroups, useStudents, type Group } from '@/lib/students'

interface WaGroup { id: string; name: string; link: string; target: string; grade: string | null; group_id: string | null }

function useWhatsapp() {
  return useQuery({
    queryKey: ['students', 'whatsapp-groups'],
    queryFn: async () => {
      const { data, error } = await sdb().from('whatsapp_groups').select('*')
      if (error) throw error
      return data as WaGroup[]
    },
  })
}

/** The WhatsApp link of a grade or a group: shown to its students, their guardians and teachers. */
function WhatsappLink({ grade, groupId, label, list }: { grade?: string; groupId?: string; label: string; list: WaGroup[] }) {
  const a = useStudentAccess()
  const qc = useQueryClient()
  const cur = list.find((w) => (grade ? w.target === 'grade' && w.grade === grade : w.target === 'group' && w.group_id === groupId))
  const [editing, setEditing] = useState(false)
  const [link, setLink] = useState(cur?.link ?? '')
  const save = useMutation({
    mutationFn: async () => {
      const v = link.trim()
      if (v && !/^https:\/\/(chat\.whatsapp\.com|wa\.me)\//.test(v)) throw { message: 'اللينك لازم يبدأ بـ https://chat.whatsapp.com/' }
      if (cur) {
        const { error } = v ? await sdb().from('whatsapp_groups').update({ link: v }).eq('id', cur.id) : await sdb().from('whatsapp_groups').delete().eq('id', cur.id)
        if (error) throw error
      } else if (v) {
        const { error } = await sdb().from('whatsapp_groups').insert({ name: label, link: v, target: grade ? 'grade' : 'group', grade: grade ?? null, group_id: groupId ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('اتحفظ')
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['students', 'whatsapp-groups'] })
    },
    onError: toastError,
  })
  if (editing)
    return (
      <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Input dir="ltr" className="h-8 flex-1" placeholder="https://chat.whatsapp.com/..." value={link} onChange={(e) => setLink(e.target.value)} />
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button>
      </div>
    )
  return (
    <div className="mt-2 flex items-center gap-2 text-sm" onClick={(e) => e.stopPropagation()}>
      {cur ? (
        <a href={cur.link} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700">جروب الواتساب</a>
      ) : (
        <span className="text-muted">مفيش جروب واتساب</span>
      )}
      {a.edit && (
        <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => setEditing(true)}>
          {cur ? 'تغيير' : 'ضيف لينك'}
        </button>
      )}
    </div>
  )
}
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
  const [adding, setAdding] = useState<string | null | false>(false)
  const count = (id: string) => (members.data ?? []).filter((m) => m.group_id === id).length
  const grades = useGrades()
  const students = useStudents()
  const wa = useWhatsapp()
  const perGrade = (g: string) => (students.data ?? []).filter((s) => s.enrollment?.grade === g).length
  const card = (g: Group) => (
    <button key={g.id} onClick={() => setOpen(g)} className="text-start">
      <Card className="h-full hover:ring-brand-200">
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold">{g.name}</p>
          <Badge tone="brand">{g.kind}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">{count(g.id)} طالب{g.notes ? ` · ${g.notes}` : ''}</p>
        <WhatsappLink groupId={g.id} label={g.name} list={wa.data ?? []} />
      </Card>
    </button>
  )
  const general = (groups.data ?? []).filter((g) => !g.grade)

  return (
    <>
      <PageHeader
        title="المجموعات"
        subtitle="التأسيس والولاد والبنات والورش. المجموعة ممكن تجمع طلاب من كذا سنة، والطالب ممكن يبقى في أكتر من مجموعة."
        actions={a.edit && term.data && <Button onClick={() => setAdding(null)}><Plus className="size-4" /> مجموعة جديدة</Button>}
      />
      {!term.data ? <Empty title="مفيش ترم حالي" /> : groups.isLoading || grades.isLoading ? <Spinner /> : (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-bold">السنين الدراسية</h2>
            <p className="text-sm text-muted">كل سنة ليها جروب واتساب، وممكن تتقسم مجموعات (كل مجموعة ليها جروبها).</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {(grades.data ?? []).map((gr) => {
                const subs = (groups.data ?? []).filter((g) => g.grade === gr)
                return (
                  <Card key={gr} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-lg font-bold">{gr}</p>
                      <span className="text-sm text-muted">{perGrade(gr)} طالب</span>
                    </div>
                    <WhatsappLink grade={gr} label={gr} list={wa.data ?? []} />
                    {subs.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{subs.map(card)}</div>}
                    {a.edit && (
                      <Button size="sm" variant="ghost" onClick={() => setAdding(gr)}>
                        <Plus className="size-4" /> قسّم السنة دي لمجموعة
                      </Button>
                    )}
                  </Card>
                )
              })}
            </div>
          </section>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">مجموعات عامة</h2>
              {a.edit && <Button size="sm" onClick={() => setAdding(null)}><Plus className="size-4" /> مجموعة عامة</Button>}
            </div>
            <p className="text-sm text-muted">التأسيس والورش ومجموعات الولاد والبنات: بتجمع طلاب من كذا سنة.</p>
            {!general.length ? <Empty title="مفيش مجموعات عامة" /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{general.map(card)}</div>}
          </section>
        </div>
      )}
      {adding !== false && term.data && <NewGroup termId={term.data.id} grade={adding} onClose={() => setAdding(false)} />}
      {open && <GroupMembers g={open} memberIds={(members.data ?? []).filter((m) => m.group_id === open.id).map((m) => m.student_id)} onClose={() => setOpen(null)} />}
    </>
  )
}

function NewGroup({ termId, grade, onClose }: { termId: string; grade: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(grade ? `${grade} - مجموعة ` : '')
  const [kind, setKind] = useState(GROUP_KINDS[0])
  const [notes, setNotes] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw { message: 'اكتب اسم المجموعة' }
      const { error } = await sdb().from('groups').insert({ term_id: termId, name: name.trim(), kind, notes: notes.trim() || null, grade })
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
    <Modal open onClose={onClose} title={grade ? `مجموعة من ${grade}` : 'مجموعة عامة جديدة'}>
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
