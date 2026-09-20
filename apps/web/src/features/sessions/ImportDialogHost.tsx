import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import { ForeignImportDialog } from './ForeignImportDialog';

/**
 * Single mount point for the foreign-session import dialog: the sidebar button
 * and `/resume @codex|@claude` both open it through the store, so the dialog
 * never renders twice.
 */
export function ImportDialogHost() {
  const navigate = useNavigate();
  const importSource = useSessionStore((s) => s.importSource);
  const closeImport = useSessionStore((s) => s.closeImport);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  return (
    <ForeignImportDialog
      open={importSource !== null}
      initialSource={importSource ?? 'codex'}
      onClose={closeImport}
      onImported={(id) => {
        setActiveSessionId(id);
        void navigate(`/s/${id}`);
      }}
    />
  );
}
