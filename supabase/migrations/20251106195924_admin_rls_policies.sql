/*
  # Admin RLS policies and admin_users table

  1. New Table: admin_users
    - id (uuid, primary key)
    - email (text, unique)
    - password_hash (text)
    - created_at (timestamptz)
  
  2. RLS Changes
    - Drop old public write policies
    - Add admin-only write policies
    - Keep public read access
*/

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow public insert access" ON study_sessions;
  DROP POLICY IF EXISTS "Allow public update access" ON study_sessions;
  DROP POLICY IF EXISTS "Allow public delete access" ON study_sessions;
  DROP POLICY IF EXISTS "Allow public insert subjects" ON app_subjects;
  DROP POLICY IF EXISTS "Allow public delete subjects" ON app_subjects;
END $$;

CREATE POLICY "Admin insert sessions"
  ON study_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Admin update sessions"
  ON study_sessions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = auth.jwt()->>'email'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Admin delete sessions"
  ON study_sessions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Admin insert subjects"
  ON app_subjects FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Admin delete subjects"
  ON app_subjects FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = auth.jwt()->>'email'
    )
  );

CREATE POLICY "Admin read admin_users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (auth.jwt()->>'email' = email);
