import { StudySession, AppSubject } from '../lib/supabase';
import { TrendingUp } from 'lucide-react';

interface SummaryPanelProps {
  sessions: StudySession[];
  subjects: AppSubject[];
}

export function SummaryPanel({ sessions, subjects }: SummaryPanelProps) {
  const calculateSubjectTotals = () => {
    const totals: Record<string, number> = {};

    subjects.forEach((subject) => {
      totals[subject.name] = 0;
    });

    sessions.forEach((session) => {
      if (totals.hasOwnProperty(session.subject)) {
        totals[session.subject] += session.hours;
      }
    });

    return totals;
  };

  const totals = calculateSubjectTotals();
  const grandTotal = Object.values(totals).reduce((sum, val) => sum + val, 0);

  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-xl p-8 mb-8">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp className="text-white" size={28} />
        <h2 className="text-3xl font-bold text-white">All-Time Subject Summary</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {subjects.map((subject) => (
          <div
            key={subject.id}
            className="bg-white bg-opacity-95 rounded-lg p-4 border-l-4 border-blue-400 hover:shadow-lg transition-shadow"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
              {subject.name}
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {(totals[subject.name] || 0).toFixed(1)}<span className="text-sm text-gray-500 ml-1">hrs</span>
            </div>
          </div>
        ))}

        <div className="bg-white bg-opacity-95 rounded-lg p-4 border-l-4 border-green-400 hover:shadow-lg transition-shadow">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
            Grand Total
          </div>
          <div className="text-2xl font-bold text-green-600">
            {grandTotal.toFixed(1)}<span className="text-sm text-gray-500 ml-1">hrs</span>
          </div>
        </div>
      </div>
    </div>
  );
}
