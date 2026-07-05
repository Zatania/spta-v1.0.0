INSERT IGNORE INTO roles (name, description)
VALUES
  ('admin', 'Administrator'),
  ('teacher', 'Teacher');

INSERT IGNORE INTO grades (name)
VALUES
  ('Grade 1'),
  ('Grade 2'),
  ('Grade 3'),
  ('Grade 4'),
  ('Grade 5'),
  ('Grade 6');

INSERT INTO school_years (name, start_date, end_date, is_current)
SELECT '2026-2027', '2026-06-01', '2027-05-31', 1
WHERE NOT EXISTS (SELECT 1 FROM school_years WHERE is_current = 1);

INSERT INTO users (username, password_hash, email, full_name, is_deleted, created_at, updated_at)
SELECT 'admin', '$2b$10$iZsGI62YR2Q2u4K.LgZtgu1Zg12tksam9hQlrJp5ktGbOJMpYYKkG', 'admin@example.com', 'System Administrator', 0, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.name = 'admin'
WHERE u.username = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );
