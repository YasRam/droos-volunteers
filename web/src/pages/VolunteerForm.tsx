import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Printer } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Empty, Spinner } from '@/components/ui'
import { usePermissions } from '@/lib/auth'
import { ageFrom, fmtDate } from '@/lib/data'
import { toastError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Form = Record<string, unknown> & {
  id: string
  code: string
  full_name_ar: string
  photo_path: string | null
  leads: string[]
}

const d = (x: unknown) => (x ? fmtDate(String(x)) : '')

/** استمارة التطوع: every detail, a photo box and signature lines, laid out for one A4 page. */
export default function VolunteerForm() {
  const params = useParams()
  const p = usePermissions()
  const id = params.id ?? p.volunteerId
  const qc = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const q = useQuery({
    queryKey: ['volunteer-form', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('volunteer_form', { p_volunteer: id })
      if (error) throw error
      const f = data as Form | null
      let photo: string | null = null
      if (f?.photo_path) {
        const { data: signed } = await supabase.storage.from('photos').createSignedUrl(f.photo_path, 3600)
        photo = signed?.signedUrl ?? null
      }
      return f ? { f, photo } : null
    },
  })
  const upload = useMutation({
    mutationFn: async (picked: File) => {
      if (picked.size > 3 * 1024 * 1024) throw { message: 'الصورة أكبر من 3 ميجا' }
      const ext = picked.type === 'image/png' ? 'png' : picked.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${id}/photo.${ext}`
      const { error } = await supabase.storage.from('photos').upload(path, picked, { upsert: true, contentType: picked.type })
      if (error) throw error
      const { error: e2 } = await supabase.rpc('set_photo', { p_volunteer: id, p_path: path })
      if (e2) throw e2
    },
    onSuccess: () => {
      toast.success('الصورة اتحفظت')
      qc.invalidateQueries({ queryKey: ['volunteer-form', id] })
    },
    onError: toastError,
  })

  if (q.isLoading) return <Spinner />
  if (!q.data) return <Empty title="مش متاح">الاستمارة بتظهر لصاحبها وللـ HR بس.</Empty>
  const { f, photo } = q.data
  const age = ageFrom(f.birth_date as string | null)

  return (
    <div className="mx-auto max-w-[210mm]">
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="size-4" /> اطبع
        </Button>
        <Button variant="secondary" loading={upload.isPending} onClick={() => file.current?.click()}>
          <Camera className="size-4" /> {photo ? 'غيّر الصورة' : 'ضيف صورة'}
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            if (picked) upload.mutate(picked)
            e.target.value = ''
          }}
        />
        <p className="w-full text-xs text-muted">الطباعة بتطلع صفحة A4 من غير القايمة. لو مفيش صورة بيطلع مكان فاضي تلزق فيه صورة.</p>
      </div>

      <article className="rounded-2xl bg-white p-6 text-[13px] leading-6 ring-1 ring-line print:rounded-none print:p-0 print:ring-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-brand-700 pb-3">
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-16 shrink-0 object-contain" />
          <div className="flex-1">
            <p className="text-xs text-muted">نشاط دروس التقوية · فرع إسكندرية</p>
            <h1 className="text-xl font-bold">استمارة تطوع</h1>
            <p className="mt-1 text-xs text-muted">
              كود المتطوع: <b className="ltr">{f.code}</b> · اتطبعت {fmtDate(new Date().toISOString())}
            </p>
          </div>
          <div className="grid h-[40mm] w-[30mm] shrink-0 place-items-center overflow-hidden rounded border border-dashed border-gray-400 text-center text-[11px] text-gray-400">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : 'مكان الصورة'}
          </div>
        </header>

        <Section title="البيانات الشخصية">
          <Row label="الاسم بالعربي" value={f.full_name_ar} wide />
          <Row label="الاسم بالإنجليزي" value={f.full_name_en} wide />
          <Row label="الرقم القومي" value={f.national_id} ltr />
          <Row label="تاريخ الميلاد" value={[d(f.birth_date), age ? `${age} سنة` : ''].filter(Boolean).join(' · ')} />
          <Row label="النوع" value={f.gender} />
          <Row label="الموبايل" value={f.phone} ltr />
          <Row label="الواتساب" value={f.whatsapp} ltr />
          <Row label="الإيميل" value={f.email} ltr wide />
          <Row label="المنطقة" value={f.area} />
          <Row label="المؤهل" value={f.qualification} />
          <Row label="الكلية والسنة" value={f.study_year} />
          <Row label="الشغل" value={f.job} />
          <Row label="فيسبوك" value={f.facebook} ltr wide />
          <Row label="المواعيد المناسبة" value={f.availability_notes} wide />
          <Row label="عرف النشاط منين" value={f.referral_source} wide />
        </Section>

        <Section title="بيانات النشاط">
          <Row label="تاريخ التسجيل" value={d(f.registered_at)} />
          <Row label="الحالة" value={f.status} />
          <Row label="الوظيفة" value={[f.position, ...(f.leads ?? [])].filter(Boolean).join(' · ')} />
          <Row label="اللجنة" value={[f.main_committee, f.sub_committee].filter(Boolean).join(' / ')} />
          <Row label="الموافقة على القواعد" value={d(f.rules_agreed)} />
        </Section>

        <section className="mt-5 break-inside-avoid">
          <p className="text-[12px]">
            أقر أنا الموقع أدناه إن البيانات دي صحيحة، وإني قريت قواعد نشاط دروس التقوية وموافق عليها، وهلتزم بيها طول فترة تطوعي.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-10 text-[12px]">
            <Sign label="إمضاء المتطوع" />
          </div>
        </section>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid">
      <h2 className="mb-1 rounded bg-brand-50 px-2 py-0.5 text-sm font-bold text-brand-800 print:bg-gray-100">{title}</h2>
      <dl className="grid grid-cols-2 gap-x-6">{children}</dl>
    </section>
  )
}

function Row({ label, value, wide, ltr }: { label: string; value: unknown; wide?: boolean; ltr?: boolean }) {
  const text = value == null || value === '' ? '' : String(value)
  return (
    <div className={`flex gap-2 border-b border-dotted border-gray-300 py-1 ${wide ? 'col-span-2' : ''}`}>
      <dt className="w-28 shrink-0 text-muted">{label}</dt>
      <dd className={`min-h-5 flex-1 font-semibold ${ltr ? 'ltr text-start' : ''}`}>{text}</dd>
    </div>
  )
}

function Sign({ label }: { label: string }) {
  return (
    <div>
      <div className="h-12 border-b border-gray-500" />
      <p className="mt-1 flex justify-between text-muted">
        <span>{label}</span>
        <span>التاريخ: &nbsp; / &nbsp; / 20</span>
      </p>
    </div>
  )
}
