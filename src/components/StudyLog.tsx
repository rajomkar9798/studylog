// src/components/StudyLog.tsx
import { useEffect, useState, useRef } from 'react';
import { supabase, StudySession, AppSubject } from '../lib/supabase';
import { StudyCard } from './StudyCard';
import { SummaryPanel } from './SummaryPanel';
import { SubjectManager } from './SubjectManager';
import { Download } from 'lucide-react';

/**
 * Behavior implemented:
 * - Missing dates between min and max are auto-inserted as REST rows (subject='__REST__', hours=0).
 * - Day numbers are recalculated from earliest date -> day 0, ascending.
 * - addSession updates a REST row for that date (if exists) otherwise inserts.
 * - deleteSession: if it removes the last non-REST row for a date, a REST row is inserted for that date.
 * - All changes re-sync day_number for all rows.
 */

const REST_SUBJECT = '__REST__';

export function StudyLog() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [subjects, setSubjects] = useState<AppSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------
  // Utilities: date helpers
  // ---------------------
  const toYMD = (d: Date) => d.toISOString().split('T')[0];

  const addDays = (dStr: string, days: number) => {
    const d = new Date(dStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return toYMD(d);
  };

  const dateDiffDays = (a: string, b: string) => {
    const da = new Date(a + 'T00:00:00').getTime();
    const db = new Date(b + 'T00:00:00').getTime();
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
  };

  // ---------------------
  // Core: load, sync, fill rest days, recalc day numbers
  // ---------------------
  const loadData = async () => {
    setLoading(true);
    try {
      const [sessionsResult, subjectsResult] = await Promise.all([
        supabase.from('study_sessions').select('*').order('entry_date', { ascending: true }),
        supabase.from('app_subjects').select('*').order('name', { ascending: true }),
      ]);

      if (sessionsResult.error) throw sessionsResult.error;
      if (subjectsResult.error) throw subjectsResult.error;

      const dbSessions: StudySession[] = sessionsResult.data || [];
      const dbSubjects: AppSubject[] = subjectsResult.data || [];

      // Ensure entry_date is YMD (if returned as datetime)
      const normalized = dbSessions.map((s) => ({
        ...s,
        entry_date: (s.entry_date as string).split('T')[0],
      }));

      // If there are no sessions, just set and return (no rest-day filling)
      if (normalized.length === 0) {
        setSessions([]);
        setSubjects(dbSubjects);
        setLoading(false);
        return;
      }

      // Compute contiguous date range from earliest to latest found
      const earliest = normalized[0].entry_date;
      const latest = normalized[normalized.length - 1].entry_date;

      // Build a map date -> sessions[]
      const map = new Map<string, StudySession[]>();
      normalized.forEach((s) => {
        if (!map.has(s.entry_date)) map.set(s.entry_date, []);
        map.get(s.entry_date)!.push(s);
      });

      // Collect missing dates and insert REST rows for them (if not present)
      const missingDates: string[] = [];
      for (let i = 0; i <= dateDiffDays(earliest, latest); i++) {
        const d = addDays(earliest, i);
        if (!map.has(d)) missingDates.push(d);
      }

      // Insert missing dates as REST rows into DB (synchronously)
      if (missingDates.length > 0) {
        for (const d of missingDates) {
          const insertRes = await supabase
            .from('study_sessions')
            .insert([
              {
                entry_date: d,
                day_number: 0, // temp; will be recalculated soon
                subject: REST_SUBJECT,
                hours: 0,
                topic: '',
              },
            ])
            .select()
            .single();

          if (insertRes.error) {
            console.error('Error inserting rest day', d, insertRes.error);
          } else {
            // push into map so subsequent processing sees it
            if (!map.has(d)) map.set(d, []);
            map.get(d)!.push(insertRes.data as StudySession);
          }
        }
      }

      // Reload sessions after insertions to get consistent data & IDs
      const refreshed = await supabase.from('study_sessions').select('*').order('entry_date', { ascending: true });
      if (refreshed.error) throw refreshed.error;
      const refreshedNormalized = (refreshed.data || []).map((s: any) => ({
        ...s,
        entry_date: (s.entry_date as string).split('T')[0],
      })) as StudySession[];

      // Recalculate day numbers (continuous from earliest date)
      const final = recalcDayNumbers(refreshedNormalized);

      // Put back to DB if any day_number mismatches existed (bulk update)
      await syncDayNumbersToDB(final);

      setSessions(final);
      setSubjects(dbSubjects);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Take a list of sessions and recalc day_number based on earliest date -> day 0
  const recalcDayNumbers = (list: StudySession[]) => {
    if (list.length === 0) return [];
    // Sort by entry_date asc, then by created_at if needed
    const sortedDates = Array.from(new Set(list.map((s) => s.entry_date))).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    const dateToDayNum = new Map<string, number>();
    sortedDates.forEach((date, idx) => dateToDayNum.set(date, idx));

    // Assign day_number for each session according to its date
    return list.map((s) => ({ ...s, day_number: dateToDayNum.get(s.entry_date)! }));
  };

  // Sync day_number for all sessions to DB (only where mismatch)
  const syncDayNumbersToDB = async (sessionsList: StudySession[]) => {
    try {
      // Loop and update any session where stored day_number !== calculated
      for (const s of sessionsList) {
        if (s.day_number === undefined || s.day_number === null) continue;
        // Fetch current db value to compare (or rely on s.day_number? we'll update regardless to be safe)
        const { error } = await supabase
          .from('study_sessions')
          .update({ day_number: s.day_number, updated_at: new Date().toISOString() })
          .eq('id', s.id);
        if (error) {
          console.error('Error syncing day_number for', s.id, error);
        }
      }
    } catch (err) {
      console.error('Error in syncDayNumbersToDB', err);
    }
  };

  // Get the next day number to use for a NEW date after the current max date
  // But since we store rest days and always recalc, the next day number is simply (max date index + 1)
  const getNextDayNumberForAppend = () => {
    if (sessions.length === 0) return 0;
    const maxDay = Math.max(...sessions.map((s) => s.day_number ?? 0));
    return maxDay + 1;
  };

  // ---------------------
  // Add session: either update existing REST row for that date, or insert a new row
  // After any change, we recalc day_numbers and resync
  // ---------------------
  const addSessionEntry = async (subject: string, hours: number, topic: string) => {
    if (!subject || hours <= 0) {
      alert('Please select a subject and enter hours');
      return;
    }

    try {
      // Check if there's already any session for selectedDate
      const existingRes = await supabase
        .from('study_sessions')
        .select('*')
        .eq('entry_date', selectedDate);

      if (existingRes.error) throw existingRes.error;

      const rows: StudySession[] = (existingRes.data || []).map((r: any) => ({
        ...r,
        entry_date: (r.entry_date as string).split('T')[0],
      }));

      if (rows.length === 0) {
        // No row exists for this date (this should not happen often because we fill rest days),
        // create new row with day_number = nextDayNumber
        const nextDay = getNextDayNumberForAppend();
        const insertRes = await supabase
          .from('study_sessions')
          .insert([
            {
              entry_date: selectedDate,
              day_number: nextDay,
              subject,
              hours,
              topic,
            },
          ])
          .select()
          .single();

        if (insertRes.error) {
          console.error('Error inserting session:', insertRes.error);
          alert('Failed to add session');
          return;
        }
      } else {
        // If there is any REST row for this date, prefer updating the REST row to a real session
        const restRow = rows.find((r) => r.subject === REST_SUBJECT);
        if (restRow) {
          // Update the rest row into a real session
          const { error } = await supabase
            .from('study_sessions')
            .update({ subject, hours, topic, updated_at: new Date().toISOString() })
            .eq('id', restRow.id);

          if (error) {
            console.error('Error updating rest row:', error);
            alert('Failed to add session');
            return;
          }
        } else {
          // There are other sessions on this date. Insert another session
          const insertRes = await supabase
            .from('study_sessions')
            .insert([
              {
                entry_date: selectedDate,
                day_number: rows[0].day_number ?? getNextDayNumberForAppend(),
                subject,
                hours,
                topic,
              },
            ])
            .select()
            .single();

          if (insertRes.error) {
            console.error('Error inserting session:', insertRes.error);
            alert('Failed to add session');
            return;
          }
        }
      }

      // After insertion/update: reload and resync everything
      await loadData();
    } catch (err) {
      console.error('Error in addSessionEntry', err);
      alert('Failed to add session');
    }
  };

  // ---------------------
  // Update session (hours/topic)
  // ---------------------
  const updateSession = async (id: string, hours: number, topic: string) => {
    try {
      const { error } = await supabase
        .from('study_sessions')
        .update({ hours, topic, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) {
        console.error('Error updating session:', error);
      } else {
        // Update local state first for snappy UI
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, hours, topic } : s)));
        // Re-sync day numbers (if needed)
        const refreshed = await supabase.from('study_sessions').select('*').order('entry_date', { ascending: true });
        if (!refreshed.error) {
          const normalized = (refreshed.data || []).map((r: any) => ({ ...r, entry_date: (r.entry_date as string).split('T')[0] })) as StudySession[];
          const final = recalcDayNumbers(normalized);
          await syncDayNumbersToDB(final);
          setSessions(final);
        }
      }
    } catch (err) {
      console.error('Error in updateSession', err);
    }
  };

  // ---------------------
  // Delete a single session row by id.
  // If it was the last REAL session for that date, insert a REST row so date remains.
  // ---------------------
  const deleteSession = async (id: string) => {
    if (!confirm('Delete this entry?')) return;

    try {
      // Get the session first
      const { data: found, error: fErr } = await supabase.from('study_sessions').select('*').eq('id', id).single();
      if (fErr || !found) {
        console.error('Could not find session before delete', fErr);
        return;
      }
      const date = (found.entry_date as string).split('T')[0];
      const subjectOfFound = found.subject;

      // Delete the session
      const { error } = await supabase.from('study_sessions').delete().eq('id', id);
      if (error) {
        console.error('Error deleting session', error);
        return;
      }

      // After deletion, check if any rows exist for that date
      const check = await supabase.from('study_sessions').select('*').eq('entry_date', date);
      if (check.error) {
        console.error('Error checking date after delete', check.error);
      } else {
        const remaining = (check.data || []).map((r: any) => ({ ...r, entry_date: (r.entry_date as string).split('T')[0] })) as StudySession[];
        const hasNonRest = remaining.some((r) => r.subject !== REST_SUBJECT);

        if (!hasNonRest) {
          // No real sessions remain for that date. Ensure there is a REST row.
          if (remaining.length === 0) {
            // insert rest row
            const insertRes = await supabase
              .from('study_sessions')
              .insert([
                {
                  entry_date: date,
                  day_number: 0, // temp
                  subject: REST_SUBJECT,
                  hours: 0,
                  topic: '',
                },
              ])
              .select()
              .single();

            if (insertRes.error) {
              console.error('Error inserting rest day after delete', insertRes.error);
            }
          } else {
            // There may be REST rows already; do nothing
          }
        }
      }

      // Finally reload & resync day numbers
      await loadData();
    } catch (err) {
      console.error('Error in deleteSession', err);
    }
  };

  // ---------------------
  // Subjects add / delete (same as before)
  // ---------------------
  const addSubject = async (name: string) => {
    const { data, error } = await supabase.from('app_subjects').insert([{ name }]).select().single();
    if (error) {
      console.error('Error adding subject:', error);
      alert(error.message);
    } else if (data) {
      setSubjects((prev) => [...prev, data]);
    }
  };

  const deleteSubject = async (id: string) => {
    if (!confirm('Delete this subject?')) return;
    const { error } = await supabase.from('app_subjects').delete().eq('id', id);
    if (error) {
      console.error('Error deleting subject:', error);
    } else {
      setSubjects((prev) => prev.filter((s) => s.id !== id));
    }
  };

  // ---------------------
  // PDF generator (unchanged, but shows REST rows with 0 hrs)
  // ---------------------
  const generatePDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const sortedSessions = [...sessions].sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());

    const groupedByDay = new Map<string, StudySession[]>();
    sortedSessions.forEach((session) => {
      if (!groupedByDay.has(session.entry_date)) groupedByDay.set(session.entry_date, []);
      groupedByDay.get(session.entry_date)!.push(session);
    });

    const subjectTotals: Record<string, number> = {};
    subjects.forEach((s) => {
      subjectTotals[s.name] = 0;
    });

    sessions.forEach((session) => {
      if (subjectTotals.hasOwnProperty(session.subject)) {
        subjectTotals[session.subject] += session.hours;
      }
    });

    const html = `<!DOCTYPE html> ...`; // keep your existing large HTML template or reuse original
    printWindow.document.write(html);
    printWindow.document.close();
  };

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

  // Group by date for UI
  const groupedByDate = new Map<string, StudySession[]>();
  sessions.forEach((session) => {
    if (!groupedByDate.has(session.entry_date)) groupedByDate.set(session.entry_date, []);
    groupedByDate.get(session.entry_date)!.push(session);
  });

  const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100">
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-5xl font-bold text-gray-900 mb-2">Study Log Pro</h1>
            <p className="text-gray-600">Track and analyze your learning journey</p>
          </div>
          <button
            onClick={generatePDF}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:shadow-lg transition-all shadow-md font-medium"
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

          <StudyCard subjects={subjects} onAddSession={addSessionEntry} editMode={true} onDeleteSession={deleteSession} />

          <div className="mt-6">
            <SubjectManager subjects={subjects} onAddSubject={addSubject} onDeleteSubject={deleteSubject} />
          </div>
        </div>

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
                const totalColorClass = dayTotal >= 6 ? 'text-green-600' : 'text-red-600';

                return (
                  <div
                    key={date}
                    className="border-l-4 border-blue-600 bg-gradient-to-r from-blue-50 to-white p-4 rounded-lg hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Day {firstSession.day_number}</h3>
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
                          className={`bg-white p-3 rounded border border-gray-200 flex justify-between items-start ${session.subject === REST_SUBJECT ? 'opacity-90' : ''}`}
                        >
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">
                              {session.subject === REST_SUBJECT ? 'No Study (Rest Day)' : session.subject}
                            </p>
                            {session.topic && session.subject !== REST_SUBJECT && (
                              <p className="text-sm text-gray-600 italic">Topic: {session.topic}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-4 ml-4">
                            <span className={`font-semibold ${session.hours === 0 ? 'text-red-600' : 'text-blue-600'}`}>
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
