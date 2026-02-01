-- Migration: Replace trigger-based reply handling with foreign key
-- Drops the old trigger and adds a self-referencing foreign key with ON DELETE SET NULL
-- This changes reply_to_message_id from -1 to NULL when parent message is deleted

-- Step 1: Drop the old trigger and function
DROP TRIGGER IF EXISTS before_message_delete ON messages;
DROP FUNCTION IF EXISTS set_reply_deleted();

-- Step 2: First, update any existing -1 values to NULL
UPDATE messages SET reply_to_message_id = NULL WHERE reply_to_message_id = -1;

-- Step 3: Add self-referencing foreign key with ON DELETE SET NULL
-- This automatically sets reply_to_message_id to NULL when parent is deleted
ALTER TABLE messages 
ADD CONSTRAINT fk_reply_to_message 
FOREIGN KEY (reply_to_message_id) 
REFERENCES messages(id) 
ON DELETE SET NULL;
