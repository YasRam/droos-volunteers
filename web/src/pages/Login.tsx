import { useState } from 'react'
import { Button, Input } from '@/components/ui'
import { LangSwitch } from '@/components/LangSwitch'
import { useAuth } from '@/lib/auth'
import { toastError } from '@/lib/errors'

export default function Login() {
  const { signIn, signInWithPassword } = useAuth()
  const [loading, setLoading] = useState(false)
  const [withPw, setWithPw] = useState(true)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-b from-brand-50 to-surface px-6">
      <div className="w-full max-w-sm text-center">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mx-auto size-20" />
        <h1 className="mt-4 text-2xl font-bold">نشاط دروس التقوية</h1>
        <p className="mt-1 text-muted">فرع إسكندرية</p>
        <Button
          size="lg"
          className="mt-8 w-full"
          loading={loading}
          onClick={async () => {
            setLoading(true)
            try {
              await signIn()
            } catch (e) {
              toastError(e)
              setLoading(false)
            }
          }}
        >
          <GoogleIcon /> الدخول بحساب جوجل
        </Button>
        <p className="mt-4 text-xs text-muted">ادخل بنفس الإيميل اللي مسجّل بيه في النشاط</p>
        {withPw ? (
          <form
            className="mt-6 space-y-2 text-start"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await signInWithPassword(email, pw)
              } catch (err) {
                toastError(err)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Input type="email" autoComplete="username" placeholder="الإيميل" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" required />
            <Input type="password" autoComplete="current-password" placeholder="كلمة السر" value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" required />
            <Button type="submit" variant="secondary" className="w-full" loading={busy}>
              دخول
            </Button>
            <p className="text-xs text-muted">
              مفيش كلمة سر؟ ادخل بجوجل مرة واحدة وحطها من «كلمة السر» في القايمة.
            </p>
          </form>
        ) : (
          <button className="mt-6 text-sm font-semibold text-brand-700" onClick={() => setWithPw(true)}>
            الدخول بالإيميل وكلمة السر
          </button>
        )}
        <LangSwitch className="mx-auto mt-6" />
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#fff" d="M21.35 11.1H12v2.98h5.35c-.23 1.5-1.66 4.4-5.35 4.4a5.98 5.98 0 0 1 0-11.96c1.84 0 3.07.78 3.78 1.46l2.58-2.49C16.82 3.97 14.6 3 12 3a9 9 0 1 0 0 18c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.14-1.5z" />
    </svg>
  )
}
