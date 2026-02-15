ALTER TABLE server_config
    ADD COLUMN max_file_size_mb INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN max_files_per_message INTEGER NOT NULL DEFAULT 5;
