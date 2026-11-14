import { Dialog } from './overlays'

/** Command palette (⌘K): search facts and jump to screens (GET /search). */
export default function Palette({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Search" onClose={onClose}>
      <span />
    </Dialog>
  )
}
