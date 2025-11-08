/*
  # Redesign study log schema for proper data persistence

  1. New Tables
    - `app_subjects` - Stores custom subject list
      - `id` (uuid, primary key)
      - `name` (text, unique) - Subject name
      - `created_at` (timestamptz)
    
    - `study_sessions` - Individual study session entries
      - `id` (uuid, primary key)
      - `entry_date` (date) - Date of the study session
      - `day_number` (integer) - Day counter
      - `subject` (text) - Subject studied
      - `hours` (numeric) - Hours spent
      - `topic` (text) - Topic details
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on both tables
    - Add policy for public access (single-user app)
  
  3. Important Notes
    - study_sessions: Each row is ONE subject entry for ONE day
    - This allows unlimited entries per day
    - Old study_entries table is preserved for backward compatibility
    - No data loss - all entries are persisted individually
*/

CREATE TABLE IF NOT EXISTS app_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  day_number integer NOT NULL,
  subject text NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  topic text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE app_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read subjects"
  ON app_subjects FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert subjects"
  ON app_subjects FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public delete subjects"
  ON app_subjects FOR DELETE
  TO anon
  USING (true);

CREATE POLICY "Allow public read sessions"
  ON study_sessions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert sessions"
  ON study_sessions FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public update sessions"
  ON study_sessions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete sessions"
  ON study_sessions FOR DELETE
  TO anon
  USING (true);

CREATE INDEX IF NOT EXISTS idx_study_sessions_entry_date ON study_sessions(entry_date);
CREATE INDEX IF NOT EXISTS idx_study_sessions_day_number ON study_sessions(day_number);
CREATE INDEX IF NOT EXISTS idx_study_sessions_subject ON study_sessions(subject);

INSERT INTO app_subjects (name) VALUES
  ('Java'),
  ('DSA'),
  ('SQL (DBMS)'),
  ('Mini Project + GitHub Push'),
  ('Tech Blogs'),
  ('TCS NQT')
ON CONFLICT DO NOTHING;
