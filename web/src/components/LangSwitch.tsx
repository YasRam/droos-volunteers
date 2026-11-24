import { Languages } from 'lucide-react'
import { cn } from '@/components/ui'
import { isEn, setLang } from '@/lib/i18n'

/** «English» in Arabic mode, «عربي» in English mode. Reloads the page in the other language. */
export function LangSwitch({ className, stacked }: { className?: string; stacked?: boolean }) {
  return (
    <button
      data-no-translate
      onClick={() => setLang(isEn ? 'ar' : 'en')}
      className={cn('flex items-center gap-1 text-sm text-brand-700', stacked && 'flex-col rounded-xl p-3 text-xs font-semibold hover:bg-surface', className)}
      lang={isEn ? 'ar' : 'en'}
    >
      <Languages className={stacked ? 'size-5' : 'size-4'} />
      {isEn ? 'عربي' : 'English'}
    </button>
  )
}
