import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL policies reject anonymous writes, foreign ownership and direct broadcasts', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA realtime;
    GRANT USAGE ON SCHEMA auth,realtime TO anon,authenticated;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT current_setting('realtime.topic',true) $$;
    CREATE TABLE realtime.messages (extension text, topic text);
    GRANT ALL ON realtime.messages TO authenticated;
    CREATE POLICY old_permissive ON realtime.messages FOR ALL USING(true) WITH CHECK(true);
  `);
  await db.exec(readFileSync('setup.sql', 'utf8'));
  await db.exec(readFileSync('migrations/0001_security.sql', 'utf8'));
  const login = async (userId, handle, role = 'authenticated') => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ audius_user_id: userId, audius_handle: handle, audius_name: handle })]);
    await db.exec(`SET ROLE ${role}`);
  };
  await login('owner', 'owner');
  await db.exec("INSERT INTO playlists(user_id,tracks) VALUES('owner','[]')");
  await db.exec("INSERT INTO rooms(room_id,host_user_id,host_handle) VALUES('owner','owner','owner')");
  await db.exec("UPDATE rooms SET playlist='[1]' WHERE room_id='owner'");
  await assert.rejects(db.exec("UPDATE rooms SET is_permanent=true WHERE room_id='owner'"));
  await assert.rejects(db.exec("UPDATE rooms SET room_id='victim' WHERE room_id='owner'"));
  await assert.rejects(db.exec("INSERT INTO rooms(room_id,host_user_id,host_handle) VALUES('victim','owner','owner')"));
  await db.exec("INSERT INTO chat_messages(room_id,user_id,handle,name,text,timestamp) VALUES('owner','owner','owner','owner','Hello',1)");
  await assert.rejects(db.exec("INSERT INTO chat_messages(room_id,user_id,handle,name,text,timestamp) VALUES('owner','victim','owner','owner','Forged',1)"));
  await login('attacker', 'attacker');
  assert.equal((await db.query("UPDATE rooms SET playlist='[]' WHERE room_id='owner' RETURNING room_id")).rows.length, 0);
  assert.equal((await db.query("UPDATE playlists SET tracks='[]' WHERE user_id='owner' RETURNING user_id")).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM playlists WHERE user_id='owner'")).rows.length, 0);
  await assert.rejects(db.exec("INSERT INTO playlists(user_id,tracks) VALUES('owner','[]')"));
  await assert.rejects(db.exec("INSERT INTO realtime.messages(extension,topic) VALUES('broadcast','room:owner')"));
  await login(null, null);
  await assert.rejects(db.exec("INSERT INTO playlists(user_id,tracks) VALUES('owner','[]')"));
  await assert.rejects(db.exec("INSERT INTO chat_messages(room_id,user_id,handle,name,timestamp) VALUES('owner','owner','owner','owner',1)"));
  await login(null, null, 'anon');
  await assert.rejects(db.exec("UPDATE rooms SET user_count=100 WHERE room_id='owner'"));
  await db.exec('RESET ROLE');
  assert.equal((await db.query("SELECT playlist FROM rooms WHERE room_id='owner'")).rows[0].playlist[0], 1);
});
