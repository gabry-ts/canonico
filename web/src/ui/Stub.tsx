import { useI18n } from '../i18n'
import { Empty } from './overlays'

/** Placeholder for a screen that is not ported yet. */
export default function Stub({ route }: { route: string }) {
  const { t } = useI18n()
  return (
    <div className="h-full overflow-y-auto scroll">
      <div className="max-w-[1080px] mx-auto px-6 py-8">
        <h1 className="page-title">{t('nav.' + route)}</h1>
        <div className="card mt-6">
          <Empty title={t('common.notBuilt')} />
        </div>
      </div>
    </div>
  )
}
