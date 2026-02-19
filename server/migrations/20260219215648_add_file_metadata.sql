ALTER TABLE files ADD COLUMN metadata JSONB;

UPDATE files SET metadata = jsonb_build_object('type', 'image', 'mime', file_type, 'width', 0, 'height', 0)
  WHERE file_type LIKE 'image/%';
UPDATE files SET metadata = jsonb_build_object('type', 'video', 'mime', file_type, 'width', 0, 'height', 0)
  WHERE file_type LIKE 'video/%';
UPDATE files SET metadata = jsonb_build_object('type', 'audio', 'mime', file_type)
  WHERE file_type LIKE 'audio/%';
UPDATE files SET metadata = jsonb_build_object('type', 'file', 'mime', file_type)
  WHERE metadata IS NULL;

ALTER TABLE files ALTER COLUMN metadata SET NOT NULL;
ALTER TABLE files ALTER COLUMN metadata SET DEFAULT '{"type":"file","mime":"application/octet-stream"}';
ALTER TABLE files DROP COLUMN file_type;
