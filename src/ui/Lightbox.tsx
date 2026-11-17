import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-auto max-w-[96vw]! border-0 bg-transparent p-0 shadow-none sm:max-w-[96vw]" showCloseButton={false}>
        <DialogTitle className="sr-only">Screenshot</DialogTitle>
        <img src={src} alt="Screenshot" className="max-h-[94vh] max-w-[94vw] rounded-lg" onClick={onClose} />
      </DialogContent>
    </Dialog>
  );
}
