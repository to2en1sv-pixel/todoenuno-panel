import { Card } from '@/components/ui/Card';
export function ComingSoon({ module }: { module: string }) {
  return (
    <Card>
      <div className="text-center py-12">
        <div className="text-4xl">🚧</div>
        <div className="font-bold text-lg mt-3">{module}</div>
        <div className="tx-mu text-sm mt-2">
          Se activará junto con <b>UniChat</b> cuando el bot de WhatsApp esté en producción.
        </div>
      </div>
    </Card>
  );
}
