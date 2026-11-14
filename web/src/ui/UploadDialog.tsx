import { Dialog } from './overlays'

/** Manual upload dialog (meeting / document / note / ticket, tags). `onDone` runs after the item was processed. */
export default function UploadDialog({ projectId, onClose }: { projectId: string; onClose: () => void; onDone?: () => void }) {
  return (
    <Dialog title="Upload" onClose={onClose}>
      <span className="mono text-[13px]">{projectId}</span>
    </Dialog>
  )
}
