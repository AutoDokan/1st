const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

async function useSupabaseAuthState(supabaseUrl, supabaseKey, sessionId = 'autodokan_seller_1') {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
  });

  // Fast In-Memory Cache for 0ms WebSocket Handshakes
  const keyCache = new Map();
  let creds;

  console.log(`[Supabase Auth] Loading session "${sessionId}" from database...`);

  // 1. Preload all existing keys and creds from Supabase into memory
  try {
    const { data: rows, error } = await supabase
      .from('whatsapp_sessions')
      .select('key, data')
      .eq('session_id', sessionId);

    if (!error && rows) {
      for (const row of rows) {
        if (row.key === 'creds') {
          creds = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
        } else {
          keyCache.set(row.key, JSON.parse(JSON.stringify(row.data), BufferJSON.reviver));
        }
      }
    }
  } catch (err) {
    console.warn('[Supabase Auth] Error preloading keys:', err.message);
  }

  if (!creds) {
    console.log('[Supabase Auth] No existing credentials found. Generating fresh creds...');
    creds = initAuthCreds();
  } else {
    console.log('[Supabase Auth] Restored existing credentials from Supabase!');
  }

  // Pending async batch writes to avoid blocking Baileys WebSocket
  let pendingWrites = new Map();
  let writeTimeout = null;

  const flushToSupabase = async () => {
    if (pendingWrites.size === 0) return;
    const batch = Array.from(pendingWrites.values());
    pendingWrites.clear();
    try {
      await supabase.from('whatsapp_sessions').upsert(batch, { onConflict: 'session_id,key' });
    } catch (err) {
      console.error('[Supabase Auth] Batch flush error:', err.message);
    }
  };

  const scheduleFlush = (key, dataObj) => {
    pendingWrites.set(key, {
      session_id: sessionId,
      key,
      data: JSON.parse(JSON.stringify(dataObj, BufferJSON.replacer)),
      updated_at: new Date().toISOString()
    });
    if (!writeTimeout) {
      writeTimeout = setTimeout(() => {
        writeTimeout = null;
        flushToSupabase();
      }, 500); // Flush in 500ms batches
    }
  };

  const saveCreds = async () => {
    scheduleFlush('creds', creds);
  };

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const result = {};
        for (const id of ids) {
          const fullKey = `${type}-${id}`;
          if (keyCache.has(fullKey)) {
            result[id] = keyCache.get(fullKey);
          }
        }
        return result;
      },
      set: async (data) => {
        for (const category of Object.keys(data)) {
          for (const id of Object.keys(data[category])) {
            const val = data[category][id];
            const fullKey = `${category}-${id}`;
            if (val) {
              keyCache.set(fullKey, val);
              scheduleFlush(fullKey, val);
            } else {
              keyCache.delete(fullKey);
              // Async delete from Supabase
              supabase
                .from('whatsapp_sessions')
                .delete()
                .eq('session_id', sessionId)
                .eq('key', fullKey)
                .catch(() => {});
            }
          }
        }
      }
    }
  };

  return { state, saveCreds };
}

module.exports = { useSupabaseAuthState };
