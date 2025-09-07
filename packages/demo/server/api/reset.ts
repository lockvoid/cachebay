import pg from 'pg';
import dump from '../db/lego-dump.sql';

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();

  const client = new pg.Client({
    connectionString: config.databaseUrl,
  })

  await client.connect()

  try {
    await client.query('BEGIN');
    
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(dump);
    
    await client.query('COMMIT');

    return { ok: true }
  } catch (error: any) {
    await client.query('ROLLBACK');

    return { error: error.message }
  } finally {
    await client.end()
  }
})
