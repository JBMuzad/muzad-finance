import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://btupnjyvsltowbynqhxz.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dXBuanl2c2x0b3dieW5xaHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNjIxNjAsImV4cCI6MjA4OTgzODE2MH0.5XoinYyx_qyGcYATwtAnE955dvkN-C6oiYECojOmwnE"
);
