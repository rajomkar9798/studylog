// src/components/StudyLog.tsx
import { useEffect, useState } from 'react';
import { supabase, StudySession, AppSubject } from '../lib/supabase';
import { StudyCard } from './StudyCard';
import { SummaryPanel } from './SummaryPanel';
import { SubjectManager } from './SubjectManager';
import { Download } from 'lucide-react';

const NO_STUDY = 'No Study';

export function StudyLog() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [subjects, setSubjects] = useState<AppSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    return toYMDLocal(d);
  });

  // -------------------------
  // Timezone-safe date helpers
  // -------------------------
  const toYMDLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const parseYMDToLocalDate = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const addDays = (dStr: string, days: number) => {
    const d = parseYMDToLocalDate(dStr);
    d.setDate(d.getDate() + days);
    return toYMDLocal(d);
  };

  const dateDiffDays = (a: string, b: string) => {
    const da = parseYMDToLocalDate(a).setHours(0, 0, 0, 0);
    const db = parseYMDToLocalDate(b).setHours(0, 0, 0, 0);
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
  };

  const normalizeEntryDate = (val: any) => {
    if (!val) return '';
    const str = String(val);
    if (str.includes('T')) {
      const dt = new Date(str);
      // create local date from the timestamp
      return toYMDLocal(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    }
    // assume already YYYY-MM-DD or similar; take first token
    return str.split(' ')[0];
  };

  // -------------------------
  // Core: load data & ensure full date range
  // -------------------------
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sessionsRes, subjectsRes] = await Promise.all([
        supabase.from('study_sessions').select('*').order('entry_date', { ascending: true }),
        supabase.from('app_subjects').select('*').order('name', { ascending: true }),
      ]);

      if (sessionsRes.error) throw sessionsRes.error;
      if (subjectsRes.error) throw subjectsRes.error;

      const dbSubs: AppSubject[] = (subjectsRes.data || []) as AppSubject[];

      // Normalize dates
      let dbSessions: StudySession[] = (sessionsRes.data || []).map((r: any) => ({
        ...r,
        entry_date: normalizeEntryDate(r.entry_date),
      }));

      // If no sessions at all -> nothing to fill; still keep subjects
      if (dbSessions.length === 0) {
        setSessions([]);
        setSubjects(dbSubs);
        setLoading(false);
        return;
      }

      // Determine earliest & latest dates
      const earliest = dbSessions[0].entry_date;
      const latest = dbSessions[dbSessions.length - 1].entry_date;

      // Build set of existing dates
      const existingDateSet = new Set(dbSessions.map((s) => s.entry_date));

      // Find missing dates between earliest and latest
      const missing: string[] = [];
      for (let i = 0; i <= dateDiffDays(earliest, latest); i++) {
        const d = addDays(earliest, i);
        if (!existingDateSet.has(d)) missing.push(d);
      }

      // Insert missing dates as No Study rows (one row per missing date)
      for (const d of missing) {
        const ins = await supabase
          .from('study_sessions')
          .insert([
            {
              entry_date: d,
              day_number: 0, // temporary, will recalc
              subject: NO_STUDY,
              hours: 0,
              topic: '',
            },
          ])
          .select()
          .single();

        if (ins.error) {
          console.error('Error inserting no-study day', d, ins.error);
        } else {
          dbSessions.push({ ...(ins.data as StudySession), entry_date: normalizeEntryDate((ins.data as any).entry_date) });
        }
      }

      // Re-fetch to ensure we have server ids and consistent order
      const refreshed = await supabase.from('study_sessions').select('*').order('entry_date', { ascending: true });
      if (refreshed.error) throw refreshed.error;
      const refreshedNormalized: StudySession[] = (refreshed.data || []).map((r: any) => ({
        ...r,
        entry_date: normalizeEntryDate(r.entry_date),
      }));

      // Recalculate day numbers
      const final = recalcDayNumbers(refreshedNormalized);

      // Persist day numbers if mismatch
      await syncDayNumbersToDB(final);

      // Update state
      setSessions(final);
      setSubjects(dbSubs);
    } catch (err) {
      console.error('Error loading data', err);
    } finally {
      setLoading(false);
    }
  };

  // Recalculate day_number for every session based on distinct sorted dates
  const recalcDayNumbers = (list: StudySession[]) => {
    if (!list || list.length === 0) return [];
    // distinct sorted dates
    const dates = Array.from(new Set(list.map((s) => s.entry_date))).sort((a, b) => parseYMDToLocalDate(a).getTime() - parseYMDToLocalDate(b).getTime());
    const dateToIdx = new Map<string, number>();
    dates.forEach((d, i) => dateToIdx.set(d, i));
    // assign
    return list.map((s) => ({ ...s, day_number: dateToIdx.get(s.entry_date)! }));
  };

  // sync day_number to DB for every session (simple loop)
  const syncDayNumbersToDB = async (list: StudySession[]) => {
    try {
      for (const s of list) {
        // update if day_number undefined or differs
        const { error } = await supabase.from('study_sessions').update({ day_number: s.day_number, updated_at: new Date().toISOString() }).eq('id', s.id);
        if (error) console.error('sync day error', s.id, error);
      }
    } catch (e) {
      console.error('syncDayNumbersToDB error', e);
    }
  };

  // -------------------------
  // Add session (uses selectedDate)
  // If selectedDate currently has a No Study row -> update that row into real session
  // Otherwise insert new row
  // -------------------------
  const addSessionEntry = async (subject: string, hours: number, topic: string) => {
    if (!subject || hours <= 0) {
      alert('Please select a subject and enter hours');
      return;
    }
    try {
      // fetch rows for that date
      const res = await supabase.from('study_sessions').select('*').eq('entry_date', selectedDate);
      if (res.error) throw res.error;
      const rows: StudySession[] = (res.data || []).map((r: any) => ({ ...r, entry_date: normalizeEntryDate(r.entry_date) }));
      // if there's a No Study row, update the first one into this session
      const noStudyRow = rows.find((r) => r.subject === NO_STUDY);
      if (noStudyRow) {
        const { error } = await supabase.from('study_sessions').update({ subject, hours, topic, updated_at: new Date().toISOString() }).eq('id', noStudyRow.id);
        if (error) {
          console.error('Error updating no-study row', error);
          alert('Failed to add session');
          return;
        }
      } else {
        // insert a new session (day_number assigned later on reload)
        const insert = await supabase.from('study_sessions').insert([{ entry_date: selectedDate, day_number: 0, subject, hours, topic }]).select().single();
        if (insert.error) {
          console.error('Error inserting session', insert.error);
          alert('Failed to add session');
          return;
        }
      }
      // reload entire dataset and recalc
      await loadData();
    } catch (err) {
      console.error('addSessionEntry error', err);
      alert('Failed to add session');
    }
  };

  // Add session to a specific date (used by Edit Day prompt)
  const addSessionToDate = async (date: string, subject: string, hours: number, topic: string) => {
    const prevSelected = selectedDate;
    setSelectedDate(date);
    await addSessionEntry(subject, hours, topic);
    setSelectedDate(prevSelected);
  };

  // -------------------------
  // Delete one session row (by id). If after deletion, no real sessions remain for that date, ensure a No Study row exists
  // -------------------------
  const deleteSession = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    try {
      // get the row first
      const getRes = await supabase.from('study_sessions').select('*').eq('id', id).single();
      if (getRes.error || !getRes.data) {
        console.error('could not find session to delete', getRes.error);
        return;
      }
      const date = normalizeEntryDate((getRes.data as any).entry_date);
      // delete the row
      const del = await supabase.from('study_sessions').delete().eq('id', id);
      if (del.error) {
        console.error('delete session error', del.error);
        return;
      }
      // check remaining rows for that date
      const check = await supabase.from('study_sessions').select('*').eq('entry_date', date);
      if (check.error) {
        console.error('error checking after delete', check.error);
      } else {
        const remaining = (check.data || []).map((r: any) => ({ ...r, entry_date: normalizeEntryDate(r.entry_date) })) as StudySession[];
        const hasReal = remaining.some((r) => r.subject !== NO_STUDY);
        if (!hasReal) {
          // If no real session remains, ensure there's exactly one No Study row
          if (remaining.length === 0) {
            const insert = await supabase.from('study_sessions').insert([{ entry_date: date, day_number: 0, subject: NO_STUDY, hours: 0, topic: '' }]).select().single();
            if (insert.error) console.error('Error inserting no-study after session-delete', insert.error);
          } else {
            // If there are No Study rows already, leave as is
          }
        }
      }
      // reload & recalc
      await loadData();
    } catch (err) {
      console.error('deleteSession error', err);
    }
  };

  // -------------------------
  // Delete entire day: clears all sessions on that date and replaces with a single No Study row
  // -------------------------
  const deleteDay = async (date: string) => {
    if (!confirm(`Clear all sessions for ${date}? This will convert the day to 'No Study'.`)) return;
    try {
      // delete all rows for that date
      const del = await supabase.from('study_sessions').delete().eq('entry_date', date);
      if (del.error) {
        console.error('deleteDay error', del.error);
        return;
      }
      // insert single No Study row for that date
      const ins = await supabase.from('study_sessions').insert([{ entry_date: date, day_number: 0, subject: NO_STUDY, hours: 0, topic: '' }]).select().single();
      if (ins.error) console.error('insert no-study after deleteDay', ins.error);
      // reload & recalc
      await loadData();
    } catch (err) {
      console.error('deleteDay error', err);
    }
  };

  // -------------------------
  // Edit day: quick prompt based editor for adding a single session to that day (you can replace with modal)
  // -------------------------
  const editDay = async (date: string) => {
    // Simple prompt flow: subject -> hours -> topic
    const subject = prompt('Enter subject (choose from dropdown later):', subjects[0]?.name || '');
    if (!subject || subject.trim() === '') {
      alert('Subject required to add session.');
      return;
    }
    const hoursStr = prompt('Enter hours (e.g., 1.5):', '1');
    if (!hoursStr) return;
    const hours = parseFloat(hoursStr);
    if (isNaN(hours) || hours <= 0) {
      alert('Invalid hours');
      return;
    }
    const topic = prompt('Enter topic (optional):', '') || '';
    await addSessionToDate(date, subject.trim(), hours, topic.trim());
  };

  // -------------------------
  // Subject management (same as before)
  // -------------------------
  const addSubject = async (name: string) => {
    const { data, error } = await supabase.from('app_subjects').insert([{ name }]).select().single();
    if (error) {
      console.error('Error adding subject', error);
      alert(error.message);
    } else if (data) {
      setSubjects((prev) => [...prev, data]);
    }
  };

  const deleteSubject = async (id: string) => {
    if (!confirm('Delete this subject?')) return;
    const { error } = await supabase.from('app_subjects').delete().eq('id', id);
    if (error) console.error('delete subject error', error);
    else setSubjects((p) => p.filter((s) => s.id !== id));
  };

  // -------------------------
  // PDF generation - keep your template here (shortened in this example)
  // -------------------------
  const generatePDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // Build printable HTML using sessions state (you can reuse your existing big template)
    const sortedSessions = [...sessions].sort((a, b) => parseYMDToLocalDate(a.entry_date).getTime() - parseYMDToLocalDate(b.entry_date).getTime());
    const grouped = new Map<string, StudySession[]>();
    sortedSessions.forEach((s) => {
      if (!grouped.has(s.entry_date)) grouped.set(s.entry_date, []);
      grouped.get(s.entry_date)!.push(s);
    });

    // Basic HTML for demo - replace with your full styled template
    const html = `
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><title>Study Log</title></head>
        <body>
          <h1>Study Log</h1>
          ${Array.from(grouped.keys())
            .map((date) => {
              const daySessions = grouped.get(date)!;
              const total = daySessions.reduce((a, b) => a + (b.hours || 0), 0);
              return `<h2>${date} — ${total.toFixed(1)} hrs</h2>
                <ul>
                  ${daySessions.map((s) => `<li>${s.subject} — ${s.hours} hrs ${s.topic ? `— ${s.topic}` : ''}</li>`).join('')}
                </ul>`;
            })
            .join('')}
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  // -------------------------
  // Rendering
  // -------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin mx-auto mb-4" />
          <div className="text-xl text-gray-600">Loading your study log...</div>
        </div>
      </div>
    );
  }

  // Group sessions by date for UI display
  const groupedByDate = new Map<string, StudySession[]>();
  sessions.forEach((s) => {
    if (!groupedByDate.has(s.entry_date)) groupedByDate.set(s.entry_date, []);
    groupedByDate.get(s.entry_date)!.push(s);
  });

  // sort dates desc for UI (latest first)
  const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => parseYMDToLocalDate(b).getTime() - parseYMDToLocalDate(a).getTime());

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100">
      <div className="container mx-auto py-8 px-4 max-w-5xl">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-5xl font-bold text-gray-900 mb-2">Omkar's Study Log</h1>
            <p className="text-gray-600">Track and analyze your learning journey</p>
          </div>

          <div className="flex gap-3">
            <button onClick={generatePDF} className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg">
              <Download size={18} /> Download PDF
            </button>
          </div>
        </div>

        <SummaryPanel sessions={sessions} subjects={subjects} />

        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Add / Edit Today's Study Session</h2>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Date</label>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>

          <StudyCard subjects={subjects} onAddSession={addSessionEntry} editMode={true} onDeleteSession={(id: string) => deleteSession(id)} />

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
                const dayTotal = daySessions.reduce((sum, s) => sum + (s.hours || 0), 0);
                const first = daySessions[0];
                const totalColor = dayTotal >= 6 ? 'text-green-600' : 'text-red-600';

                return (
                  <div key={date} className="border-l-4 border-blue-600 bg-gradient-to-r from-blue-50 to-white p-4 rounded-lg hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Day {first.day_number}</h3>
                        <p className="text-sm text-gray-600">
                          {parseYMDToLocalDate(date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className={`text-2xl font-bold ${totalColor}`}>{dayTotal.toFixed(1)} hrs</div>
                        <button onClick={() => editDay(date)} className="px-3 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 text-sm">
                          Edit
                        </button>
                        <button onClick={() => deleteDay(date)} className="px-3 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 text-sm">
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {daySessions.map((s) => (
                        <div key={s.id} className={`bg-white p-3 rounded border border-gray-200 flex justify-between items-start ${s.subject === NO_STUDY ? 'opacity-95' : ''}`}>
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{s.subject === NO_STUDY ? 'No Study (Rest Day)' : s.subject}</p>
                            {s.topic && s.subject !== NO_STUDY && <p className="text-sm text-gray-600 italic">Topic: {s.topic}</p>}
                          </div>

                          <div className="flex items-center gap-4 ml-4">
                            <span className={`font-semibold ${s.hours === 0 ? 'text-red-600' : 'text-blue-600'}`}>{s.hours} hrs</span>

                            {s.subject !== NO_STUDY && (
                              <button onClick={() => deleteSession(s.id)} className="px-3 py-1 text-red-600 hover:bg-red-50 rounded transition-colors text-sm">
                                Delete
                              </button>
                            )}
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
