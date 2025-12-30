-- Opencord Server Database Schema
-- Compatible with PostgreSQL

-- ============================================
-- Core Tables
-- ============================================

-- Roles table - defines user roles with permissions
CREATE TABLE roles (
    role_id BIGSERIAL PRIMARY KEY,
    role_name VARCHAR(255) NOT NULL UNIQUE
);

-- Avatar files table - stores user avatar file information
CREATE TABLE avatar_files (
    file_id BIGSERIAL PRIMARY KEY,
    file_uuid VARCHAR(255) NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(255) NOT NULL
);

-- Index for efficient avatar file queries
CREATE INDEX idx_avatar_files_uuid ON avatar_files(file_uuid);

-- Create enum type for user status
CREATE TYPE user_status_type AS ENUM ('Online', 'Away', 'DoNotDisturb', 'Offline');

-- Users table - stores user account information, status, and server mute/deafen
CREATE TABLE users (
    user_id BIGSERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    avatar_file_id BIGINT DEFAULT NULL,
    role_id BIGINT NOT NULL DEFAULT 3,
    status user_status_type NOT NULL DEFAULT 'Offline',
    manual_status user_status_type DEFAULT NULL,
    server_mute BOOLEAN NOT NULL DEFAULT FALSE,
    server_deafen BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY(role_id) REFERENCES roles(role_id),
    FOREIGN KEY(avatar_file_id) REFERENCES avatar_files(file_id) ON DELETE SET NULL
);

