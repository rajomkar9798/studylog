import { useEffect, useState, useRef } from 'react';
import { supabase, StudySession, AppSubject } from '../lib/supabase';
import { StudyCard } from './StudyCard';
import { SummaryPanel } from './SummaryPanel';
import { SubjectManager } from './SubjectManager';
import { Download } from 'lucide-react';

export function StudyLog() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [subjects, setSubjects] = useState<AppSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const currentDayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sessionsResult, subjectsResult] = await Promise.all([
        supabase.from('study_sessions').select('*').order('entry_date', { ascending: false }),
        supabase.from('app_subjects').select('*').order('name', { ascending: true }),
      ]);

      if (sessionsResult.error) throw sessionsResult.error;
      if (subjectsResult.error) throw subjectsResult.error;

      const sessionData = sessionsResult.data || [];

      // After fetching, ensure skipped days exist in DB
      await ensureSkippedDays(sessionData);

      // Re-fetch after inserting skipped days
      const refreshedSessions = await supabase
        .from('study_sessions')
        .select('*')
        .order('entry_date', { ascending: false });

      if (refreshedSessions.data) setSessions(refreshedSessions.data);
      setSubjects(subjectsResult.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 🔹 Automatically fill missing dates into DB
  const ensureSkippedDays = async (existing: StudySession[]) => {
    if (existing.length === 0) return;

    const allDates = existing.map((s) => s.entry_date);
    const minDate = allDates.reduce((a, b) => (a < b ? a : b));
    const maxDate = allDates.reduce((a, b) => (a > b ? a : b));

    const missingDates = getAllDatesBetween(minDate, maxDate).filter(
      (d) => !allDates.includes(d)
    );

    if (missingDates.length === 0) return;

    const newEntries = missingDates.map((date) => ({
      entry_date: date,
      subject: 'No Study',
      hours: 0,
      topic: '',
      day_number: 0,
    }));

    const { error } = await supabase.from('study_sessions').insert(newEntries);
    if (error) console.error('Error inserting skipped days:', error);
    else console.log(`Inserted ${missingDates.length} skipped days.`);
  };

  const getAllDatesBetween = (start: string, end: string): string[] => {
    const dates: string[] = [];
    const current = new Date(start);
    const last = new Date(end);
    while (current <= last) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const getNextDayNumber = () => {
    if (sessions.length === 0) return 1;
    return Math.max(...sessions.map((s) => s.day_number || 0)) + 1;
  };

  const addSessionEntry = async (subject: string, hours: number, topic: string) => {
    if (!subject || hours <= 0) {
      alert('Please select a subject and enter hours');
      return;
    }

    const nextDayNumber = getNextDayNumber();

    const { data, error } = await supabase
      .from('study_sessions')
      .insert([
        {
          entry_date: selectedDate,
          day_number: nextDayNumber,
          subject,
          hours,
          topic,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Error adding session:', error);
      alert('Failed to add session');
    } else if (data) {
      setSessions([data, ...sessions]);
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    const { error } = await supabase.from('study_sessions').delete().eq('id', id);
    if (error) console.error('Error deleting session:', error);
    else setSessions(sessions.filter((s) => s.id !== id));
  };

  const addSubject = async (name: string) => {
    const { data, error } = await supabase
      .from('app_subjects')
      .insert([{ name }])
      .select()
      .single();

    if (error) {
      console.error('Error adding subject:', error);
      alert(error.message);
    } else if (data) {
      setSubjects([...subjects, data]);
    }
  };

  const deleteSubject = async (id: string) => {
    if (!confirm('Delete this subject?')) return;
    const { error } = await supabase.from('app_subjects').delete().eq('id', id);
    if (error) console.error('Error deleting subject:', error);
    else setSubjects(subjects.filter((s) => s.id !== id));
  };

  // 🔹 Group sessions by date
  const groupedByDate = new Map<string, StudySession[]>();
  sessions.forEach((s) => {
    if (!groupedByDate.has(s.entry_date)) groupedByDate.set(s.entry_date, []);
    groupedByDate.get(s.entry_date)!.push(s);
  });

  const sortedDates = Array.from(groupedByDate.keys()).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin mx-auto mb-4"></div>
          <div className="text-xl text-gray-600">Loading your study log...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100">
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-5xl font-bold text-gray-900 mb-2">Omkar's Study Log</h1>
            <p className="text-gray-600">Track and analyze my daily learning journey</p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:shadow-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md font-medium"
          >
            <Download size={20} />
            Download PDF
          </button>
        </div>

        <SummaryPanel sessions={sessions} subjects={subjects} />

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Add Today's Study Session</h2>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
          </div>

          <StudyCard
            subjects={subjects}
            onAddSession={addSessionEntry}
            onDeleteSession={() => {}}
            editMode={true}
          />

          <div className="mt-6">
            <SubjectManager
              subjects={subjects}
              onAddSubject={addSubject}
              onDeleteSubject={deleteSubject}
            />
          </div>
        </div>

        {/* 🔹 Comprehensive Daily Log */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Comprehensive Daily Log</h2>

          <div className="space-y-4">
            {sortedDates.length === 0 ? (
              <p className="text-center text-gray-600 py-8">No study sessions yet</p>
            ) : (
              sortedDates.map((date) => {
                const daySessions = groupedByDate.get(date) || [];
                const dayTotal = daySessions.reduce((sum, s) => sum + s.hours, 0);
                const firstSession = daySessions[0];
                const totalColorClass =
                  dayTotal === 0 ? 'text-red-600' : dayTotal >= 6 ? 'text-green-600' : 'text-blue-600';

                return (
                  <div
                    key={date}
                    className="border-l-4 border-blue-600 bg-gradient-to-r from-blue-50 to-white p-4 rounded-lg hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">
                          {dayTotal === 0 ? 'Skipped Day' : `Day ${firstSession.day_number || '-'}`}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {new Date(date).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                      <div className={`text-2xl font-bold ${totalColorClass}`}>
                        {dayTotal.toFixed(1)} hrs
                      </div>
                    </div>

                    <div className="space-y-2">
                      {daySessions.map((session) => (
                        <div
                          key={session.id}
                          className="bg-white p-3 rounded border border-gray-200 flex justify-between items-start"
                        >
                          <div className="flex-1">
                            <p
                              className={`font-semibold ${
                                session.hours === 0 ? 'text-red-600' : 'text-gray-900'
                              }`}
                            >
                              {session.subject}
                            </p>
                            {session.topic && (
                              <p className="text-sm text-gray-600 italic">
                                Topic: {session.topic}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-4 ml-4">
                            <span className="font-semibold text-blue-600">
                              {session.hours} hrs
                            </span>
                            <button
                              onClick={() => deleteSession(session.id)}
                              className="px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
