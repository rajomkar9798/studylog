import { useState } from 'react';
import { AppSubject } from '../lib/supabase';
import { Plus } from 'lucide-react';

interface StudyCardProps {
  subjects: AppSubject[];
  onAddSession: (subject: string, hours: number, topic: string) => void;
  onDeleteSession: (id: string) => void;
  editMode?: boolean;
}

export function StudyCard({
  subjects,
  onAddSession,
  editMode = false,
}: StudyCardProps) {
  const [subject, setSubject] = useState('');
  const [hours, setHours] = useState('');
  const [topic, setTopic] = useState('');

  const handleAdd = async () => {
    if (!subject || !hours) {
      alert('Please select a subject and enter hours');
      return;
    }

    await onAddSession(subject, parseFloat(hours), topic);
    setSubject('');
    setHours('');
    setTopic('');
  };

  if (!editMode) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Subject</label>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
        >
          <option value="">Select a subject...</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Hours</label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g., 2.5"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., Arrays & Lists"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
          />
        </div>
      </div>

      <button
        onClick={handleAdd}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg hover:shadow-lg hover:from-green-700 hover:to-green-800 transition-all font-medium"
      >
        <Plus size={20} />
        Add Session
      </button>
    </div>
  );
}