-- Authentication table - stores password hashes and TOTP secrets
CREATE TABLE auth (
    user_id BIGINT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Create invites table
CREATE TABLE invites (
    invite_id BIGSERIAL PRIMARY KEY,
    code VARCHAR(255) UNIQUE NOT NULL,
    available_registrations INTEGER NOT NULL DEFAULT 1,
    role_id BIGINT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
);

-- Create index on invite code for faster lookups
CREATE INDEX idx_invites_code ON invites(code);

-- ============================================
-- Communication Structure Tables
-- ============================================

-- Groups table - logical groupings for channels
CREATE TABLE groups (
    group_id BIGSERIAL PRIMARY KEY,
    group_name VARCHAR(255) NOT NULL
);

-- Create enum type for channel types
CREATE TYPE channel_type AS ENUM ('Text', 'VoIP');


-- Channels table - communication channels (text/voice)
CREATE TABLE channels (
    channel_id BIGSERIAL PRIMARY KEY,
    channel_name VARCHAR(255) NOT NULL UNIQUE,
    group_id BIGINT NOT NULL,
    channel_type channel_type NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE
);

-- ============================================
-- Messaging Tables
-- ============================================
-- Messages table - stores all messages (channel and direct)
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id BIGINT NOT NULL,
    channel_id BIGINT REFERENCES channels(channel_id) ON DELETE CASCADE,
    recipient_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
    message_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    reply_to_message_id BIGINT,
    FOREIGN KEY(sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CHECK ( (channel_id IS NOT NULL AND recipient_id IS NULL) OR (channel_id IS NULL AND recipient_id IS NOT NULL) )
);

-- Trigger to set reply_to_message_id to -1 when referenced message is deleted
CREATE OR REPLACE FUNCTION set_reply_deleted() RETURNS TRIGGER AS $$
BEGIN
    UPDATE messages SET reply_to_message_id = -1 WHERE reply_to_message_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER before_message_delete
    BEFORE DELETE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION set_reply_deleted();

-- Files table - stores all file attachments
CREATE TABLE files (
    file_id BIGSERIAL PRIMARY KEY,
    file_uuid VARCHAR(255) NOT NULL UNIQUE,
    message_id BIGINT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE reactions (
    reaction_id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_messages_sender_modified ON messages(sender_id, modified_at);
CREATE INDEX idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX idx_messages_channel ON messages(channel_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id);

CREATE INDEX idx_files_message ON files(message_id);
CREATE INDEX idx_files_uuid ON files(file_uuid);

CREATE INDEX idx_reactions_message ON reactions(message_id);

-- ============================================
-- Permission System Tables
-- ============================================


-- Group role rights - defines what roles can do in specific groups
CREATE TABLE group_role_rights (
    group_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    rights BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (group_id, role_id),
    FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
);

-- ============================================
-- Session Management Tables
-- ============================================

-- Sessions table - manages user login sessions
CREATE TABLE sessions (
    session_id BIGSERIAL PRIMARY KEY,
    session_token VARCHAR(255) NOT NULL,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ,
    FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- VoIP Status Tables
-- ============================================


-- VoIP participants - unified table for both channel and private VoIP
CREATE TABLE voip_participants (
    user_id BIGINT PRIMARY KEY,
    channel_id BIGINT REFERENCES channels(channel_id) ON DELETE CASCADE,
    recipient_id BIGINT REFERENCES users(user_id) ON DELETE CASCADE,
    local_deafen BOOLEAN NOT NULL DEFAULT FALSE,
    local_mute BOOLEAN NOT NULL DEFAULT FALSE,
    publish_screen BOOLEAN NOT NULL DEFAULT FALSE,
    publish_camera BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CHECK ( (channel_id IS NOT NULL AND recipient_id IS NULL) OR (channel_id IS NULL AND recipient_id IS NOT NULL) )
);


-- Create ENUM for media types
CREATE TYPE media_type AS ENUM ('screen', 'camera', 'audio');

-- Subscriptions table
CREATE TABLE subscriptions(
    user_id BIGINT NOT NULL,
    publisher_id BIGINT NOT NULL,
    media_type media_type NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, publisher_id, media_type),
    FOREIGN KEY (user_id) REFERENCES voip_participants(user_id) ON DELETE CASCADE,
    FOREIGN KEY (publisher_id) REFERENCES voip_participants(user_id) ON DELETE CASCADE
);

-- Function to clean up subscriptions when publishing stops
CREATE OR REPLACE FUNCTION cleanup_subscriptions_on_publish_change()
RETURNS TRIGGER AS $$
BEGIN
    -- If publish_screen changed from TRUE to FALSE
    IF OLD.publish_screen = TRUE AND NEW.publish_screen = FALSE THEN
        DELETE FROM subscriptions 
        WHERE publisher_id = NEW.user_id 
        AND media_type = 'screen';
    END IF;
    
    -- If publish_camera changed from TRUE to FALSE
    IF OLD.publish_camera = TRUE AND NEW.publish_camera = FALSE THEN
        DELETE FROM subscriptions 
        WHERE publisher_id = NEW.user_id 
        AND media_type = 'camera';
    END IF;
    
    -- If local_mute changed from FALSE to TRUE (stops publishing audio)
    IF OLD.local_mute = FALSE AND NEW.local_mute = TRUE THEN
        DELETE FROM subscriptions 
        WHERE publisher_id = NEW.user_id 
        AND media_type = 'audio';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Indexes for VoIP participants
CREATE INDEX idx_voip_participants_channel ON voip_participants(channel_id);
CREATE INDEX idx_voip_participants_recipient ON voip_participants(recipient_id);


-- ============================================
-- Configuration Tables
-- ============================================

-- Server config table - stores server-wide settings
CREATE TABLE server_config (
    id BIGSERIAL PRIMARY KEY,
    server_name VARCHAR(100) NOT NULL DEFAULT 'Opencord',
    avatar_file_id BIGINT REFERENCES avatar_files(file_id) ON DELETE SET NULL
);

-- ============================================
-- Triggers for Permission Management
-- ============================================

-- Function to add default role rights when a new group is created
CREATE OR REPLACE FUNCTION add_group_role_rights_func()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO group_role_rights (group_id, role_id, rights)
    SELECT
        NEW.group_id,
        role_id,
        CASE WHEN role_id IN (1, 2) THEN 8 ELSE 0 END
    FROM roles;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER add_group_role_rights
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION add_group_role_rights_func();

-- Function to add group rights for all existing groups when a new role is created
CREATE OR REPLACE FUNCTION add_role_group_rights_func()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO group_role_rights (group_id, role_id, rights)
    SELECT 
        group_id,
        NEW.role_id,
        0
    FROM groups;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER add_role_channel_rights
AFTER INSERT ON roles
FOR EACH ROW
EXECUTE FUNCTION add_role_group_rights_func();

-- ============================================
-- Initial Data
-- ============================================

-- Insert default roles (Owner = 1, Admin = 2, Default = 3)
INSERT INTO roles (role_id, role_name) VALUES (1, 'Owner');
INSERT INTO roles (role_id, role_name) VALUES (2, 'Admin');
INSERT INTO roles (role_id, role_name) VALUES (3, 'Default');

-- Sync sequence after explicit ID inserts
SELECT setval('roles_role_id_seq', (SELECT MAX(role_id) FROM roles));

-- Insert default avatar file (1.jpg)
INSERT INTO avatar_files (file_uuid, file_name, file_type, file_size, file_hash) 
VALUES ('1', '1.jpg', 'image/jpeg', 0, 'default_hash');


INSERT INTO invites (code, available_registrations, role_id) VALUES ('OWNER_INVITE_2024', 1, 1);

-- Insert default server config
INSERT INTO server_config (server_name) VALUES ('Opencord');

-- ============================================
-- Permission System Constants (as comments)
-- ============================================

/*
Permission Levels (hierarchical - higher includes lower):
- 0 = Hidden (no access)
- 1 = Ack (see group exists)
- 2 = Read/Listen
- 4 = Write/Speak
- 8 = ACL (full access control, includes moderation: kick, delete messages)

Special Role IDs:
- 1 = Owner (absolute authority)
- 2 = Administrator (maximum rights everywhere)

ACL Right Granting Rules:
- Only Owner (role_id=1) or Admin (role_id=2) can grant/remove ACL rights (8)
- Any ACL holder (rights >= 8) can grant/remove other rights (1, 2, 4) to any role

Moderation Hierarchy (for kick/delete operations with ACL right):
- Owner (role_id=1): Can moderate anyone
- Admin (role_id=2): Can moderate anyone except Owner
- Non-admin with ACL (role_id>=3, rights>=8): Can only moderate non-owner, non-admin users

Hierarchical Permission Rules:
- Child channels inherit parent group permissions automatically
- Child channel permissions cannot be modified independently
- Users belong to roles, roles have rights for channels/groups
*/
