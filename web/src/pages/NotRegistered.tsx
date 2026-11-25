import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'

export default function NotRegistered() {
  const { me, signOut } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mx-auto size-16" />
        <h1 className="mt-4 text-xl font-bold">الإيميل ده مش متسجل في النشاط</h1>
        <p className="mt-2 text-sm text-muted">
          دخلت بـ <span className="ltr font-semibold">{me?.email}</span>. اطلب من الـ HR يضيف الإيميل ده في بياناتك، أو ادخل بإيميل تاني.
        </p>
        <Button variant="secondary" className="mt-6" onClick={signOut}>
          الدخول بإيميل تاني
        </Button>
      </div>
    </div>
  )
}

export function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mx-auto size-16" />
        <h1 className="mt-4 text-xl font-bold">مش قادرين نوصل للسيرفر</h1>
        <p className="mt-2 text-sm text-muted">اتأكد إن النت شغال وجرب تاني.</p>
        <Button className="mt-6" onClick={onRetry}>
          جرب تاني
        </Button>
      </div>
    </div>
  )
}

export function Inactive() {
  const { signOut } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mx-auto size-16" />
        <h1 className="mt-4 text-xl font-bold">الحساب ده مش فعال</h1>
        <p className="mt-2 text-sm text-muted">حسابك اتقفل لأنك خرجت من النشاط. لو عايز ترجع أو ده غلط، كلّم الـ HR.</p>
        <Button className="mt-6" variant="secondary" onClick={signOut}>
          خروج
        </Button>
      </div>
    </div>
  )
}
