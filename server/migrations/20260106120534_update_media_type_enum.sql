-- Migration: Remove subscriptions system and update media_type enum
-- The subscriptions table is no longer needed with LiveKit handling media routing

-- Step 1: Drop subscriptions table and related trigger
DROP TABLE IF EXISTS subscriptions;
DROP FUNCTION IF EXISTS cleanup_subscriptions_on_publish_change();

-- Step 2: Drop old media_type enum
DROP TYPE IF EXISTS media_type;

-- Step 3: Create new media_type enum matching LiveKit Track.Source values
CREATE TYPE media_type AS ENUM ('camera', 'microphone', 'screen_share', 'screen_share_audio');
