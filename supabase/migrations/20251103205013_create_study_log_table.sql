/*
  # Create study log table

  1. New Tables
    - `study_entries`
      - `id` (uuid, primary key)
      - `day_number` (integer, unique) - The day counter (Day 0, Day 1, etc.)
      - `entry_date` (date) - The date for this entry
      - `subject_1` (text) - Subject dropdown value
      - `hours_1` (numeric) - Hours for subject 1
      - `topic_1` (text) - Topic notes for subject 1
      - `subject_2` (text) - Subject dropdown value
      - `hours_2` (numeric) - Hours for subject 2
      - `topic_2` (text) - Topic notes for subject 2
      - `subject_3` (text) - Subject dropdown value
      - `hours_3` (numeric) - Hours for subject 3
      - `topic_3` (text) - Topic notes for subject 3
      - `subject_4` (text) - Subject dropdown value
      - `hours_4` (numeric) - Hours for subject 4
      - `topic_4` (text) - Topic notes for subject 4
      - `subject_5` (text) - Subject dropdown value
      - `hours_5` (numeric) - Hours for subject 5
      - `topic_5` (text) - Topic notes for subject 5
      - `subject_6` (text) - Subject dropdown value
      - `hours_6` (numeric) - Hours for subject 6
      - `topic_6` (text) - Topic notes for subject 6
      - `created_at` (timestamptz) - Timestamp when created
      - `updated_at` (timestamptz) - Timestamp when last updated
  
  2. Security
    - Enable RLS on `study_entries` table
    - Add policy for public read access (single-user study log)
    - Add policy for public write access (single-user study log)
  
  3. Important Notes
    - day_number is unique to prevent duplicate days
    - hours fields are numeric to support decimal values (e.g., 1.5 hours)
    - Public access policies for simplified single-user experience
*/

CREATE TABLE IF NOT EXISTS study_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_number integer UNIQUE NOT NULL,
  entry_date date NOT NULL,
  subject_1 text DEFAULT '',
  hours_1 numeric DEFAULT 0,
  topic_1 text DEFAULT '',
  subject_2 text DEFAULT '',
  hours_2 numeric DEFAULT 0,
  topic_2 text DEFAULT '',
  subject_3 text DEFAULT '',
  hours_3 numeric DEFAULT 0,
  topic_3 text DEFAULT '',
  subject_4 text DEFAULT '',
  hours_4 numeric DEFAULT 0,
  topic_4 text DEFAULT '',
  subject_5 text DEFAULT '',
  hours_5 numeric DEFAULT 0,
  topic_5 text DEFAULT '',
  subject_6 text DEFAULT '',
  hours_6 numeric DEFAULT 0,
  topic_6 text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE study_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access"
  ON study_entries FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow public insert access"
  ON study_entries FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow public update access"
  ON study_entries FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access"
  ON study_entries FOR DELETE
  TO anon
  USING (true);

CREATE INDEX IF NOT EXISTS idx_study_entries_day_number ON study_entries(day_number);
CREATE INDEX IF NOT EXISTS idx_study_entries_entry_date ON study_entries(entry_date);