import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Field, Input, Modal } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { toastError } from '@/lib/errors'

/** Lets a signed-in person set a password so they can sign in later without Google. */
export function PasswordButton({ stacked, email }: { stacked?: boolean; email?: string | null }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const short = pw.length > 0 && pw.length < 8
  const mismatch = again.length > 0 && again !== pw
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={stacked ? 'flex flex-col items-center gap-1 rounded-xl p-3 text-xs font-semibold hover:bg-surface' : 'flex items-center gap-1 text-sm text-muted hover:text-ink'}
      >
        <KeyRound className={stacked ? 'size-5 text-brand-700' : 'size-4'} /> كلمة السر
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="كلمة سر للدخول">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (pw.length < 8 || pw !== again) return
            setBusy(true)
            try {
              const { error } = await supabase.auth.updateUser({ password: pw })
              if (error) throw error
              toast.success('اتحفظت. تقدر تدخل بالإيميل وكلمة السر من أي جهاز')
              setPw('')
              setAgain('')
              setOpen(false)
            } catch (err) {
              toastError(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          <p className="text-sm text-muted">
            بعد ما تحطها تقدر تدخل من أي جهاز بالإيميل <span className="ltr font-semibold">{email}</span> وكلمة السر من غير حساب جوجل.
          </p>
          <Field label="كلمة السر الجديدة" error={short ? '8 حروف أو أرقام على الأقل' : undefined}>
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" />
          </Field>
          <Field label="اكتبها تاني" error={mismatch ? 'مش زي الأولى' : undefined}>
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} dir="ltr" />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={pw.length < 8 || pw !== again}>
            حفظ
          </Button>
        </form>
      </Modal>
    </>
  )
}
