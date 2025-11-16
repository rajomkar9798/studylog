// src/components/StudyLog.tsx
import { useEffect, useState } from 'react';
import { supabase, StudySession, AppSubject } from '../lib/supabase';
import { StudyCard } from './StudyCard';
import { SummaryPanel } from './SummaryPanel';
import { SubjectManager } from './SubjectManager';
import { Download } from 'lucide-react';

const NO_STUDY = 'No Study';

export function StudyLog() {
  // -------------------------
  // Timezone-safe date helpers (MUST be defined BEFORE useState)
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
      return toYMDLocal(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    }
    return str.split(' ')[0];
  };

  // -------------------------
  // State (safe to use helpers above)
  // -------------------------
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [subjects, setSubjects] = useState<AppSubject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => toYMDLocal(new Date()));

  // small UI helper to scroll to top form when editing
  const scrollToForm = () => {
    const el = document.querySelector('#study-form');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // -------------------------
  // Load data on mount
  // -------------------------
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // loadData: fetch sessions and subjects, insert missing No-Study days,
  // recalc day_numbers and persist them.
  // -------------------------
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

      // Normalize existing rows
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

      // earliest and latest date in DB
      const earliest = dbSessions[0].entry_date;
      const latest = dbSessions[dbSessions.length - 1].entry_date;

      // set of existing dates
      const existingDateSet = new Set(dbSessions.map((s) => s.entry_date));

      // collect missing dates between earliest and latest
      const missing: string[] = [];
      for (let i = 0; i <= dateDiffDays(earliest, latest); i++) {
        const d = addDays(earliest, i);
        if (!existingDateSet.has(d)) missing.push(d);
      }

      // Insert missing No-Study rows (one per date)
      for (const d of missing) {
        const ins = await supabase
          .from('study_sessions')
          .insert([{ entry_date: d, day_number: 0, subject: NO_STUDY, hours: 0, topic: '' }])
          .select()
          .single();

        if (ins.error) {
          console.error('Error inserting no-study day', d, ins.error);
        } else {
          // push so later logic sees them (we will re-fetch below)
          dbSessions.push({ ...(ins.data as StudySession), entry_date: normalizeEntryDate((ins.data as any).entry_date) });
        }
      }

      // Re-fetch to ensure we have DB ids and consistent rows
      const refreshed = await supabase.from('study_sessions').select('*').order('entry_date', { ascending: true });
      if (refreshed.error) throw refreshed.error;
      const refreshedNormalized: StudySession[] = (refreshed.data || []).map((r: any) => ({
        ...r,
        entry_date: normalizeEntryDate(r.entry_date),
      }));

      // Recalculate day numbers
      const final = recalcDayNumbers(refreshedNormalized);

      // Persist day numbers if necessary
      await syncDayNumbersToDB(final);

      // Set state
      setSessions(final);
      setSubjects(dbSubs);
    } catch (err) {
      console.error('Error loading data', err);
    } finally {
      setLoading(false);
    }
  };

  // -------------------------
  // recalcDayNumbers and syncDayNumbersToDB
  // -------------------------
  const recalcDayNumbers = (list: StudySession[]) => {
    if (!list || list.length === 0) return [];
    // distinct sorted dates
    const dates = Array.from(new Set(list.map((s) => s.entry_date))).sort(
      (a, b) => parseYMDToLocalDate(a).getTime() - parseYMDToLocalDate(b).getTime()
    );
    const dateToIdx = new Map<string, number>();
    dates.forEach((d, i) => dateToIdx.set(d, i));
    return list.map((s) => ({ ...s, day_number: dateToIdx.get(s.entry_date)! }));
  };

  const syncDayNumbersToDB = async (list: StudySession[]) => {
    try {
      for (const s of list) {
        // update regardless to keep DB consistent (could optimize by checking mismatch)
        const { error } = await supabase
          .from('study_sessions')
          .update({ day_number: s.day_number, updated_at: new Date().toISOString() })
          .eq('id', s.id);
        if (error) console.error('sync day error', s.id, error);
      }
    } catch (e) {
      console.error('syncDayNumbersToDB error', e);
    }
  };

  // helper: is date the current maximum (last) date in sessions state
  const isLastDate = (date: string) => {
    if (!sessions || sessions.length === 0) return false;
    const dates = Array.from(new Set(sessions.map((s) => s.entry_date))).sort(
      (a, b) => parseYMDToLocalDate(a).getTime() - parseYMDToLocalDate(b).getTime()
    );
    return dates[dates.length - 1] === date;
  };
  // -------------------------
  // Add session for a given date (optional param). If no date passed uses selectedDate.
  // Converts No-Study → real study if needed.
  // -------------------------
  const addSessionEntry = async (subject: string, hours: number, topic: string, dateParam?: string) => {
    const targetDate = dateParam ?? selectedDate;
    if (!subject || hours <= 0) {
      alert('Please select a subject and enter hours');
      return;
    }
    try {
      // Get rows for the target date
      const res = await supabase.from('study_sessions').select('*').eq('entry_date', targetDate);
      if (res.error) throw res.error;
      const rows: StudySession[] = (res.data || []).map((r: any) => ({
        ...r,
        entry_date: normalizeEntryDate(r.entry_date),
      }));

      // If a row is "No Study", convert it into a real session (update first No Study)
      const noStudyRow = rows.find((r) => r.subject === NO_STUDY);
      if (noStudyRow) {
        const { error } = await supabase
          .from('study_sessions')
          .update({ subject, hours, topic, updated_at: new Date().toISOString() })
          .eq('id', noStudyRow.id);

        if (error) {
          console.error('Error updating no-study row', error);
          alert('Failed to add session');
          return;
        }
      } else {
        // Insert a new session (day_number assigned later on reload)
        const insert = await supabase
          .from('study_sessions')
          .insert([{ entry_date: targetDate, day_number: 0, subject, hours, topic }])
          .select()
          .single();

        if (insert.error) {
          console.error('Error inserting session', insert.error);
          alert('Failed to add session');
          return;
        }
      }

      // Reload entire dataset (fills missing dates + recalc day numbers)
      await loadData();
      // ensure UI shows the form date (in case we passed a dateParam)
      setSelectedDate(targetDate);
    } catch (err) {
      console.error('addSessionEntry error', err);
      alert('Failed to add session');
    }
  };

  // Add a session to SPECIFIC date (for Edit Day UI) — uses addSessionEntry(dateParam) to avoid setState racing
  const addSessionToDate = async (date: string, subject: string, hours: number, topic: string) => {
    await addSessionEntry(subject, hours, topic, date);
  };

  // -------------------------
  // Delete a single session row
  // If the day becomes empty, create a No-Study entry, except when the date is the last date — then remove the date completely
  // -------------------------
  const deleteSession = async (id: string) => {
    if (!confirm('Delete this entry?')) return;

    try {
      const getRes = await supabase.from('study_sessions').select('*').eq('id', id).single();
      if (getRes.error || !getRes.data) {
        console.error('Session not found', getRes.error);
        return;
      }

      const date = normalizeEntryDate(getRes.data.entry_date);

      // Delete the session row
      const del = await supabase.from('study_sessions').delete().eq('id', id);
      if (del.error) {
        console.error('deleteSession error', del.error);
        return;
      }

      // Check remaining rows for that date
      const check = await supabase.from('study_sessions').select('*').eq('entry_date', date);
      if (check.error) {
        console.error('error checking after delete', check.error);
      } else {
        const remaining: StudySession[] = (check.data || []).map((r: any) => ({
          ...r,
          entry_date: normalizeEntryDate(r.entry_date),
        }));
        const hasReal = remaining.some((r) => r.subject !== NO_STUDY);

        if (!hasReal) {
          // If no real session remains: decide based on whether this date is last
          if (isLastDate(date)) {
            // delete any remaining rows for that date (effectively removing the date)
            const delAll = await supabase.from('study_sessions').delete().eq('entry_date', date);
            if (delAll.error) console.error('Error removing last date after session deletion', delAll.error);
          } else {
            // Ensure exactly one No Study row exists (insert if none)
            if (remaining.length === 0) {
              const insert = await supabase
                .from('study_sessions')
                .insert([{ entry_date: date, day_number: 0, subject: NO_STUDY, hours: 0, topic: '' }])
                .select()
                .single();

              if (insert.error) console.error('Error creating No-Study after deletion', insert.error);
            }
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
  // Delete ENTIRE DAY
  // If it's the last date -> remove it entirely.
  // Otherwise -> remove sessions and insert single No-Study row so date remains.
  // -------------------------
  const deleteDay = async (date: string) => {
    if (!confirm(`Clear all sessions for ${date}?`)) return;

    try {
      // Delete everything for that date
      const del = await supabase.from('study_sessions').delete().eq('entry_date', date);
      if (del.error) {
        console.error('deleteDay error', del.error);
        return;
      }

      if (!isLastDate(date)) {
        // insert No-Study row for middle/first date
        const ins = await supabase
          .from('study_sessions')
          .insert([{ entry_date: date, day_number: 0, subject: NO_STUDY, hours: 0, topic: '' }])
          .select()
          .single();
        if (ins.error) console.error('insert No-Study after deleteDay', ins.error);
      } else {
        // last date: do not insert anything (date removed)
        // nothing to do here
      }

      // Recalculate everything
      await loadData();
    } catch (err) {
      console.error('deleteDay error', err);
    }
  };

  // -------------------------
  // EDIT Day -> open Add UI by setting selectedDate to that day and scroll to form
  // (User will add via the same StudyCard UI)
  // -------------------------
  const editDay = (date: string) => {
    setSelectedDate(date);
    // scroll to the Add / Edit form so user sees it
    setTimeout(() => scrollToForm(), 150);
  };

  // -------------------------
  // Subject management (unchanged)
  // -------------------------
  const addSubject = async (name: string) => {
    const { data, error } = await supabase.from('app_subjects').insert([{ name }]).select().single();
    if (error) {
      console.error('addSubject error', error);
      alert(error.message);
    } else setSubjects((p) => [...p, data]);
  };

  const deleteSubject = async (id: string) => {
    if (!confirm('Delete this subject?')) return;
    const { error } = await supabase.from('app_subjects').delete().eq('id', id);
    if (error) console.error('deleteSubject error', error);
    else setSubjects((p) => p.filter((s) => s.id !== id));
  };
  // -------------------------
  // PDF generation (simple template)
  // -------------------------
  const generatePDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const sortedSessions = [...sessions].sort(
      (a, b) => parseYMDToLocalDate(a.entry_date).getTime() - parseYMDToLocalDate(b.entry_date).getTime()
    );

    const grouped = new Map<string, StudySession[]>();
    sortedSessions.forEach((s) => {
      if (!grouped.has(s.entry_date)) grouped.set(s.entry_date, []);
      grouped.get(s.entry_date)!.push(s);
    });

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Study Log</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #222; }
            h1 { color: #2563eb; }
            .day { margin-bottom: 18px; border-left: 4px solid #2563eb; padding: 8px 12px; background: #f8fbff; }
            .session { margin: 6px 0; }
            .no-study { color: #c0392b; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Study Log</h1>
          ${Array.from(grouped.keys())
            .map((date) => {
              const items = grouped.get(date)!;
              const total = items.reduce((a, b) => a + (b.hours || 0), 0);
              const dayNum = items[0]?.day_number ?? '-';
              return `
                <div class="day">
                  <div><strong>Day ${dayNum}</strong> — ${date} — ${total.toFixed(1)} hrs</div>
                  <div>
                    ${items
                      .map((it) =>
                        it.subject === NO_STUDY
                          ? `<div class="session no-study">No Study (0 hrs)</div>`
                          : `<div class="session">${it.subject} — ${it.hours} hrs ${it.topic ? `— ${it.topic}` : ''}</div>`
                      )
                      .join('')}
                  </div>
                </div>
              `;
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
  const sortedDates = Array.from(groupedByDate.keys()).sort(
    (a, b) => parseYMDToLocalDate(b).getTime() - parseYMDToLocalDate(a).getTime()
  );

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

        <div id="study-form" className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Add / Edit Today's Study Session</h2>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          {/* StudyCard uses selectedDate via propless approach; addSessionEntry now accepts optional date param
              To edit a day: click Edit -> selectedDate set -> fill form -> Add Session (this will add to selectedDate)
          */}
          <StudyCard subjects={subjects} onAddSession={(s, h, t) => addSessionEntry(s, h, t)} editMode={true} onDeleteSession={(id: string) => deleteSession(id)} />

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
                          {parseYMDToLocalDate(date).toLocaleDateString(undefined, {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
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
                        <div
                          key={s.id}
                          className={`bg-white p-3 rounded border border-gray-200 flex justify-between items-start ${s.subject === NO_STUDY ? 'opacity-95' : ''}`}
                        >
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
