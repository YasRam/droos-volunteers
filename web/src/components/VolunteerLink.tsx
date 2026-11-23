import clsx from 'clsx'
import { MessageCircle, Phone, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Modal, StatusBadge } from './ui'
import { usePermissions } from '@/lib/auth'
import { useDirectory, whatsappLink } from '@/lib/data'

/** The phone opens the dialer (on a phone), the WhatsApp icon opens a WhatsApp chat. */
export function ContactLinks({ phone, whatsapp, showNumber = true, className }: { phone?: string | null; whatsapp?: string | null; showNumber?: boolean; className?: string }) {
  const wa = whatsappLink(whatsapp || phone)
  if (!phone && !wa) return null
  return (
    <span className={clsx('inline-flex items-center gap-1', className)} onClick={(e) => e.stopPropagation()}>
      {phone && (
        <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-lg p-1.5 text-brand-700 hover:bg-brand-50" aria-label={`اتصال ${phone}`} title="اتصال">
          <Phone className="size-4" />
          {showNumber && <span className="ltr text-xs font-semibold">{phone}</span>}
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label="واتساب" title="واتساب">
          <MessageCircle className="size-4" />
        </a>
      )}
    </span>
  )
}

/**
 * A volunteer's name anywhere in the app. Clicking it shows their card: name, code, status,
 * call and WhatsApp, and a link to the full file for those allowed to open it.
 */
export function VolunteerName({ id, name, className, children }: { id: string; name?: string | null; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={clsx('text-start hover:text-brand-700 hover:underline', className)}
      >
        {children ?? name ?? '—'}
      </button>
      {open && <VolunteerCard id={id} onClose={() => setOpen(false)} />}
    </>
  )
}

function VolunteerCard({ id, onClose }: { id: string; onClose: () => void }) {
  const p = usePermissions()
  const dir = useDirectory()
  const v = dir.data?.find((x) => x.id === id)
  const canOpenFile = p.full || p.leader
  return (
    <Modal open onClose={onClose} title={v?.full_name_ar ?? 'المتطوع'}>
      {!v ? (
        <p className="text-sm text-muted">{dir.isLoading ? 'بيحمّل...' : 'مش مسموح لك تشوف بيانات المتطوع ده'}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={v.status} />
            <span className="ltr text-muted">{v.code}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {v.phone && (
              <a href={`tel:${v.phone}`} className="flex-1">
                <Button variant="secondary" className="w-full">
                  <Phone className="size-4" /> <span className="ltr">{v.phone}</span>
                </Button>
              </a>
            )}
            {whatsappLink(v.whatsapp || v.phone) && (
              <a href={whatsappLink(v.whatsapp || v.phone)!} target="_blank" rel="noreferrer" className="flex-1">
                <Button variant="success" className="w-full">
                  <MessageCircle className="size-4" /> واتساب
                </Button>
              </a>
            )}
          </div>
          {canOpenFile && (
            <Link to={`/volunteers/${v.id}`} onClick={onClose}>
              <Button className="w-full">
                <UserRound className="size-4" /> الملف الكامل
              </Button>
            </Link>
          )}
        </div>
      )}
    </Modal>
  )
}
