-- Seed the "140" permanent room with tracks from Audius playlist "140"
-- (https://audius.co/Audius/playlist/140 — API ID: l5Q60YO)
--
-- Run in Supabase SQL Editor.

INSERT INTO rooms (room_id, host_name, host_handle, host_user_id, is_permanent, user_count, playlist, current_track)
VALUES (
  '247room4',
  '140',
  'Audius',
  'eJ57D',
  true,
  0,
  '[
    {"id":"4zXwQWy","title":"QGRS-054 | Sh0wtime - takeyourplace","user":{"id":"D97oa","name":"Quality Goods Records","handle":"QGRecs"},"genre":"Trap","artwork":"https://audius-creator-9.theblueprint.xyz/content/01KGM3PQ7BRKKH1RSAPRYF7FGN/480x480.jpg","duration":186},
    {"id":"JNdramY","title":"Need u Now","user":{"id":"E0OPN","name":"Moceans","handle":"moceans"},"genre":"Electronic","artwork":"https://audius-creator-10.theblueprint.xyz/content/01KGSZEFQRYHA8263XFC3ZN811/480x480.jpg","duration":126},
    {"id":"JGO0ZW0","title":"21 PILOTS - HEATHENS (CROMATIK FLIP)","user":{"id":"YaEpr","name":"Cromatik","handle":"Cromatik"},"genre":"Dubstep","artwork":"https://audius-creator-14.theblueprint.xyz/content/01KGKNSBS4B7BWK3DRQYB4SVJ4/480x480.jpg","duration":204},
    {"id":"3RpYNqk","title":"Kai Wachi x Saint Miller - NONSTOP","user":{"id":"dR4O3l2","name":"saintmiller","handle":"saintmiller"},"genre":"Dubstep","artwork":"https://audius-01.staked.cloud/content/01KGV2B7EBHA4TMY3R4H3FBSMS/480x480.jpg","duration":181},
    {"id":"2RXdgd0","title":"kaito. - ILOVEIT!","user":{"id":"D2W4p","name":"kaito.","handle":"ilykaito"},"genre":"Dubstep","artwork":"https://cn3.mainnet.audiusindex.org/content/baeaaaiqsecui4ngbdfc6nvrskybpjp32luawzio5ftfpduryb376prueoxnno/480x480.jpg","duration":137},
    {"id":"NzlbMYY","title":"burn it down","user":{"id":"L59VL","name":"jim callison","handle":"jimcallison"},"genre":"Electronic","artwork":"https://audius-creator-5.theblueprint.xyz/content/01KGT8688XC21CRBGZZ7NXE3FY/480x480.jpg","duration":158},
    {"id":"qJ696kb","title":"REWIND","user":{"id":"B0gPY79","name":"parasox","handle":"parasoxmusic"},"genre":"Experimental","artwork":"https://audius.bragi.cc/content/01KGTK4D8733RZYS4VJC95M3C9/480x480.jpg","duration":205},
    {"id":"oVN5Pdg","title":"On da trac [BADROOM]","user":{"id":"OvNgzNz","name":"BADROOM","handle":"BADROOM"},"genre":"Electronic","artwork":"https://audius-creator-2.theblueprint.xyz/content/01KGKGN698GK519PDV0N29ABH5/480x480.jpg","duration":150},
    {"id":"vZo4jK8","title":"Waeys & Innate MC - Gone","user":{"id":"nQ2OW","name":"Critical Music","handle":"CriticalMusic"},"genre":"Dubstep","artwork":"https://cn4.mainnet.audiusindex.org/content/01KGMQ7HD2NFZVRJMT2768XAAF/480x480.jpg","duration":144},
    {"id":"42EwO6Z","title":"Dabow & Eliderp - Monument","user":{"id":"Lw7gr","name":"Dabow","handle":"Dabowmusic"},"genre":"Electronic","artwork":"https://audius-figment-1-validator-19.figment.io/content/01K464NC54XWSQ2VT8EKVZYZP8/480x480.jpg","duration":141},
    {"id":"lWBgN8K","title":"Say What (Low Poly Flip)","user":{"id":"L5QyM","name":"Low Poly","handle":"lowpoly"},"genre":"Dubstep","artwork":"https://audius-discovery-1.altego.net/content/01KFPP5NX8TAN5AMJSGE4XAQ63/480x480.jpg","duration":193},
    {"id":"0EKvBGM","title":"Stopper (Dub Mix)","user":{"id":"e44re","name":"Noer the Boy","handle":"noertheboy"},"genre":"Electronic","artwork":"https://audius-content-7.figment.io/content/01K9Q77WB7CTSC45ZPMHB81TNA/480x480.jpg","duration":164},
    {"id":"dyaVyWM","title":"HDILLA - Dystopia","user":{"id":"9b1B8Q2","name":"Dont Die At Work","handle":"dontdieatwork"},"genre":"Electronic","artwork":"https://audius-figment-1-validator-18.figment.io/content/01KAM2B018N4R83TJYDKY7Q9VB/480x480.jpg","duration":324},
    {"id":"bv6VOjM","title":"KTRL - IDONTLIKEYOU","user":{"id":"gYbENBx","name":"cd91x","handle":"cd91x"},"genre":"Dubstep","artwork":"https://audius-content-14.figment.io/content/01KG85PTJC8WEEGW5QHP1G1YF0/480x480.jpg","duration":137},
    {"id":"17RW2VW","title":"Wailing Soul - Fire House Rock (Submana Flip)","user":{"id":"v2GlzWp","name":"Submana","handle":"Submana"},"genre":"Dubstep","artwork":"https://audius-creator-10.theblueprint.xyz/content/01KG81T5FWHPZZB06YYECQKT8R/480x480.jpg","duration":181},
    {"id":"PVB2al5","title":"Wook Cannon","user":{"id":"nZzvn","name":"bd hbt","handle":"bdhbtmusic"},"genre":"Dubstep","artwork":"https://creatornode2.audius.co/content/baeaaaiqsedq74zntqlz3pndagl3kouuurmcbfgfhv3vanhj27mxfriyzbuedg/480x480.jpg","duration":157},
    {"id":"V5N8pGW","title":"Bounce","user":{"id":"nZAka","name":"Kaiyo","handle":"Officialkaiyo"},"genre":"Dubstep","artwork":"https://audius-content-4.figment.io/content/baeaaaiqsed5ritu2c5lxay3fjxiz4lljzcs5m4bhyy77cktfptxgt3yupjzs6/480x480.jpg","duration":195},
    {"id":"P643Bkp","title":"VOLUME","user":{"id":"KEjarQz","name":"HARDFLIP","handle":"HARDFLIP"},"genre":"Electronic","artwork":"https://creatornode2.audius.co/content/baeaaaiqseae3knbybchkczoc46myt73w4xo3s74s45hizwxk5zysthbopkmfm/480x480.jpg","duration":171},
    {"id":"gWddGy9","title":"isoxo - dontstopme! (CURED BY CURE97)","user":{"id":"g4PR9","name":"CURE97","handle":"cure97"},"genre":"Dubstep","artwork":"https://creatornode2.audius.co/content/01JRB6WKCFXJ28XXSX1A3ZBAPY/480x480.jpg","duration":137},
    {"id":"yyB5q7X","title":"TELL ME","user":{"id":"jN8NERV","name":"lumii","handle":"lumii"},"genre":"Electronic","artwork":"https://audius-01.staked.cloud/content/baeaaaiqseb3xlcm2p6zy73f2oxiu5teb2um3vlvz7owrq33lhdbe6fatfjd3a/480x480.jpg","duration":205},
    {"id":"k2YMprN","title":"Headrush","user":{"id":"5QGlg1g","name":"Delia Ridge","handle":"DeliaRidge"},"genre":"Dubstep","artwork":"https://audius-figment-1-validator-19.figment.io/content/01KG852MD0B2WW6DFS1H98A76D/480x480.jpg","duration":240},
    {"id":"d0W1agK","title":"Ookay - Thief (Blaize Remix)","user":{"id":"DE02J","name":"B L A I Z E","handle":"BlaizeOnIt"},"genre":"Trap","artwork":"https://cn4.mainnet.audiusindex.org/content/01KFPCQVEHRQTFH6F2HJ8X8064/480x480.jpg","duration":214}
  ]'::jsonb,
  '{"title":"QGRS-054 | Sh0wtime - takeyourplace","artist":"Quality Goods Records"}'::jsonb
)
ON CONFLICT (room_id) DO UPDATE SET
  host_name = EXCLUDED.host_name,
  host_handle = EXCLUDED.host_handle,
  host_user_id = EXCLUDED.host_user_id,
  is_permanent = EXCLUDED.is_permanent,
  playlist = EXCLUDED.playlist,
  current_track = EXCLUDED.current_track;
