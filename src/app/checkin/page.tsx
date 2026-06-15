'use client'
import CheckinWizard from '@/components/checkin/CheckinWizard'
import QueueView from '@/components/checkin/QueueView'

export default function CheckinPage() {
  return (
    <div className="h-screen flex bg-rc-navy overflow-hidden">
      {/* Left: live queue */}
      <div className="flex-1 flex flex-col border-r border-white/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-rc-green text-lg font-bold uppercase tracking-widest">Queue</h2>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <QueueView />
        </div>
      </div>

      {/* Right: add a Par-Tee */}
      <div className="w-[420px] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-rc-green text-lg font-bold uppercase tracking-widest">Add Par-Tee</h2>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <CheckinWizard onSuccess={() => {}} />
        </div>
      </div>
    </div>
  )
}
