import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Input, Modal, Tabs } from '@/components/ui'
import { accountCall } from '@/lib/account'
import { LangSwitch } from '@/components/LangSwitch'
import { useAuth } from '@/lib/auth'
import { toastError } from '@/lib/errors'

export default function Login() {
  const { signIn, signInWithPassword } = useAuth()
  const [who, setWho] = useState<'volunteer' | 'family'>(() => (localStorageGet('login-who') === 'family' ? 'family' : 'volunteer'))
  const [loading, setLoading] = useState(false)
  const [withPw, setWithPw] = useState(true)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-b from-brand-50 to-surface px-6">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-5">
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="h-20 w-auto object-contain" />
          <span className="h-12 w-px bg-line" />
          <img src={`${import.meta.env.BASE_URL}resala.png`} alt="جمعية رسالة" className="h-10 w-auto object-contain" />
        </div>
        <h1 className="mt-3 text-xl font-bold">نشاط دروس التقوية</h1>
        <p className="text-xs text-muted">جمعية رسالة للأعمال الخيرية · فرع إسكندرية</p>
        <div className="mt-5">
          <Tabs
            tabs={[
              { value: 'volunteer', label: 'متطوع' },
              { value: 'family', label: 'ولي أمر أو طالب' },
            ]}
            value={who}
            onChange={(v) => {
              setWho(v)
              localStorageSet('login-who', v)
            }}
          />
        </div>
        {who === 'family' ? (
          <FamilyLogin />
        ) : (
        <>
        <Button
          size="lg"
          className="mt-1 w-full"
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
        <p className="mt-2 text-xs text-muted">ادخل بنفس الإيميل اللي مسجّل بيه في النشاط</p>
        {withPw ? (
          <form
            className="mt-4 space-y-2 text-start"
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
            <FirstPassword onDone={(e, pw) => signInWithPassword(e, pw).catch(toastError)} />
          </form>
        ) : (
          <button className="mt-4 text-sm font-semibold text-brand-700" onClick={() => setWithPw(true)}>
            الدخول بالإيميل وكلمة السر
          </button>
        )}
        </>
        )}
        <LangSwitch className="mx-auto mt-4" />
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

/** No password yet (or forgot it): prove who you are with the national ID and mobile we have. */
function FirstPassword({ onDone }: { onDone: (email: string, password: string) => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ email: '', national_id: '', phone: '', password: '', again: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <>
      <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => setOpen(true)}>
        أول مرة تدخل أو نسيت كلمة السر؟
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="اعمل كلمة سر">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (f.password.length < 8 || f.password !== f.again) return
            setBusy(true)
            try {
              await accountCall({ action: 'first_password', email: f.email, national_id: f.national_id, phone: f.phone, password: f.password })
              toast.success('كلمة السر اتحفظت')
              setOpen(false)
              onDone(f.email, f.password)
            } catch (err) {
              toastError(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          <p className="text-sm text-muted">اكتب الإيميل والرقم القومي والموبايل زي ما هم متسجلين في النشاط، واختار كلمة سر.</p>
          <Input type="email" placeholder="الإيميل" value={f.email} onChange={set('email')} dir="ltr" required />
          <Input placeholder="الرقم القومي" inputMode="numeric" value={f.national_id} onChange={set('national_id')} dir="ltr" maxLength={14} required />
          <Input placeholder="الموبايل" inputMode="tel" value={f.phone} onChange={set('phone')} dir="ltr" required />
          <Input type="password" autoComplete="new-password" placeholder="كلمة السر (8 على الأقل)" value={f.password} onChange={set('password')} dir="ltr" required />
          <Input type="password" autoComplete="new-password" placeholder="اكتبها تاني" value={f.again} onChange={set('again')} dir="ltr" required />
          {f.again && f.again !== f.password && <p className="text-xs text-red-600">كلمة السر مش زي بعض</p>}
          <Button type="submit" className="w-full" loading={busy} disabled={f.password.length < 8 || f.password !== f.again}>
            احفظ وادخل
          </Button>
          <p className="text-xs text-muted">لو بياناتك مش متسجلة صح أو مالكش إيميل في النشاط، كلّم الـ HR يظبطوها أو يعملولك كلمة سر.</p>
        </form>
      </Modal>
    </>
  )
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private mode */
  }
}

type Kind = 'guardian' | 'student'
const LOGIN_LABEL: Record<Kind, string> = { guardian: 'موبايل ولي الأمر', student: 'الرقم القومي للطالب' }

/** Guardians sign in with their mobile, students with their national ID. */
function FamilyLogin() {
  const { signInFamily } = useAuth()
  const [kind, setKind] = useState<Kind>(() => (localStorageGet('login-kind') === 'student' ? 'student' : 'guardian'))
  const [login, setLogin] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = (k: Kind) => {
    setKind(k)
    localStorageSet('login-kind', k)
  }
  return (
    <form
      className="space-y-2 text-start"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await signInFamily(login, pw)
        } catch (err) {
          toastError(err)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        {(['guardian', 'student'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ring-1 ${kind === k ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'bg-white text-muted ring-line'}`}
          >
            {k === 'guardian' ? 'أنا ولي الأمر' : 'أنا الطالب'}
          </button>
        ))}
      </div>
      <Input inputMode="numeric" autoComplete="username" placeholder={LOGIN_LABEL[kind]} value={login} onChange={(e) => setLogin(e.target.value)} dir="ltr" required />
      <Input type="password" autoComplete="current-password" placeholder="كلمة السر" value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" required />
      <Button type="submit" className="w-full" loading={busy}>
        دخول
      </Button>
      <FamilyFirstPassword kind={kind} onDone={(l, p) => signInFamily(l, p).catch(toastError)} />
    </form>
  )
}

function FamilyFirstPassword({ kind, onDone }: { kind: Kind; onDone: (login: string, password: string) => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ login: '', other: '', password: '', again: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }))
  const guardian = kind === 'guardian'
  return (
    <>
      <button type="button" className="block w-full text-center text-xs font-semibold text-brand-700" onClick={() => setOpen(true)}>
        أول مرة تدخل أو نسيت كلمة السر؟
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={guardian ? 'كلمة سر لولي الأمر' : 'كلمة سر للطالب'}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            if (f.password.length < 8 || f.password !== f.again) return
            setBusy(true)
            try {
              await accountCall({
                action: 'family_password',
                kind,
                login: f.login,
                ...(guardian ? { national_id: f.other } : { phone: f.other }),
                password: f.password,
              })
              toast.success('كلمة السر اتحفظت')
              setOpen(false)
              onDone(f.login, f.password)
            } catch (err) {
              toastError(err)
            } finally {
              setBusy(false)
            }
          }}
        >
          <p className="text-sm text-muted">
            {guardian
              ? 'اكتب موبايلك اللي مسجّل في النشاط، ورقم قومي من بتوعكم (بتاعك، أو بتاع الأب أو الأم، أو بتاع واحد من ولادك)، واختار كلمة سر.'
              : 'اكتب رقمك القومي (اللي في شهادة الميلاد) وموبايل من أرقام أهلك المسجلة في النشاط، واختار كلمة سر.'}
          </p>
          <Input inputMode="numeric" placeholder={LOGIN_LABEL[kind]} value={f.login} onChange={set('login')} dir="ltr" required />
          <Input inputMode="numeric" placeholder={guardian ? 'رقم قومي (14 رقم)' : 'موبايل ولي الأمر'} value={f.other} onChange={set('other')} dir="ltr" required />
          <Input type="password" autoComplete="new-password" placeholder="كلمة السر (8 على الأقل)" value={f.password} onChange={set('password')} dir="ltr" required />
          <Input type="password" autoComplete="new-password" placeholder="اكتبها تاني" value={f.again} onChange={set('again')} dir="ltr" required />
          {f.again && f.again !== f.password && <p className="text-xs text-red-600">كلمة السر مش زي بعض</p>}
          <Button type="submit" className="w-full" loading={busy} disabled={f.password.length < 8 || f.password !== f.again}>
            احفظ وادخل
          </Button>
          <p className="text-xs text-muted">لو البيانات مش راضية، كلّم التنظيم في النشاط يعملولك كلمة سر.</p>
        </form>
      </Modal>
    </>
  )
}
