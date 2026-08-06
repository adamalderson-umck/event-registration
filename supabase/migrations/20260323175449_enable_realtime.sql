
-- Enable Realtime on tables that need live updates
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE registrations;
;
