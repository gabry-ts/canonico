import { Drawer } from './overlays'

/** Fact detail drawer, opened from anywhere with useApp().openFact(id). */
export default function FactDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Drawer onClose={onClose} label={id}>
      <div className="p-5 mono text-[13px]">{id}</div>
    </Drawer>
  )
}
