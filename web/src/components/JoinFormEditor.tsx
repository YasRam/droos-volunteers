import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Field, Input, Modal, Spinner, Textarea } from '@/components/ui'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { DEFAULT_SETUP, OPTIONAL_FIELDS, type FieldMode, type JoinFormSetup } from '@/pages/Join'

const MODES: [FieldMode, string][] = [
  ['required', 'مطلوبة'],
  ['optional', 'اختياري'],
  ['hidden', 'مخفية'],
]

/** Edit the public join form: its texts, the WhatsApp group after sending, and which fields show. */
export function JoinFormEditor() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['join-form'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('join_form')
      if (error) throw error
      return (data ?? {}) as JoinFormSetup
    },
  })
  const [f, setF] = useState<JoinFormSetup>({})
  useEffect(() => {
    if (q.data) setF({ ...DEFAULT_SETUP, ...q.data, fields: { ...q.data.fields } })
  }, [q.data])
  const save = useMutation({
    mutationFn: async () => {
      if (f.whatsapp_link && !/^https:\/\/chat\.whatsapp\.com\//.test(f.whatsapp_link)) throw { message: 'لينك الجروب لازم يبدأ بـ https://chat.whatsapp.com/' }
      const { error } = await supabase.from('app_settings').upsert({ key: 'join_form', value: JSON.stringify(f) })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('الفورم اتحفظ')
      qc.invalidateQueries({ queryKey: ['join-form'] })
      setOpen(false)
    },
    onError: toastError,
  })
  const text = (k: keyof Omit<JoinFormSetup, 'fields'>) => ({
    value: (f[k] as string | undefined) ?? '',
    onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value })),
  })
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        تعديل الفورم والرسالة
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="فورم التسجيل">
        {q.isLoading ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            <Field label="العنوان">
              <Input {...text('title')} />
            </Field>
            <Field label="الكلام اللي تحت العنوان">
              <Textarea rows={2} {...text('intro')} />
            </Field>
            <Field label="عنوان رسالة بعد الإرسال">
              <Input {...text('success_title')} />
            </Field>
            <Field label="رسالة بعد الإرسال">
              <Textarea rows={3} {...text('success_message')} />
            </Field>
            <Field label="لينك جروب الواتساب" hint="بيظهر زرار «ادخل جروب الواتساب» في رسالة بعد الإرسال. سيبه فاضي لو مش عايزه">
              <Input {...text('whatsapp_link')} dir="ltr" placeholder="https://chat.whatsapp.com/..." />
            </Field>
            <div>
              <p className="mb-1 text-sm font-semibold">الخانات</p>
              <p className="mb-2 text-xs text-muted">الاسم والرقم القومي والموبايل مطلوبين دايماً.</p>
              <div className="divide-y divide-line rounded-xl ring-1 ring-line">
                {OPTIONAL_FIELDS.map(([k, label]) => (
                  <div key={k} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span>{label}</span>
                    <div className="flex gap-1">
                      {MODES.map(([m, l]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setF((x) => ({ ...x, fields: { ...x.fields, [k]: m } }))}
                          className={clsx(
                            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            (f.fields?.[k] ?? 'optional') === m ? 'bg-brand-700 text-white' : 'bg-surface text-muted',
                          )}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <Button className="w-full" loading={save.isPending} onClick={() => save.mutate()}>
              حفظ
            </Button>
          </div>
        )}
      </Modal>
    </>
  )
}
