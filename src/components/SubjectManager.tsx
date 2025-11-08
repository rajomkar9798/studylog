import { useState } from 'react';
import { AppSubject } from '../lib/supabase';
import { Plus, X } from 'lucide-react';

interface SubjectManagerProps {
  subjects: AppSubject[];
  onAddSubject: (name: string) => void;
  onDeleteSubject: (id: string) => void;
}

export function SubjectManager({
  subjects,
  onAddSubject,
  onDeleteSubject,
}: SubjectManagerProps) {
  const [newSubject, setNewSubject] = useState('');
  const [showForm, setShowForm] = useState(false);

  const handleAdd = async () => {
    if (!newSubject.trim()) {
      alert('Please enter a subject name');
      return;
    }

    await onAddSubject(newSubject.trim());
    setNewSubject('');
    setShowForm(false);
  };

  return (
    <div className="border-t border-gray-200 pt-6">
      <h3 className="text-lg font-bold text-gray-900 mb-4">Manage Subjects</h3>

      <div className="flex flex-wrap gap-2 mb-4">
        {subjects.map((subject) => (
          <div
            key={subject.id}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-full"
          >
            <span className="text-sm font-medium text-gray-900">{subject.name}</span>
            <button
              onClick={() => onDeleteSubject(subject.id)}
              className="text-red-500 hover:text-red-700 transition-colors"
              title="Delete subject"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {showForm ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            placeholder="Enter new subject name..."
            onKeyPress={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            autoFocus
          />
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            Add
          </button>
          <button
            onClick={() => {
              setShowForm(false);
              setNewSubject('');
            }}
            className="px-4 py-2 bg-gray-300 text-gray-900 rounded-lg hover:bg-gray-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
        >
          <Plus size={18} />
          Add New Subject
        </button>
      )}
    </div>
  );
}
