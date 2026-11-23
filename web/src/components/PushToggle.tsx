import { BellOff, BellRing, Share, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button, Card } from './ui'
import { toastError } from '@/lib/errors'
import { usePushActions, usePushState } from '@/lib/push'

const DISMISS_KEY = 'push-card-dismissed'

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/** Card on the home page inviting the person to turn on phone notifications. */
export function PushCard() {
  const state = usePushState()
  const { enable } = usePushActions()
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(readDismissed)

  if (dismissed || !state.data || state.data === 'on' || state.data === 'unsupported') return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* private mode: just hide it for now */
    }
    setDismissed(true)
  }
  const turnOn = async () => {
    setBusy(true)
    try {
      await enable()
      toast.success('الإشعارات اتفعّلت على الجهاز ده')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="relative border-amber-200 bg-amber-50">
      <button onClick={dismiss} className="absolute end-2 top-2 rounded-lg p-1 text-muted hover:bg-amber-100" aria-label="إخفاء">
        <X className="size-4" />
      </button>
      <p className="flex items-center gap-2 pe-6 font-bold text-amber-900">
        <BellRing className="size-5" /> خلّي الإشعارات توصلك على الموبايل
      </p>
      {state.data === 'needs-install' ? (
        <p className="mt-1 text-sm text-amber-900">
          على الآيفون لازم تثبّت الموقع الأول: من Safari دوس على <Share className="inline size-4" /> وبعدين «إضافة إلى الشاشة الرئيسية»، وافتحه من الأيقونة وفعّل الإشعارات من هنا.
        </p>
      ) : state.data === 'blocked' ? (
        <p className="mt-1 text-sm text-amber-900">الإشعارات مقفولة للموقع ده. افتح إعدادات المتصفح ← إعدادات الموقع ← الإشعارات، واسمح بيها.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-amber-900">طلبات الحضور، والموافقات، وأي حاجة تخصك، هتوصلك حتى والموقع مقفول.</p>
          <Button className="mt-3" onClick={turnOn} loading={busy}>
            <BellRing className="size-4" /> فعّل الإشعارات
          </Button>
        </>
      )}
    </Card>
  )
}

/** Small on/off line for the notifications panel. */
export function PushSwitch() {
  const state = usePushState()
  const { enable, disable } = usePushActions()
  const [busy, setBusy] = useState(false)
  if (!state.data || state.data === 'unsupported') return null
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs">
      <span className="text-muted">
        {state.data === 'on' ? 'الإشعارات شغالة على الجهاز ده' : state.data === 'needs-install' ? 'ثبّت الموقع على الشاشة الرئيسية عشان الإشعارات' : state.data === 'blocked' ? 'الإشعارات مقفولة من المتصفح' : 'الإشعارات مش شغالة على الجهاز ده'}
      </span>
      {state.data === 'on' ? (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => run(disable, 'الإشعارات اتقفلت على الجهاز ده')}>
          <BellOff className="size-4" /> اقفل
        </Button>
      ) : state.data === 'off' ? (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => run(enable, 'الإشعارات اتفعّلت')}>
          <BellRing className="size-4" /> فعّل
        </Button>
      ) : null}
    </div>
  )
}
