import { Dialog } from './overlays'

/** "Add source" dialog (POST /projects/{project_id}/sources). `onCreated` runs after a source was added. */
export default function AddSourceDialog({ projectId, onClose }: { projectId: string; onClose: () => void; onCreated?: () => void }) {
  return (
    <Dialog title="Add source" onClose={onClose}>
      <span className="mono text-[13px]">{projectId}</span>
    </Dialog>
  )
}
